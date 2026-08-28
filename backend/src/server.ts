import "dotenv/config";
import express from "express";
import session from "express-session";
import passport from "./lib/passport";
import { prisma } from "./lib/prisma";
import campaignsRouter from "./routes/campaigns";
import authRouter from "./routes/auth";

const app = express();
const PORT = 3000;

app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }, // 1 day
  })
);

app.use(passport.initialize());
app.use(passport.session());

app.use("/auth", authRouter);
app.use("/campaigns", campaignsRouter);

app.get("/", (_req, res) => {
  res.json({
    message: "OutBox API is running",
  });
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
});
