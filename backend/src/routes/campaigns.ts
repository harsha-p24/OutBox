import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
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
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const { senderId, subject, body, recipients, startTime, delayMs, hourlyLimit } = parsed.data;

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
            scheduledAt: new Date(start.getTime() + index * delayMs),
            idempotencyKey: crypto.randomUUID(),
          })),
        },
      },
      include: { emails: true },
    });

    res.status(201).json({ ok: true, campaign });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});

router.get("/", async (_req, res) => {
  const campaigns = await prisma.campaign.findMany({
    include: { emails: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ ok: true, campaigns });
});

export default router;
