// Sign in with a code sent by email (for anyone who'd rather not use
// Google, or whose school blocks it).
//
//   GET   { available }   whether codes can be sent (the settings below exist)
//   POST  { email }       sends a 6-digit code to that address
//
// The code comes from Supabase (Auth "generate link"), which also creates
// the account the first time an address is used. It's sent from the
// support Gmail account, the same way as the board clean-up emails
// (src/lib/mailer.js). The page then checks it with Supabase directly
// (auth.verifyOtp), which signs the person in.
//
// Needs (already set up for the board clean-up):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   FEEDBACK_GMAIL_USER, FEEDBACK_GMAIL_APP_PASSWORD
//   APP_URL (optional: the app's address, for the link in the email)

import { createClient } from "@supabase/supabase-js";
import { createMailer, mailSettings } from "@/lib/mailer";
import { BRAND_MARK_PNG_BASE64 } from "@/lib/emailBrandMark";
import { signInCodeEmail } from "@/lib/codeEmail";
import { cleanEmail, createLimiter } from "@/lib/emailCodeLimits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createLimiter();

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function settings() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const mail = mailSettings();
  return url && serviceKey && mail ? { url, serviceKey, mail } : null;
}

function clientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  return forwarded.split(",")[0].trim() || request.headers.get("x-real-ip") || "";
}

// Only this site's own pages may ask for a code (stops other websites from
// making their visitors' browsers send codes). Browsers always send Origin
// with a POST.
function fromThisSite(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let host;
  try {
    host = new URL(origin).host;
  } catch (err) {
    return false;
  }
  const own = [
    request.headers.get("x-forwarded-host"),
    request.headers.get("host"),
    new URL(request.url).host,
  ];
  if (process.env.APP_URL) {
    try {
      own.push(new URL(process.env.APP_URL).host);
    } catch (err) {
      // a badly written APP_URL just doesn't count
    }
  }
  return own.some((h) => h && h.split(",")[0].trim() === host);
}

export async function GET() {
  return json({ available: Boolean(settings()) });
}

export async function POST(request) {
  const config = settings();
  if (!config) return json({ error: "not_configured" }, 503);

  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().startsWith("application/json") || !fromThisSite(request)) {
    return json({ error: "bad_request" }, 400);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "bad_request" }, 400);
  }
  const email = cleanEmail(body && body.email);
  if (!email) return json({ error: "bad_email" }, 400);

  const ip = clientIp(request);
  // counted now, before any waiting, and kept even if the send fails
  const allowed = limiter.take(email, ip);
  if (!allowed.ok) return json({ error: "rate_limited", reason: allowed.reason, retryAfter: allowed.retryAfter }, 429);

  const admin = createClient(config.url, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const code = data && data.properties ? data.properties.email_otp : null;
  if (error || !code) {
    console.error("email code: couldn't make a code:", error ? error.message : "no code returned");
    return json({ error: "send_failed" }, 502);
  }

  const appUrl = (process.env.APP_URL || new URL(request.url).origin).replace(/\/+$/, "");
  const logoCid = "clean-slate-logo";
  const message = signInCodeEmail({ code, appUrl, logoCid });
  try {
    await createMailer(config.mail).sendMail({
      from: `"Clean Slate" <${config.mail.user}>`,
      to: email,
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments: [
        { filename: "clean-slate.png", content: Buffer.from(BRAND_MARK_PNG_BASE64, "base64"), contentType: "image/png", cid: logoCid },
      ],
    });
  } catch (err) {
    console.error("email code: couldn't send the email:", err && err.message);
    return json({ error: "send_failed" }, 502);
  }
  return json({ ok: true });
}
