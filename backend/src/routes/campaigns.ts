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

function requireAuth(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ ok: false, error: "Not logged in." });
  }
  next();
}

router.post("/", requireAuth, async (req: any, res) => {
  const parsed = createCampaignSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const { senderId, subject, body, recipients, startTime, delayMs, hourlyLimit } = parsed.data;
  const start = new Date(startTime);
  const userId = req.user.id;

  try {
    const campaign = await prisma.campaign.create({
      data: {
        userId,
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

    for (const email of campaign.emails) {
      const delay = Math.max(0, email.scheduledAt.getTime() - Date.now());
      await emailQueue.add(
        "send-email",
        { emailId: email.id },
        { jobId: email.id, delay }
      );
    }

    res.status(201).json({ ok: true, campaign });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});

router.get("/", requireAuth, async (req: any, res) => {
  const campaigns = await prisma.campaign.findMany({
    where: { userId: req.user.id },
    include: { emails: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ ok: true, campaigns });
});

export default router;
