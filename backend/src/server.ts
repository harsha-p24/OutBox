import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import passport from "./lib/passport";
import { prisma } from "./lib/prisma";
import campaignsRouter from "./routes/campaigns";
import authRouter from "./routes/auth";
import { emailQueue } from "./lib/queue";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";

const app = express();
const PORT = 3000;

app.use(cors({ origin: "http://localhost:3001", credentials: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 },
  })
);

app.use(passport.initialize());
app.use(passport.session());

app.use("/auth", authRouter);
app.use("/campaigns", campaignsRouter);

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");
createBullBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter });
app.use("/admin/queues", serverAdapter.getRouter());

app.get("/", (_req, res) => {
  res.json({ message: "OutBox API is running" });
});

app.get("/health/db", async (_req, res) => {
  try {
    const count = await prisma.user.count();
    res.json({ ok: true, userCount: count });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});

app.listen(PORT, () => {
  console.log(`OutBox server running on http://localhost:${PORT}`);
  console.log(`Bull Board dashboard: http://localhost:${PORT}/admin/queues`);
});
