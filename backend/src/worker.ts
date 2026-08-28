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
  elasticsearch,
  EMAIL_INDEX,
  ensureEmailIndex,
} from "./lib/elasticsearch";

const MIN_DELAY_MS = Number(process.env.MIN_EMAIL_DELAY_MS ?? 2000);
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 5);

class RateLimitDelay extends Error {
  delayMs: number;

  constructor(delayMs: number) {
    super("Rate limit reached, rescheduling job");
    this.name = "RateLimitDelay";
    this.delayMs = delayMs;
  }
}

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
      "[worker] Elasticsearch indexed email: " + email.id
    );
  } catch (err) {
    console.error(
      "[worker] Elasticsearch indexing failed for email: " +
        email.id,
      err
    );
  }
}

async function initializeElasticsearch() {
  try {
    await ensureEmailIndex();

    console.log(
      "[worker] Elasticsearch ready. Index=" + EMAIL_INDEX
    );
  } catch (err) {
    console.error(
      "[worker] Failed to initialize Elasticsearch:",
      err
    );
  }
}

const worker = new Worker(
  "emails",
  async (job: Job) => {
    const { emailId } = job.data as {
      emailId: string;
    };

    console.log(
      "[worker] Processing job " +
        String(job.id) +
        ", email " +
        emailId
    );

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
        "[worker] Email " +
          emailId +
          " not found in DB, skipping."
      );
      return;
    }

    if (email.status === "SENT") {
      console.log(
        "[worker] Email " +
          emailId +
          " already SENT, skipping."
      );
      return;
    }

    if (email.status === "PROCESSING") {
      console.log(
        "[worker] Email " +
          emailId +
          " is already PROCESSING, skipping."
      );
      return;
    }

    const hourlyLimit = email.campaign.hourlyLimit;

    const allowed = await tryConsume(
      email.senderId,
      hourlyLimit
    );

    if (!allowed) {
      const delayMs = msUntilNextHour();

      console.log(
        "[worker] Sender " +
          email.senderId +
          " reached hourly limit (" +
          hourlyLimit +
          "). Rescheduling email " +
          emailId +
          " for " +
          delayMs +
          "ms later."
      );

      throw new RateLimitDelay(delayMs);
    }

    await waitForSendSlot(
      email.senderId,
      MIN_DELAY_MS
    );

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

      const previewUrl = nodemailerPreview(info);

      const sentEmail = await prisma.email.update({
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
        "[worker] Email " +
          email.id +
          " sent successfully."
      );

      console.log(
        "[worker] Ethereal Preview URL: " +
          previewUrl
      );

      await indexEmail(sentEmail);
    } catch (err: any) {
      const failedEmail = await prisma.email.update({
        where: {
          id: email.id,
        },
        data: {
          status: "FAILED",
          errorMessage: String(
            err?.message ?? err
          ),
        },
      });

      await indexEmail(failedEmail);

      console.error(
        "[worker] Email " +
          email.id +
          " failed:",
        err
      );

      throw err;
    }
  },
  {
    connection,
    concurrency: CONCURRENCY,
  }
);

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

worker.on("completed", (job) => {
  console.log(
    "[worker] Job " +
      String(job.id) +
      " completed."
  );
});

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
      "[worker] Re-enqueuing rate-limited job " +
        String(job.id) +
        " with delay " +
        err.delayMs +
        "ms."
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
        "[worker] Job " +
          String(job.id) +
          " successfully rescheduled."
      );
    } catch (rescheduleError: any) {
      console.error(
        "[worker] Failed to reschedule job " +
          String(job.id) +
          ":",
        rescheduleError
      );
    }

    return;
  }

  console.log(
    "[worker] Job " +
      String(job.id) +
      " failed:",
    err.message
  );
});

async function shutdown(signal: string) {
  console.log(
    "[worker] Received " +
      signal +
      ". Shutting down..."
  );

  try {
    await worker.close();
    await prisma.$disconnect();

    console.log("[worker] Shutdown complete.");
    process.exit(0);
  } catch (err) {
    console.error(
      "[worker] Shutdown error:",
      err
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

void initializeElasticsearch();

console.log(
  "[worker] Started with concurrency=" +
    CONCURRENCY +
    ", minDelay=" +
    MIN_DELAY_MS +
    "ms"
);
