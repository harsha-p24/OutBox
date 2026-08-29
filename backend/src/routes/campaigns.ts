import { Router } from "express";
import crypto from "crypto";

import { prisma } from "../lib/prisma";
import { emailQueue } from "../lib/queue";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const {
      userId,
      senderId,
      subject,
      body,
      recipients,
      startTime,
      delayMs,
      hourlyLimit,
    } = req.body;

    if (!userId) {
      return res.status(400).json({
        error: "userId is required",
      });
    }

    if (!senderId) {
      return res.status(400).json({
        error: "senderId is required",
      });
    }

    if (!subject) {
      return res.status(400).json({
        error: "subject is required",
      });
    }

    if (!body) {
      return res.status(400).json({
        error: "body is required",
      });
    }

    if (
      !Array.isArray(recipients) ||
      recipients.length === 0
    ) {
      return res.status(400).json({
        error: "At least one recipient is required",
      });
    }

    const delayMsValue = Number(delayMs ?? 2000);
    const hourlyLimitValue = Number(hourlyLimit ?? 100);

    const start = startTime
      ? new Date(startTime)
      : new Date(Date.now() + 10000);

    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({
        error: "Invalid startTime",
      });
    }

    if (delayMsValue < 0) {
      return res.status(400).json({
        error: "delayMs cannot be negative",
      });
    }

    if (hourlyLimitValue < 1) {
      return res.status(400).json({
        error: "hourlyLimit must be at least 1",
      });
    }

    const sender = await prisma.sender.findUnique({
      where: {
        id: senderId,
      },
    });

    if (!sender) {
      return res.status(404).json({
        error: "Sender not found",
      });
    }

    const campaign = await prisma.campaign.create({
      data: {
        userId,
        senderId,
        subject,
        body,
        startTime: start,
        delayMs: delayMsValue,
        hourlyLimit: hourlyLimitValue,
        status: "SCHEDULED",

        emails: {
          create: recipients.map(
            (recipient: string, index: number) => ({
              senderId,
              recipient: String(recipient).trim(),
              subject,
              body,

              scheduledAt: new Date(
                start.getTime() +
                  index * delayMsValue
              ),

              idempotencyKey: crypto.randomUUID(),
            })
          ),
        },
      },

      include: {
        emails: true,
      },
    });

    for (const email of campaign.emails) {
      const jobDelay = Math.max(
        0,
        email.scheduledAt.getTime() -
          Date.now()
      );

      await emailQueue.add(
        "send-email",
        {
          emailId: email.id,
        },
        {
          jobId: email.id,
          delay: jobDelay,
          removeOnComplete: true,
          removeOnFail: false,
        }
      );
    }

    return res.status(201).json({
      success: true,

      campaign: {
        id: campaign.id,
        status: campaign.status,
        startTime: campaign.startTime,
        delayMs: campaign.delayMs,
        hourlyLimit: campaign.hourlyLimit,
      },

      emails: campaign.emails.map(
        (email) => ({
          id: email.id,
          recipient: email.recipient,
          status: email.status,
          scheduledAt: email.scheduledAt,
        })
      ),
    });
  } catch (error) {
    console.error(
      "[campaigns] Failed to create campaign:",
      error
    );

    return res.status(500).json({
      error: "Failed to create campaign",
    });
  }
});

router.get("/", async (req, res) => {
  try {
    const userId = req.query.userId
      ? String(req.query.userId)
      : undefined;

    const campaigns =
      await prisma.campaign.findMany({
        where: userId
          ? {
              userId,
            }
          : undefined,

        orderBy: {
          createdAt: "desc",
        },

        include: {
          sender: true,

          emails: {
            orderBy: {
              scheduledAt: "asc",
            },
          },
        },
      });

    return res.json(campaigns);
  } catch (error) {
    console.error(
      "[campaigns] Failed to fetch campaigns:",
      error
    );

    return res.status(500).json({
      error: "Failed to fetch campaigns",
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const campaign =
      await prisma.campaign.findUnique({
        where: {
          id: req.params.id,
        },

        include: {
          sender: true,

          emails: {
            orderBy: {
              scheduledAt: "asc",
            },
          },
        },
      });

    if (!campaign) {
      return res.status(404).json({
        error: "Campaign not found",
      });
    }

    return res.json(campaign);
  } catch (error) {
    console.error(
      "[campaigns] Failed to fetch campaign:",
      error
    );

    return res.status(500).json({
      error: "Failed to fetch campaign",
    });
  }
});

export default router;
