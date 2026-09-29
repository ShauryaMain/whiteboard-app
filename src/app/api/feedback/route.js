// Receives feedback from the "Feedback" dialog on the boards page and
// emails it to the Clean Slate support inbox, screenshots attached.
//
// Needs these environment variables (Vercel → Settings → Environment
// Variables, and .env.local for running it on your computer):
//   FEEDBACK_GMAIL_USER          the Gmail address that sends the email
//                                (cleanslatesupportoffical@gmail.com)
//   FEEDBACK_GMAIL_APP_PASSWORD  a 16-character Google "app password" for it
//   FEEDBACK_TO_EMAIL            optional — where to deliver (defaults below)
// Without them the dialog shows a friendly "email us instead" message.

import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TO = "cleanslatesupportoffical@gmail.com";
const TYPES = {
  improvement: { label: "Improvement", color: "#2451D6" },
  bug: { label: "Bug report", color: "#B3261E" },
  other: { label: "Other", color: "#5F5E5A" },
};
const MAX_MESSAGE = 5000;
const MAX_FILES = 5;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4.2 * 1024 * 1024; // Vercel caps a request at 4.5MB
const RATE_LIMIT = 5; // messages per person per 10 minutes (per server instance)
const RATE_WINDOW_MS = 10 * 60 * 1000;
const recentByUser = new Map();

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clip(value, max) {
  return String(value ?? "").slice(0, max).trim();
}

function tooMany(userId) {
  const now = Date.now();
  const list = (recentByUser.get(userId) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_LIMIT) {
    recentByUser.set(userId, list);
    return true;
  }
  list.push(now);
  recentByUser.set(userId, list);
  return false;
}

async function verifyUser(request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data || !data.user) return null;
  return data.user;
}

function transport(user, pass) {
  // FEEDBACK_SMTP_HOST / _PORT let another mail provider be used instead of Gmail.
  if (process.env.FEEDBACK_SMTP_HOST) {
    const port = Number(process.env.FEEDBACK_SMTP_PORT || 465);
    return nodemailer.createTransport({
      host: process.env.FEEDBACK_SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user, pass },
      tls: process.env.FEEDBACK_SMTP_INSECURE === "1" ? { rejectUnauthorized: false } : undefined,
    });
  }
  return nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
}

function detailRows(rows) {
  return rows
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#5F5E5A;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;color:#18191C">${esc(v)}</td></tr>`
    )
    .join("");
}

