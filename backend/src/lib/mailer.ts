import nodemailer from "nodemailer";

export function createTransport(smtpUser: string, smtpPass: string) {
  return nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });
}
