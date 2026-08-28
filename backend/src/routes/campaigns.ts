import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { emailQueue } from "../lib/queue";
import crypto from "crypto";
import {
  elasticsearch,
  EMAIL_INDEX,
  ensureEmailIndex,
} from "../lib/elasticsearch";

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
 * Create a campaign and schedule all emails.
 */
router.post("/", requireAuth, async (req: any, res: any) => {
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

  try {
    /*
     * Create campaign and all email records
     * inside the database.
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
     * Make sure Elasticsearch index exists.
     *
     * If Elasticsearch is temporarily unavailable,
     * campaign creation should still not crash.
     */
    try {
      await ensureEmailIndex();
    } catch (error) {
      console.error(
        "[campaigns] Elasticsearch initialization failed:",
        error
      );
    }

    /*
     * Add every email to BullMQ as a delayed job.
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
     * Index the newly created emails in Elasticsearch.
     *
     * Elasticsearch is used for searching emails.
     *
     * We intentionally don't fail the campaign if indexing
     * fails because PostgreSQL remains the source of truth.
     */
    try {
      await Promise.all(
        campaign.emails.map(async (email) => {
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
          });
        })
      );

      console.log(
        `[campaigns] Indexed ${campaign.emails.length} emails in Elasticsearch.`
      );
    } catch (indexError) {
      console.error(
        "[campaigns] Failed to index emails in Elasticsearch:",
        indexError
      );
    }

    return res.status(201).json({
      ok: true,
      campaign,
    });
  } catch (err: any) {
    console.error(
      "[campaigns] Create campaign failed:",
      err
    );

    return res.status(500).json({
      ok: false,
      error: String(err?.message ?? err),
    });
  }
});

/*
 * Get campaigns for the logged-in user.
 */
router.get("/", requireAuth, async (req: any, res: any) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: {
        userId: req.user.id,
      },

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
  } catch (err: any) {
    console.error(
      "[campaigns] Get campaigns failed:",
      err
    );

    return res.status(500).json({
      ok: false,
      error: String(err?.message ?? err),
    });
  }
});

/*
 * Get campaign statistics.
 */
router.get(
  "/:id/stats",
  requireAuth,
  async (req: any, res: any) => {
    try {
      const campaign = await prisma.campaign.findFirst({
        where: {
          id: req.params.id,
          userId: req.user.id,
        },

        select: {
          id: true,
          status: true,

          emails: {
            select: {
              status: true,
            },
          },
        },
      });

      if (!campaign) {
        return res.status(404).json({
          ok: false,
          error: "Campaign not found.",
        });
      }

      const total = campaign.emails.length;

      const scheduled = campaign.emails.filter(
        (email) => email.status === "SCHEDULED"
      ).length;

      const processing = campaign.emails.filter(
        (email) => email.status === "PROCESSING"
      ).length;

      const sent = campaign.emails.filter(
        (email) => email.status === "SENT"
      ).length;

      const failed = campaign.emails.filter(
        (email) => email.status === "FAILED"
      ).length;

      const completed = sent + failed;

      const progress =
        total === 0
          ? 0
          : Math.round((completed / total) * 100);

      return res.json({
        ok: true,

        stats: {
          total,
          scheduled,
          processing,
          sent,
          failed,
          completed,
          progress,
          campaignStatus: campaign.status,
        },
      });
    } catch (err: any) {
      console.error(
        "[campaigns] Get campaign stats failed:",
        err
      );

      return res.status(500).json({
        ok: false,
        error: String(err?.message ?? err),
      });
    }
  }
);

/*
 * Get email logs for a campaign.
 */
router.get(
  "/:id/emails",
  requireAuth,
  async (req: any, res: any) => {
    try {
      const campaign = await prisma.campaign.findFirst({
        where: {
          id: req.params.id,
          userId: req.user.id,
        },

        select: {
          id: true,
        },
      });

      if (!campaign) {
        return res.status(404).json({
          ok: false,
          error: "Campaign not found.",
        });
      }

      const status = req.query.status as
        | "SCHEDULED"
        | "PROCESSING"
        | "SENT"
        | "FAILED"
        | undefined;

      const emails = await prisma.email.findMany({
        where: {
          campaignId: campaign.id,

          ...(status
            ? {
                status,
              }
            : {}),
        },

        select: {
          id: true,
          recipient: true,
          subject: true,
          status: true,
          scheduledAt: true,
          sentAt: true,
          messageId: true,
          errorMessage: true,
          createdAt: true,
          updatedAt: true,
        },

        orderBy: {
          scheduledAt: "asc",
        },
      });

      return res.json({
        ok: true,
        emails,
      });
    } catch (err: any) {
      console.error(
        "[campaigns] Get email logs failed:",
        err
      );

      return res.status(500).json({
        ok: false,
        error: String(err?.message ?? err),
      });
    }
  }
);

export default router;