export async function POST(request) {
  const smtpUser = process.env.FEEDBACK_GMAIL_USER;
  const smtpPass = process.env.FEEDBACK_GMAIL_APP_PASSWORD;
  if (!smtpUser || !smtpPass) {
    return json({ error: "not_configured", message: "Feedback email isn't set up on the server yet." }, 503);
  }

  const user = await verifyUser(request);
  if (!user) return json({ error: "unauthorized", message: "Please sign in again, then send your feedback." }, 401);
  if (tooMany(user.id)) {
    return json({ error: "rate_limited", message: "That's a lot of feedback in a short time — please try again in a few minutes." }, 429);
  }

  let form;
  try {
    form = await request.formData();
  } catch (err) {
    return json({ error: "bad_request", message: "Couldn't read that feedback — it may be too large." }, 400);
  }

  const type = TYPES[form.get("type")] ? form.get("type") : "other";
  const message = clip(form.get("message"), MAX_MESSAGE);
  if (!message) return json({ error: "empty", message: "Please write a message first." }, 400);
  const title = clip(form.get("title"), 140);
  const area = clip(form.get("area"), 60);
  const impact = clip(form.get("impact"), 60);
  const replyOk = form.get("replyOk") === "1";
  let tech = null;
  try {
    tech = form.get("tech") ? JSON.parse(String(form.get("tech")).slice(0, 4000)) : null;
  } catch (err) {
    tech = null;
  }

  const files = form.getAll("screenshots").filter((f) => f && typeof f === "object" && typeof f.arrayBuffer === "function");
  if (files.length > MAX_FILES) return json({ error: "too_many_files", message: `Up to ${MAX_FILES} screenshots, please.` }, 400);
  let total = 0;
  for (const f of files) {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type || "")) {
      return json({ error: "bad_file", message: "Screenshots need to be PNG, JPG, WEBP or GIF images." }, 400);
    }
    if (f.size > MAX_FILE_BYTES) return json({ error: "file_too_big", message: "One of the screenshots is too large." }, 400);
    total += f.size;
  }
  if (total > MAX_TOTAL_BYTES) return json({ error: "too_big", message: "The screenshots are too large together — try fewer." }, 400);

  const attachments = await Promise.all(
    files.map(async (f, i) => {
      const ext = f.type === "image/jpeg" ? "jpg" : f.type.split("/")[1];
      return {
        filename: `screenshot-${i + 1}.${ext}`,
        content: Buffer.from(await f.arrayBuffer()),
        contentType: f.type,
        cid: `screenshot-${i + 1}@cleanslate`,
      };
    })
  );

  const kind = TYPES[type];
  const firstLine = (title || message.split("\n")[0]).slice(0, 80);
  const subject = `[${kind.label}] ${firstLine}${(title || message.split("\n")[0]).length > 80 ? "…" : ""}`;
  const who = user.email || "unknown user";
  const when = new Date().toUTCString();

  const techRows = tech
    ? [
        ["Page", tech.page],
        ["Browser", tech.userAgent],
        ["Screen", tech.screen],
        ["Window", tech.viewport],
        ["Input", tech.input],
        ["Pencil only", tech.pencilOnly],
        ["Language", tech.language],
        ["Time zone", tech.timeZone],
        ["Boards", tech.boards],
      ]
    : [];

  const html = `<!doctype html><html><body style="margin:0;background:#F4F3EF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<div style="max-width:640px;margin:0 auto;padding:24px 16px">
<div style="background:#FFFFFF;border:1px solid #E4E2DC;border-radius:14px;overflow:hidden">
<div style="padding:18px 22px;border-bottom:1px solid #E4E2DC;display:block">
<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${kind.color};color:#FFFFFF;font-size:12px;font-weight:600">${esc(kind.label)}</span>
<h1 style="margin:10px 0 4px;font-size:19px;line-height:1.3;color:#18191C">${esc(title || firstLine)}</h1>
<div style="font-size:13px;color:#5F5E5A">From ${esc(who)} · ${esc(when)}${replyOk ? " · happy to be emailed back" : " · asked not to be emailed back"}</div>
</div>
<div style="padding:18px 22px;font-size:15px;line-height:1.55;color:#18191C;white-space:pre-wrap">${esc(message)}</div>
${area || impact ? `<div style="padding:0 22px 14px"><table style="border-collapse:collapse;font-size:13px">${detailRows([["Where", area], ["How much it'd help", impact]])}</table></div>` : ""}
${attachments.length ? `<div style="padding:4px 22px 18px">${attachments.map((a) => `<img src="cid:${a.cid}" alt="${esc(a.filename)}" style="display:block;max-width:100%;border:1px solid #E4E2DC;border-radius:8px;margin:10px 0">`).join("")}</div>` : ""}
${techRows.some(([, v]) => v) ? `<div style="padding:14px 22px 18px;border-top:1px solid #E4E2DC;background:#F8F7F4"><div style="font-size:12px;font-weight:600;color:#5F5E5A;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Device details</div><table style="border-collapse:collapse;font-size:12.5px">${detailRows(techRows)}</table></div>` : ""}
</div>
<div style="text-align:center;font-size:12px;color:#9C9B97;margin-top:12px">Sent from the Clean Slate feedback form${replyOk ? " — reply to this email to answer them directly" : ""}.</div>
</div></body></html>`;

  const text = [
    `${kind.label}: ${title || firstLine}`,
    `From: ${who}${replyOk ? " (ok to reply)" : " (asked not to be emailed back)"}`,
    `Sent: ${when}`,
    "",
    message,
    "",
    area ? `Where: ${area}` : "",
    impact ? `How much it'd help: ${impact}` : "",
    techRows.some(([, v]) => v) ? "\nDevice details:\n" + techRows.filter(([, v]) => v).map(([k, v]) => `  ${k}: ${v}`).join("\n") : "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  try {
    await transport(smtpUser, smtpPass).sendMail({
      from: `"Clean Slate Feedback" <${smtpUser}>`,
      to: process.env.FEEDBACK_TO_EMAIL || DEFAULT_TO,
      replyTo: replyOk && user.email ? user.email : undefined,
      subject,
      text,
      html,
      attachments,
    });
  } catch (err) {
    console.error("Feedback email failed:", err && err.message);
    return json({ error: "send_failed", message: "We couldn't send that just now." }, 502);
  }

  return json({ ok: true });
}
