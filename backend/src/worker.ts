import "dotenv/config";
import { Worker, Job } from "bullmq";
import nodemailer from "nodemailer";

import { connection } from "./lib/redis";
import { emailQueue } from "./lib/queue";
import { prisma } from "./lib/prisma";
import {
  tryConsume,
  msUntilNextHour,
  waitForSendSlot,
} from "./lib/rateLimiter";
import { createTransport } from "./lib/mailer";
import { notifySlackRateLimit } from "./lib/slackNotify";
import {
  elasticsearch,
  EMAIL_INDEX,
  ensureEmailIndex,
} from "./lib/elasticsearch";

const MIN_DELAY_MS = Number(
  process.env.MIN_EMAIL_DELAY_MS ?? 2000
);

const CONCURRENCY = Number(
  process.env.WORKER_CONCURRENCY ?? 5
);

/*
 * ---------------------------------------------------------
 * Elasticsearch
 * ---------------------------------------------------------
 */

async function indexEmail(email: any) {
  try {
    await elasticsearch.index({
      index: EMAIL_INDEX,
      id: email.id,

      document: {
        id: email.id,
        campaignId: email.campaignId,
        senderId: email.senderId,
        recipient: email.recipient,
        subject: email.subject,
        body: email.body,
        status: email.status,
        scheduledAt: email.scheduledAt,
        sentAt: email.sentAt,
        messageId: email.messageId,
        errorMessage: email.errorMessage,
        createdAt: email.createdAt,
      },

      refresh: true,
    });

    console.log(
      `[worker] Elasticsearch indexed email: ${email.id}`
    );
  } catch (error) {
    console.error(
      `[worker] Elasticsearch indexing failed for email ${email.id}:`,
      error
    );
  }
}

async function initializeElasticsearch() {
  try {
    await ensureEmailIndex();

    console.log(
      `[worker] Elasticsearch ready. Index=${EMAIL_INDEX}`
    );
  } catch (error) {
    console.error(
      "[worker] Elasticsearch initialization failed:",
      error
    );
  }
}

/*
 * ---------------------------------------------------------
 * Campaign status helpers
 * ---------------------------------------------------------
 */

async function markCampaignRunning(campaignId: string) {
  try {
    await prisma.campaign.update({
      where: {
        id: campaignId,
      },

      data: {
        status: "RUNNING",
      },
    });
  } catch (error) {
    console.error(
      `[worker] Failed to mark campaign ${campaignId} as RUNNING:`,
      error
    );
  }
}

async function updateCampaignStatus(campaignId: string) {
  try {
    const emails = await prisma.email.findMany({
      where: {
        campaignId,
      },

      select: {
        status: true,
      },
    });

    if (emails.length === 0) {
      return;
    }

    const sent = emails.filter(
      (email) => email.status === "SENT"
    ).length;

    const failed = emails.filter(
      (email) => email.status === "FAILED"
    ).length;

    const processing = emails.filter(
      (email) => email.status === "PROCESSING"
    ).length;

    const scheduled = emails.filter(
      (email) => email.status === "SCHEDULED"
    ).length;

    /*
     * All emails finished.
     */
    if (sent + failed === emails.length) {
      await prisma.campaign.update({
        where: {
          id: campaignId,
        },

        data: {
          status:
            failed === emails.length
              ? "FAILED"
              : "COMPLETED",
        },
      });

      console.log(
        `[worker] Campaign ${campaignId} completed. ` +
          `Sent=${sent}, Failed=${failed}`
      );

      return;
    }

    /*
     * Some emails are actively being processed.
     */
    if (processing > 0) {
      await prisma.campaign.update({
        where: {
          id: campaignId,
        },

        data: {
          status: "RUNNING",
        },
      });

      return;
    }

    /*
     * Emails are waiting for their scheduled time.
     */
    if (scheduled > 0) {
      await prisma.campaign.update({
        where: {
          id: campaignId,
        },

        data: {
          status: "SCHEDULED",
        },
      });
    }
  } catch (error) {
    console.error(
      `[worker] Failed to update campaign ${campaignId}:`,
      error
    );
  }
}

/*
 * ---------------------------------------------------------
 * Worker
 * ---------------------------------------------------------
 */

