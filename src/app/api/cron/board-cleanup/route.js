// Daily inactive-board clean-up, run by Vercel Cron (see vercel.json).
// The rules and the steps live in src/lib/boardCleanup.js.
//
// Needs these environment variables in Vercel (Settings → Environment
// Variables, Production):
//   CRON_SECRET                 any long random string — Vercel sends it
//                               with each scheduled run so nobody else can
//                               trigger this (also signs "Keep" links)
//   SUPABASE_SERVICE_ROLE_KEY   Supabase → Project Settings → API keys →
//                               service_role / secret key (keep it secret)
//   FEEDBACK_GMAIL_USER / FEEDBACK_GMAIL_APP_PASSWORD   (already set up
//                               for the feedback form; used to send email)
//   APP_URL                     optional, e.g. https://whiteboard-app-beta.vercel.app
//
// Try it safely without sending or deleting anything:
//   curl -H "Authorization: Bearer <CRON_SECRET>" "<APP_URL>/api/cron/board-cleanup?dry=1"

import { createClient } from "@supabase/supabase-js";
import { runBoardCleanup } from "@/lib/boardCleanup";
import { createMailer, mailSettings } from "@/lib/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json" } });
}

export async function GET(request) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return json({ error: "unauthorized" }, 401);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return json({ error: "not_configured", missing: "SUPABASE_SERVICE_ROLE_KEY" }, 503);
  const mail = mailSettings();
  if (!mail) return json({ error: "not_configured", missing: "FEEDBACK_GMAIL_USER / FEEDBACK_GMAIL_APP_PASSWORD" }, 503);

  const params = new URL(request.url).searchParams;
  const dry = params.get("dry") === "1";
  const appUrl = (process.env.APP_URL || new URL(request.url).origin).replace(/\/+$/, "");
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const mailer = createMailer(mail);

  const report = await runBoardCleanup({
    admin,
    sendMail: (message) => mailer.sendMail(message),
    from: `"Clean Slate" <${mail.user}>`,
    appUrl,
    secret: process.env.BOARD_KEEP_SECRET || secret,
    dry,
  });
  // Shows up in Vercel → Logs for each daily run.
  console.log("board clean-up:", JSON.stringify({
    dry,
    deleted: report.deleted.length,
    kept: report.kept.length,
    emailed: report.emailed.length,
    skipped: report.skipped.length,
    errors: report.errors,
  }));
  return json(report, report.errors.length && !report.deleted.length && !report.emailed.length ? 500 : 200);
}
