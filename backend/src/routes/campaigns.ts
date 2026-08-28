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
 * Create campaign.
 *
 * New campaign starts as SCHEDULED.
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

  if (start.getTime() < Date.now()) {
    return res.status(400).json({
      ok: false,
      error: "Start time must be in the future.",
    });
  }

  try {
    /*
     * Make sure sender belongs to current user.
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
     * Create campaign and emails.
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
     * Add every email to BullMQ.
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
 * Get all campaigns for current user.
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
    console.error(
      "[campaigns] Get campaign failed:",
      err
    );

    return res.status(500).json({
      ok: false,
      error: String(err?.message ?? err),
    });
  }
});

/*
 * PAUSE CAMPAIGN
 *
 * Only SCHEDULED campaigns can be paused.
 *
 * We remove waiting BullMQ jobs and mark the
 * campaign as DRAFT so it can be resumed later.
 */
router.post(
  "/:id/pause",
  requireAuth,
  async (req: any, res) => {
    try {
      const campaign = await prisma.campaign.findFirst({
        where: {
          id: req.params.id,
          userId: req.user.id,
        },

        include: {
          emails: true,
        },
      });

      if (!campaign) {
        return res.status(404).json({
          ok: false,
          error: "Campaign not found.",
        });
      }

      if (campaign.status !== "SCHEDULED") {
        return res.status(400).json({
          ok: false,
          error:
            `Campaign cannot be paused from ${campaign.status} status.`,
        });
      }

      /*
       * Remove queued jobs.
       *
       * SENT emails have already completed and do not
       * need to be removed.
       */
      for (const email of campaign.emails) {
        if (email.status === "SCHEDULED") {
          try {
            await emailQueue.remove(email.id);
          } catch (queueError) {
            console.error(
              `[campaigns] Failed to remove job ${email.id}:`,
              queueError
            );
          }
        }
      }

      const updatedCampaign =
        await prisma.campaign.update({
          where: {
            id: campaign.id,
          },

          data: {
            status: "DRAFT",
          },

          include: {
            emails: true,
          },
        });

      return res.json({
        ok: true,
        message: "Campaign paused.",
        campaign: updatedCampaign,
      });
    } catch (err: any) {
      console.error(
        "[campaigns] Pause campaign failed:",
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
 * RESUME CAMPAIGN
 *
 * A DRAFT campaign can be resumed.
 *
 * Only emails that have not already been sent are
 * added back to BullMQ.
 */
router.post(
  "/:id/resume",
  requireAuth,
  async (req: any, res) => {
    try {
      const campaign = await prisma.campaign.findFirst({
        where: {
          id: req.params.id,
          userId: req.user.id,
        },

        include: {
          emails: true,
        },
      });

      if (!campaign) {
        return res.status(404).json({
          ok: false,
          error: "Campaign not found.",
        });
      }

      if (campaign.status !== "DRAFT") {
        return res.status(400).json({
          ok: false,
          error:
            `Campaign cannot be resumed from ${campaign.status} status.`,
        });
      }

      /*
       * Resume campaign.
       */
      const updatedCampaign =
        await prisma.campaign.update({
          where: {
            id: campaign.id,
          },

          data: {
            status: "SCHEDULED",
          },

          include: {
            emails: true,
          },
        });

      /*
       * Re-add unsent emails to BullMQ.
       *
       * Emails whose scheduled time has already passed
       * are queued immediately.
       */
      for (const email of updatedCampaign.emails) {
        if (email.status !== "SCHEDULED") {
          continue;
        }

        const delay = Math.max(
          0,
          email.scheduledAt.getTime() - Date.now()
        );

        try {
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
        } catch (queueError: any) {
          /*
           * If the job already exists, do not fail the
           * whole resume operation.
           */
          console.error(
            `[campaigns] Failed to queue email ${email.id}:`,
            queueError
          );
        }
      }

      return res.json({
        ok: true,
        message: "Campaign resumed.",
        campaign: updatedCampaign,
      });
    } catch (err: any) {
      console.error(
        "[campaigns] Resume campaign failed:",
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
 * CANCEL CAMPAIGN
 *
 * A campaign can be cancelled while it is SCHEDULED
 * or DRAFT.
 *
 * We delete pending BullMQ jobs and mark the campaign
 * as FAILED because the current schema does not have
 * a CANCELLED status.
 */
router.post(
  "/:id/cancel",
  requireAuth,
  async (req: any, res) => {
    try {
      const campaign = await prisma.campaign.findFirst({
        where: {
          id: req.params.id,
          userId: req.user.id,
        },

        include: {
          emails: true,
        },
      });

      if (!campaign) {
        return res.status(404).json({
          ok: false,
          error: "Campaign not found.",
        });
      }

      if (
        campaign.status !== "SCHEDULED" &&
        campaign.status !== "DRAFT"
      ) {
        return res.status(400).json({
          ok: false,
          error:
            `Campaign cannot be cancelled from ${campaign.status} status.`,
        });
      }

      /*
       * Remove pending BullMQ jobs.
       */
      for (const email of campaign.emails) {
        if (email.status === "SCHEDULED") {
          try {
            await emailQueue.remove(email.id);
          } catch (queueError) {
            console.error(
              `[campaigns] Failed to remove job ${email.id}:`,
              queueError
            );
          }
        }
      }

      /*
       * Current schema does not have CANCELLED.
       *
       * Therefore FAILED is used to represent a
       * campaign that was stopped by the user.
       */
      const updatedCampaign =
        await prisma.campaign.update({
          where: {
            id: campaign.id,
          },

          data: {
            status: "FAILED",
          },

          include: {
            emails: true,
          },
        });

      return res.json({
        ok: true,
        message: "Campaign cancelled.",
        campaign: updatedCampaign,
      });
    } catch (err: any) {
      console.error(
        "[campaigns] Cancel campaign failed:",
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
