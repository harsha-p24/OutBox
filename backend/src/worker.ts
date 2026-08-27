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

const MIN_DELAY_MS = Number(process.env.MIN_EMAIL_DELAY_MS ?? 2000);
const HOURLY_LIMIT = Number(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER ?? 200);
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 5);

class RateLimitDelay extends Error {
  delayMs: number;
  constructor(delayMs: number) {
    super("rate-limited, rescheduling");
    this.delayMs = delayMs;
  }
}

const worker = new Worker(
  "emails",
  async (job: Job) => {
    const { emailId } = job.data as { emailId: string };

    const email = await prisma.email.findUnique({
      where: { id: emailId },
      include: { sender: true },
    });
    if (!email) {
      console.log(`[worker] Email ${emailId} not found in DB, skipping.`);
      return;
    }

    if (email.status === "SENT") {
      console.log(`[worker] Email ${emailId} already SENT, skipping.`);
      return;
    }

    const allowed = await tryConsume(email.senderId, HOURLY_LIMIT);
    if (!allowed) {
      console.log(`[worker] Sender ${email.senderId} hit hourly limit. Rescheduling.`);
      throw new RateLimitDelay(msUntilNextHour());
    }

    await waitForSendSlot(
      email.senderId,
      MIN_DELAY_MS
    );

    await prisma.email.update({
      where: { id: email.id },
      data: { status: "PROCESSING" },
    });

    try {
      const transport = createTransport(email.sender.smtpUser, email.sender.smtpPass);

      const info = await transport.sendMail({
        from: email.sender.email,
        to: email.recipient,
        subject: email.subject,
        html: email.body,
      });

      console.log(`[worker] Email ${email.id} sent. Preview URL: ${nodemailerPreview(info)}`);

      await prisma.email.update({
        where: { id: email.id },
        data: { status: "SENT", sentAt: new Date(), messageId: info.messageId },
      });
    } catch (err: any) {
      await prisma.email.update({
        where: { id: email.id },
        data: { status: "FAILED", errorMessage: String(err?.message ?? err) },
      });
      throw err;
    }

   
  },
  { connection, concurrency: CONCURRENCY }
);

function nodemailerPreview(info: any): string {
  try {
    const nodemailer = require("nodemailer");
    return nodemailer.getTestMessageUrl(info) || "(no preview url)";
  } catch {
    return "(no preview url)";
  }
}

worker.on("completed", (job) => {
  console.log(`[worker] Job ${job.id} completed.`);
});

worker.on("failed", async (job, err) => {
  if (err instanceof RateLimitDelay && job) {
    console.log(`[worker] Re-enqueuing job ${job.id} with delay ${err.delayMs}ms.`);
    await emailQueue.add(
      "send-email",
      job.data,
      { jobId: job.data.emailId, delay: err.delayMs }
    );
  } else {
    console.log(`[worker] Job ${job?.id} failed:`, err.message);
  }
});

console.log(`[worker] Started with concurrency=${CONCURRENCY}, hourlyLimit=${HOURLY_LIMIT}, minDelay=${MIN_DELAY_MS}ms`);
