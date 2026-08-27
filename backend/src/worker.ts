import "dotenv/config";
import { Worker, Job } from "bullmq";
import { connection } from "./lib/redis";
import { emailQueue } from "./lib/queue";
import { prisma } from "./lib/prisma";
import { tryConsume, msUntilNextHour } from "./lib/rateLimiter";

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

    const email = await prisma.email.findUnique({ where: { id: emailId } });
    if (!email) {
      console.log(`[worker] Email ${emailId} not found in DB, skipping.`);
      return;
    }

    // Idempotency: never resend something already sent
    if (email.status === "SENT") {
      console.log(`[worker] Email ${emailId} already SENT, skipping.`);
      return;
    }

    // Rate limit check (atomic Redis counter, safe across concurrent workers)
    const allowed = await tryConsume(email.senderId, HOURLY_LIMIT);
    if (!allowed) {
      console.log(`[worker] Sender ${email.senderId} hit hourly limit. Rescheduling.`);
      throw new RateLimitDelay(msUntilNextHour());
    }

    // Mark as SENDING before attempting to send
    await prisma.email.update({
      where: { id: email.id },
      data: { status: "PROCESSING" },
    });

    try {
      // --- STUB: real Ethereal sending comes in Step 8 ---
      console.log(`[worker] Sending email ${email.id} to ${email.recipient}...`);
      await new Promise((r) => setTimeout(r, 200)); // simulate send latency

      await prisma.email.update({
        where: { id: email.id },
        data: { status: "SENT", sentAt: new Date() },
      });
      console.log(`[worker] Email ${email.id} marked SENT.`);
    } catch (err: any) {
      await prisma.email.update({
        where: { id: email.id },
        data: { status: "FAILED", errorMessage: String(err?.message ?? err) },
      });
      throw err;
    }

    // Throttle: minimum delay between sends
    await new Promise((r) => setTimeout(r, MIN_DELAY_MS));
  },
  { connection, concurrency: CONCURRENCY }
);

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