const worker = new Worker(
  "emails",

  async (job: Job) => {
    const { emailId } = job.data as {
      emailId: string;
    };

    console.log(
      `[worker] Processing job ${String(job.id)}, email ${emailId}`
    );

    /*
     * Get email and related sender/campaign.
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

    if (!email) {
      console.log(
        `[worker] Email ${emailId} not found.`
      );

      return;
    }

    /*
     * Idempotency protection.
     *
     * If the email was already sent by another attempt,
     * never send it again.
     */
    if (email.status === "SENT") {
      console.log(
        `[worker] Email ${emailId} already SENT, skipping.`
      );

      await updateCampaignStatus(
        email.campaignId
      );

      return;
    }

    /*
     * Don't process two copies simultaneously.
     */
    if (email.status === "PROCESSING") {
      console.log(
        `[worker] Email ${emailId} already PROCESSING, skipping.`
      );

      return;
    }

    /*
     * Campaign has started executing.
     */
    await markCampaignRunning(
      email.campaignId
    );

    /*
     * -----------------------------------------------------
     * Hourly rate limit
     * -----------------------------------------------------
     */

    const hourlyLimit =
      email.campaign.hourlyLimit;

    const allowed = await tryConsume(
      email.senderId,
      hourlyLimit
    );

    if (!allowed) {
      const delayMs = msUntilNextHour();

      console.log(
        `[worker] Sender ${email.senderId} reached hourly limit ` +
          `(${hourlyLimit}). Rescheduling email ${emailId} ` +
          `for ${delayMs}ms later.`
      );

      /*
       * Slack notification should never stop email
       * processing if Slack fails.
       */
      try {
        await notifySlackRateLimit(
          email.campaign.userId,
          email.sender.email,
          hourlyLimit
        );
      } catch (slackError) {
        console.error(
          "[worker] Slack notification failed:",
          slackError
        );
      }

      /*
       * Create a UNIQUE retry job.
       *
       * Do not reuse email.id as the job ID because
       * the original job may still exist in BullMQ.
       */
      const retryJobId =
        `${email.id}-retry-${Date.now()}`;

      try {
        await emailQueue.add(
          "send-email",
          {
            emailId: email.id,
          },

          {
            jobId: retryJobId,

            delay: delayMs,

            removeOnComplete: true,

            removeOnFail: false,
          }
        );

        console.log(
          `[worker] Email ${emailId} rescheduled as ` +
            `${retryJobId}.`
        );
      } catch (error) {
        console.error(
          `[worker] Failed to reschedule email ${emailId}:`,
          error
        );

        throw error;
      }

      /*
       * IMPORTANT:
       *
       * Return normally.
       *
       * The current BullMQ job is completed.
       * The retry job will run later.
       */
      return;
    }

    /*
     * -----------------------------------------------------
     * Minimum delay between emails
     * -----------------------------------------------------
     */

    await waitForSendSlot(
      email.senderId,
      MIN_DELAY_MS
    );

    /*
     * Mark email PROCESSING.
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

    await updateCampaignStatus(
      email.campaignId
    );

    /*
     * -----------------------------------------------------
     * SMTP send
     * -----------------------------------------------------
     */

    try {
      const transport = createTransport(
        email.sender.smtpUser,
        email.sender.smtpPass
      );

      const info = await transport.sendMail({
        from: email.sender.email,
        to: email.recipient,
        subject: email.subject,
        html: email.body,
      });

      const previewUrl =
        nodemailer.getTestMessageUrl(info);

      /*
       * Mark email SENT immediately after successful SMTP.
       */
      const sentEmail =
        await prisma.email.update({
          where: {
            id: email.id,
          },

          data: {
            status: "SENT",
            sentAt: new Date(),
            messageId: info.messageId,
            errorMessage: null,
          },
        });

      console.log(
        `[worker] Email ${email.id} sent successfully.`
      );

      if (previewUrl) {
        console.log(
          `[worker] Ethereal Preview URL: ${previewUrl}`
        );
      }

      /*
       * Elasticsearch is NOT allowed to turn a
       * successfully-sent email into a failed email.
       */
      await indexEmail(sentEmail);

      /*
       * Update campaign after successful send.
       */
      await updateCampaignStatus(
        email.campaignId
      );

      /*
       * Return normally.
       *
       * BullMQ will mark the job COMPLETED.
       */
      return;
    } catch (error: any) {
      /*
       * SMTP failed.
       */
      const errorMessage =
        String(error?.message ?? error);

      try {
        const failedEmail =
          await prisma.email.update({
            where: {
              id: email.id,
            },

            data: {
              status: "FAILED",
              errorMessage,
            },
          });

        await indexEmail(failedEmail);

        await updateCampaignStatus(
          email.campaignId
        );
      } catch (databaseError) {
        console.error(
          "[worker] Failed to update failed email:",
          databaseError
        );
      }

      console.error(
        `[worker] Email ${email.id} failed:`,
        error
      );

      /*
       * Tell BullMQ the job failed.
       */
      throw error;
    }
  },

  {
    connection,

    /*
     * Process multiple emails concurrently.
     */
    concurrency: CONCURRENCY,

    /*
     * Give each active job a 2-minute Redis lock.
     */
    lockDuration: 120000,

    /*
     * Detect stalled workers every 30 seconds.
     */
    stalledInterval: 30000,

    /*
     * Automatically remove old completed jobs.
     */
    removeOnComplete: {
      count: 1000,
    },

    /*
     * Keep failed jobs for debugging.
     */
    removeOnFail: {
      count: 1000,
    },
  }
);

/*
 * ---------------------------------------------------------
 * Worker events
 * ---------------------------------------------------------
 */

worker.on("completed", (job) => {
  console.log(
    `[worker] Job ${String(job.id)} completed.`
  );
});

worker.on("failed", (job, error) => {
  if (!job) {
    console.error(
      "[worker] Job failed without job information:",
      error
    );

    return;
  }

  console.error(
    `[worker] Job ${String(job.id)} failed:`,
    error.message
  );
});

worker.on("error", (error) => {
  console.error(
    "[worker] Worker error:",
    error
  );
});

/*
 * ---------------------------------------------------------
 * Graceful shutdown
 * ---------------------------------------------------------
 */

async function shutdown(signal: string) {
  console.log(
    `[worker] Received ${signal}. Shutting down...`
  );

  try {
    await worker.close();

    await prisma.$disconnect();

    console.log(
      "[worker] Shutdown complete."
    );

    process.exit(0);
  } catch (error) {
    console.error(
      "[worker] Shutdown error:",
      error
    );

    process.exit(1);
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

/*
 * ---------------------------------------------------------
 * Startup
 * ---------------------------------------------------------
 */

void initializeElasticsearch();

console.log(
  `[worker] Started with concurrency=${CONCURRENCY}, ` +
    `minDelay=${MIN_DELAY_MS}ms`
);
