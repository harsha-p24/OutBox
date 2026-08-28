import { Router } from "express";
import passport from "../lib/passport";

const router = Router();

// Kicks off the Google login flow
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

// Google redirects back here after the user approves
router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/auth/failure",
    successRedirect: "/auth/success",
  })
);

router.get("/success", (req, res) => {
  res.json({ ok: true, user: req.user });
});

router.get("/failure", (_req, res) => {
  res.status(401).json({ ok: false, error: "Google login failed." });
});

// Returns the currently logged-in user, or null
router.get("/me", (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ ok: true, user: req.user });
  } else {
    res.json({ ok: true, user: null });
  }
});

router.post("/logout", (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ ok: false, error: String(err) });
    res.json({ ok: true });
  });
});

export default router;
