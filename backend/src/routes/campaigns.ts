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
    return res.status(401).json({
      ok: false,
      error: "Not logged in.",
    });
  }

  next();
}

/*
 * Create campaign
 *
 * A campaign is created as SCHEDULED.
 *
 * Each email receives its own scheduledAt time
 * based on:
 *
 * startTime + (index * delayMs)
 */
router.post("/", requireAuth, async (req: any, res) => {
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
  const userId = req.user.id;

  if (Number.isNaN(start.getTime())) {
    return res.status(400).json({
      ok: false,
      error: "Invalid start time.",
    });
  }

  /*
   * Do not allow campaigns to be scheduled
   * in the past.
   */
  if (start.getTime() < Date.now()) {
    return res.status(400).json({
      ok: false,
      error: "Start time must be in the future.",
    });
  }

  try {
    /*
     * Make sure the sender belongs to the
     * authenticated user.
     */
    const sender = await prisma.sender.findFirst({
      where: {
        id: senderId,
        userId,
      },
    });

    if (!sender) {
      return res.status(403).json({
        ok: false,
        error: "Sender does not belong to the current user.",
      });
    }

    /*
     * Create campaign and emails together.
     */
    const campaign = await prisma.campaign.create({
      data: {
        userId,
        senderId,
        subject,
        body,
        startTime: start,
        delayMs,
        hourlyLimit,

        status: "SCHEDULED",

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

    /*
     * Schedule every email in BullMQ.
     *
     * BullMQ will wait until each email's
     * scheduledAt time before processing it.
     */
    for (const email of campaign.emails) {
      const delay = Math.max(
        0,
        email.scheduledAt.getTime() - Date.now()
      );

      await emailQueue.add(
        "send-email",
        {
          emailId: email.id,
        },
        {
          jobId: email.id,
          delay,
        }
      );
    }

    /*
     * Return the complete campaign.
     */
    return res.status(201).json({
      ok: true,
      campaign,
    });
  } catch (err: any) {
    console.error("[campaigns] Create campaign failed:", err);

    return res.status(500).json({
      ok: false,
      error: String(err?.message ?? err),
    });
  }
});

/*
 * Get campaigns for the authenticated user.
 */
router.get("/", requireAuth, async (req: any, res) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: {
        userId: req.user.id,
      },

      include: {
        sender: true,
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
  } catch (err: any) {
    console.error("[campaigns] Get campaigns failed:", err);

    return res.status(500).json({
      ok: false,
      error: String(err?.message ?? err),
    });
  }
});

/*
 * Get one campaign.
 */
router.get("/:id", requireAuth, async (req: any, res) => {
  try {
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id,
      },

      include: {
        sender: true,
        emails: true,
      },
    });

    if (!campaign) {
      return res.status(404).json({
        ok: false,
        error: "Campaign not found.",
      });
    }

    return res.json({
      ok: true,
      campaign,
    });
  } catch (err: any) {
    console.error("[campaigns] Get campaign failed:", err);

    return res.status(500).json({
      ok: false,
      error: String(err?.message ?? err),
    });
  }
});

export default router;
