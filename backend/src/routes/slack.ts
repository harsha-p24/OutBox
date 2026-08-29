import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ ok: false, error: "Not logged in." });
  }
  next();
}

router.get("/connect", requireAuth, (req: any, res) => {
  const state = req.user.id;
  const url =
    `https://slack.com/oauth/v2/authorize` +
    `?client_id=${process.env.SLACK_CLIENT_ID}` +
    `&scope=incoming-webhook` +
    `&redirect_uri=${encodeURIComponent(process.env.SLACK_REDIRECT_URI!)}` +
    `&state=${state}`;
  res.redirect(url);
});

router.get("/callback", async (req, res) => {
  const { code, state } = req.query as { code: string; state: string };

  if (!code || !state) {
    return res.status(400).send("Missing code or state from Slack.");
  }

  try {
    const response = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID!,
        client_secret: process.env.SLACK_CLIENT_SECRET!,
        code,
        redirect_uri: process.env.SLACK_REDIRECT_URI!,
      }),
    });

    const data: any = await response.json();

    if (!data.ok) {
      console.error("[slack] OAuth exchange failed:", data);
      return res.status(400).send(`Slack connection failed: ${data.error}`);
    }

    await prisma.slackConnection.upsert({
      where: { userId: state },
      create: {
        userId: state,
        accessToken: data.access_token,
        webhookUrl: data.incoming_webhook?.url ?? null,
        teamId: data.team?.id ?? null,
      },
      update: {
        accessToken: data.access_token,
        webhookUrl: data.incoming_webhook?.url ?? null,
        teamId: data.team?.id ?? null,
      },
    });

    res.redirect(`${process.env.FRONTEND_URL}/dashboard?slack=connected`);
  } catch (err: any) {
    console.error("[slack] Callback error:", err);
    res.status(500).send("Something went wrong connecting Slack.");
  }
});

router.get("/status", requireAuth, async (req: any, res) => {
  const connection = await prisma.slackConnection.findUnique({
    where: { userId: req.user.id },
  });
  res.json({ ok: true, connected: !!connection?.webhookUrl });
});

export default router;
