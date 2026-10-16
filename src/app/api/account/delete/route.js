// POST /api/account/delete — deletes the signed-in teacher's account and
// everything they own (see src/lib/accountDelete.js).
//
// The page sends the person's sign-in token (Authorization: Bearer …) and
// { confirm: "delete" }. Only that person's own account can be deleted.
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (already set
// up for the board clean-up).

import { createClient } from "@supabase/supabase-js";
import { deleteAccount } from "@/lib/accountDelete";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// a teacher with many boards takes a while to clear
export const maxDuration = 60;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Only this site's own pages (same check as the email-code route).
function fromThisSite(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let host;
  try {
    host = new URL(origin).host;
  } catch (err) {
    return false;
  }
  const own = [request.headers.get("x-forwarded-host"), request.headers.get("host"), new URL(request.url).host];
  if (process.env.APP_URL) {
    try {
      own.push(new URL(process.env.APP_URL).host);
    } catch (err) {
      // ignore a badly written APP_URL
    }
  }
  return own.some((h) => h && h.split(",")[0].trim() === host);
}

export async function POST(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return json({ error: "not_configured" }, 503);

  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().startsWith("application/json") || !fromThisSite(request)) return json({ error: "bad_request" }, 400);
  const auth = request.headers.get("authorization") || "";
  const token = /^Bearer\s+(.+)$/i.exec(auth);
  if (!token) return json({ error: "signed_out" }, 401);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "bad_request" }, 400);
  }
  if (!body || String(body.confirm || "").trim().toLowerCase() !== "delete") return json({ error: "not_confirmed" }, 400);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.getUser(token[1].trim());
  const user = data && data.user;
  if (error || !user) return json({ error: "signed_out" }, 401);

  try {
    const result = await deleteAccount({ admin, userId: user.id, email: user.email });
    return json({ ok: true, boards: result.boards });
  } catch (err) {
    console.error("account delete:", err && err.message);
    return json({ error: "failed" }, 500);
  }
}
