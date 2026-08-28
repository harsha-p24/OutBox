import "dotenv/config";
import { Worker, Job } from "bullmq";
import { connection } from "./lib/redis";
import { emailQueue } from "./lib/queue";
import { prisma } from "./lib/prisma";
import {
  tryConsume,
  msUntilNextHour,
  waitForSendSlot,
} from "./lib/rateLimiter";
import { createTransport } from "./lib/mailer";
import {
  ensureEmailIndex,
  updateEmailIndex,
} from "./lib/elasticsearch";

const MIN_DELAY_MS = Number(
  process.env.MIN_EMAIL_DELAY_MS ?? 2000
);

const CONCURRENCY = Number(
  process.env.WORKER_CONCURRENCY ?? 5
);

class RateLimitDelay extends Error {
  delayMs: number;

  constructor(delayMs: number) {
    super("Rate limit reached, rescheduling job");
    this.name = "RateLimitDelay";
    this.delayMs = delayMs;
  }
}

const worker = new Worker(
  "emails",

  async (job: Job) => {
    const { emailId } = job.data as {
      emailId: string;
    };

    console.log(
      `[worker] Processing job ${job.id}, email ${emailId}`
    );

    /*
     * Load the email together with:
     * - sender → SMTP credentials
     * - campaign → hourly limit
     */
    const email = await prisma.email.findUnique({
      where: {
        id: emailId,
      },
      include: {
        sender: true,
        campaign: true,
      },
    });

    /*
     * If the database record doesn't exist,
     * there is nothing for the worker to send.
     */
    if (!email) {
      console.log(
        `[worker] Email ${emailId} not found in DB, skipping.`
      );
      return;
    }

    /*
     * Idempotency protection.
     *
     * If the email was already successfully sent,
     * never send it again.
     */
    if (email.status === "SENT") {
      console.log(
        `[worker] Email ${emailId} already SENT, skipping.`
      );
      return;
    }

    /*
     * Use the hourly limit configured for this campaign.
     */
    const hourlyLimit = email.campaign.hourlyLimit;

    const allowed = await tryConsume(
      email.senderId,
      hourlyLimit
    );

    /*
     * Hourly limit reached.
     *
     * Do not permanently fail the job.
     * Reschedule it for the next available hour.
     */
    if (!allowed) {
      const delayMs = msUntilNextHour();

      console.log(
        `[worker] Sender ${email.senderId} reached hourly limit ` +
          `(${hourlyLimit}). Rescheduling email ${emailId} ` +
          `for ${delayMs}ms later.`
      );

      throw new RateLimitDelay(delayMs);
    }

    /*
     * Distributed minimum-delay protection.
     *
     * Redis prevents multiple workers from sending
     * from the same sender at the same time.
     */
    await waitForSendSlot(
      email.senderId,
      MIN_DELAY_MS
    );

    /*
     * Mark the email as PROCESSING before sending.
     */
    await prisma.email.update({
      where: {
        id: email.id,
      },
      data: {
        status: "PROCESSING",
        errorMessage: null,
      },
    });

    try {
      /*
       * Create Ethereal SMTP transport using
       * the sender's stored SMTP credentials.
       */
      const transport = createTransport(
        email.sender.smtpUser,
        email.sender.smtpPass
      );

      /*
       * Send the actual email.
       */
      const info = await transport.sendMail({
        from: email.sender.email,
        to: email.recipient,
        subject: email.subject,
        html: email.body,
      });

      const previewUrl = nodemailerPreview(info);

      console.log(
        `[worker] Email ${email.id} sent successfully.`
      );

      console.log(
        `[worker] Ethereal Preview URL: ${previewUrl}`
      );

      /*
       * Mark email as SENT only after SMTP succeeds.
       */
      const sentAt = new Date();

      await prisma.email.update({
        where: {
          id: email.id,
        },
        data: {
          status: "SENT",
          sentAt,
          messageId: info.messageId,
          errorMessage: null,
        },
      });

      /*
       * Update Elasticsearch.
       *
       * Elasticsearch failure must not make a
       * successfully-sent email become FAILED.
       */
      try {
        await updateEmailIndex(email.id, {
          status: "SENT",
          sentAt,
          messageId: info.messageId,
          errorMessage: null,
        });

        console.log(
          `[worker] Elasticsearch updated for email ${email.id}.`
        );
      } catch (indexError) {
        console.error(
          `[worker] Failed to update Elasticsearch for email ${email.id}:`,
          indexError
        );
      }
    } catch (err: any) {
      /*
       * SMTP/send failure.
       */
      const errorMessage = String(
        err?.message ?? err
      );

      await prisma.email.update({
        where: {
          id: email.id,
        },
        data: {
          status: "FAILED",
          errorMessage,
        },
      });

      /*
       * Update Elasticsearch with FAILED status.
       */
      try {
        await updateEmailIndex(email.id, {
          status: "FAILED",
          errorMessage,
        });

        console.log(
          `[worker] Elasticsearch updated for failed email ${email.id}.`
        );
      } catch (indexError) {
        console.error(
          `[worker] Failed to update Elasticsearch for failed email ${email.id}:`,
          indexError
        );
      }

      console.error(
        `[worker] Email ${email.id} failed:`,
        err
      );

      /*
       * Re-throw so BullMQ knows that the job failed.
       */
      throw err;
    }
  },

  {
    connection,
    concurrency: CONCURRENCY,
  }
);

/*
 * Get Ethereal's browser preview URL.
 */
function nodemailerPreview(info: any): string {
  try {
    const nodemailer = require("nodemailer");

    return (
      nodemailer.getTestMessageUrl(info) ||
      "(no preview url)"
    );
  } catch {
    return "(no preview url)";
  }
}

/*
 * BullMQ completed event.
 */
worker.on("completed", (job) => {
  console.log(
    `[worker] Job ${job.id} completed.`
  );
});

/*
 * BullMQ failed event.
 *
 * RateLimitDelay is handled specially:
 *
 * rate limit
 *     ↓
 * delayed BullMQ job
 *     ↓
 * next hour
 *     ↓
 * worker processes it again
 */
worker.on("failed", async (job, err) => {
  if (!job) {
    console.log(
      "[worker] Job failed without job information:",
      err.message
    );
    return;
  }

  if (err instanceof RateLimitDelay) {
    console.log(
      `[worker] Re-enqueuing rate-limited job ${job.id} ` +
        `with delay ${err.delayMs}ms.`
    );

    try {
      await emailQueue.add(
        "send-email",
        job.data,
        {
          jobId: job.data.emailId,
          delay: err.delayMs,
        }
      );

      console.log(
        `[worker] Job ${job.id} successfully rescheduled.`
      );
    } catch (rescheduleError: any) {
      console.error(
        `[worker] Failed to reschedule job ${job.id}:`,
        rescheduleError
      );
    }

    return;
  }

  console.log(
    `[worker] Job ${job.id} failed:`,
    err.message
  );
});

/*
 * Initialize Elasticsearch before reporting
 * that the worker has started.
 */
ensureEmailIndex()
  .then(() => {
    console.log(
      `[worker] Started with ` +
        `concurrency=${CONCURRENCY}, ` +
        `minDelay=${MIN_DELAY_MS}ms`
    );
  })
  .catch((error) => {
    console.error(
      "[worker] Failed to initialize Elasticsearch:",
      error
    );
  });
