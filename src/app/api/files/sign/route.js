// POST /api/files/sign — links to stored files (pictures, PDFs, homework
// pages, previews, fonts) that work for a few hours.
//
// The storage buckets are private (see claude/security-overhaul-status.md),
// so a file's plain address doesn't open it. The page asks here instead:
//
//   body    { files: ["board-images/<board>/<file>", …], token? }
//           token: a notebook's reading link, for someone reading it by link
//   header  Authorization: Bearer <sign-in token>, when signed in (students
//           in a live class have an invisible sign-in)
//   answer  { urls: { "<bucket>/<path>": "<signed address>", … }, expiresIn }
//           files the person may not open are simply left out
//
// Who may open what is decided by the database (file_access in
// supabase/2026-11-security.sql), asked as the person themselves. The
// links are then made with the service-role key.
//
// Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY (all already set up).

import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPIRES_IN = 12 * 60 * 60; // seconds
const MAX_FILES = 300;
const BUCKETS = new Set(["board-images", "reference-docs"]);
const PATH = /^[A-Za-z0-9][A-Za-z0-9/_.\- ]{0,399}$/;

// A brake on one address asking very often (per server copy).
const recent = new Map();
const PER_MINUTE = 240;
function tooMany(ip) {
  if (!ip) return false;
  const now = Date.now();
  const list = (recent.get(ip) || []).filter((t) => now - t < 60000);
  list.push(now);
  recent.set(ip, list);
  if (recent.size > 5000) recent.clear();
  return list.length > PER_MINUTE;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function cleanList(files) {
  if (!Array.isArray(files)) return null;
  const out = [];
  const seen = new Set();
  for (const f of files.slice(0, MAX_FILES)) {
    if (typeof f !== "string") continue;
    const slash = f.indexOf("/");
    if (slash < 1) continue;
    const bucket = f.slice(0, slash);
    const path = f.slice(slash + 1);
    if (!BUCKETS.has(bucket) || !PATH.test(path) || path.includes("..") || seen.has(f)) continue;
    seen.add(f);
    out.push(f);
  }
  return out;
}

export async function POST(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) return json({ error: "not_configured" }, 503);

  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().startsWith("application/json")) return json({ error: "bad_request" }, 400);
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "";
  if (tooMany(ip)) return json({ error: "rate_limited" }, 429);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "bad_request" }, 400);
  }
  const files = cleanList(body && body.files);
  if (!files) return json({ error: "bad_request" }, 400);
  if (!files.length) return json({ urls: {}, expiresIn: EXPIRES_IN });
  const token = body && typeof body.token === "string" && /^[A-Za-z0-9]{16,64}$/.test(body.token) ? body.token : null;

  // Asked as the person: their sign-in token goes with the question, so
  // the database knows who they are (or that they aren't signed in).
  const auth = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") || "");
  const asPerson = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: auth ? { headers: { Authorization: `Bearer ${auth[1].trim()}` } } : {},
  });
  const { data: allowed, error } = await asPerson.rpc("file_access", { p_files: files, p_token: token });
  if (error) {
    // a sign-in that has run out: the page signs in again and asks again
    if (error.code === "PGRST301" || /jwt/i.test(error.message || "")) return json({ error: "signed_out" }, 401);
    console.error("files/sign: couldn't check access:", error.message || error.code);
    return json({ error: "failed" }, 502);
  }

  const byBucket = new Map();
  for (const f of allowed || []) {
    const slash = f.indexOf("/");
    const bucket = f.slice(0, slash);
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket).push(f.slice(slash + 1));
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const urls = {};
  for (const [bucket, paths] of byBucket) {
    const { data, error: signError } = await admin.storage.from(bucket).createSignedUrls(paths, EXPIRES_IN);
    if (signError) {
      console.error("files/sign: couldn't sign:", signError.message || signError);
      continue;
    }
    for (const item of data || []) {
      if (item && item.signedUrl && item.path && !item.error) urls[`${bucket}/${item.path}`] = item.signedUrl;
    }
  }
  return json({ urls, expiresIn: EXPIRES_IN });
}
