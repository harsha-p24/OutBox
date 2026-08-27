import "dotenv/config";
import express from "express";
import { prisma } from "./lib/prisma";

const app = express();
const PORT = 3000;

app.use(express.json());

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
