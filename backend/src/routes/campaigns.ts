import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { emailQueue } from "../lib/queue";
import crypto from "crypto";

const router = Router();

const createCampaignSchema = z.object({
  senderId: z.string(),
  subject: z.string().min(1),
  body: z.string().min(1),
  recipients: z.array(z.string().email()).min(1),
  startTime: z.string().datetime(),
  delayMs: z.number().int().positive(),
  hourlyLimit: z.number().int().positive(),
});

const TEMP_USER_ID = "57b65b78-18bb-41ac-8726-0892a630e139";

router.post("/", async (req, res) => {
  const parsed = createCampaignSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: parsed.error.flatten(),
    });
  }

  const {
    senderId,
    subject,
    body,
    recipients,
    startTime,
    delayMs,
    hourlyLimit,
  } = parsed.data;

  const start = new Date(startTime);

  try {
    const campaign = await prisma.campaign.create({
      data: {
        userId: TEMP_USER_ID,
        senderId,
        subject,
        body,
        startTime: start,
        delayMs,
        hourlyLimit,
        emails: {
          create: recipients.map((recipient, index) => ({
            senderId,
            recipient,
            subject,
            body,
            scheduledAt: new Date(
              start.getTime() + index * delayMs
            ),
            idempotencyKey: crypto.randomUUID(),
          })),
        },
      },
      include: {
        emails: true,
      },
    });

    console.log("[campaign] Campaign created:", {
      campaignId: campaign.id,
      emailCount: campaign.emails.length,
    });

    for (const email of campaign.emails) {
      const delay = Math.max(
        0,
        email.scheduledAt.getTime() - Date.now()
      );

      console.log("[campaign] Adding job:", {
        emailId: email.id,
        scheduledAt: email.scheduledAt,
        delay,
      });

      const job = await emailQueue.add(
        "send-email",
        {
          emailId: email.id,
        },
        {
          jobId: email.id,
          delay,
        }
      );

      console.log("[campaign] Job added:", {
        jobId: job.id,
        name: job.name,
        emailId: email.id,
      });
    }

    console.log("[campaign] Queue counts after scheduling:", {
      ...(await emailQueue.getJobCounts()),
    });

    return res.status(201).json({
      ok: true,
      campaign,
    });
  } catch (err: any) {
    console.error("[campaign] Error:", err);

    return res.status(500).json({
      ok: false,
      error: String(err?.message ?? err),
    });
  }
});

router.get("/", async (_req, res) => {
  const campaigns = await prisma.campaign.findMany({
    include: {
      emails: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return res.json({
    ok: true,
    campaigns,
  });
});

export default router;
