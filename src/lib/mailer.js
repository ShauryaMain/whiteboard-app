// Shared email sender for server routes (uses the same Gmail settings as
// the feedback form). Server-only.

import nodemailer from "nodemailer";

export function mailSettings() {
  const user = (process.env.FEEDBACK_GMAIL_USER || "").trim();
  // Google shows app passwords in groups of four; Gmail wants no spaces.
  const pass = (process.env.FEEDBACK_GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
  return user && pass ? { user, pass } : null;
}

export function createMailer({ user, pass }) {
  if (process.env.FEEDBACK_SMTP_HOST) {
    const port = Number(process.env.FEEDBACK_SMTP_PORT || 465);
    return nodemailer.createTransport({
      host: process.env.FEEDBACK_SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }
  return nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
}
