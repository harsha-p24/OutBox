import express from "express";

const app = express();

const PORT = 3000;

app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    message: "OutBox API is running",
  });
});

app.listen(PORT, () => {
  console.log(`OutBox server running on http://localhost:${PORT}`);
});
