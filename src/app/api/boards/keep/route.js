// "Keep this board" from the clean-up warning email.
// GET shows a confirm page (so email link-scanners that open every link
// don't keep boards by accident); its button POSTs back here to keep it.
// No sign-in needed: the link carries a signature for that one board.

import { createClient } from "@supabase/supabase-js";
import { verifyKeep, keepSecret } from "@/lib/keepToken";
import { esc } from "@/lib/cleanupEmail";
import { BRAND_MARK_PNG_BASE64 } from "@/lib/emailBrandMark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function page({ title, body, action }) {
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} · Clean Slate</title>
<link rel="icon" href="data:image/png;base64,${BRAND_MARK_PNG_BASE64}">
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px;
    background: #F4F3EF; color: #18191C; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .card { width: min(100%, 420px); background: #FFFFFF; border: 1px solid #E4E2DC; border-radius: 14px;
    box-shadow: 0 12px 32px rgba(0,0,0,.08); padding: 28px 26px 24px; text-align: center; }
  .brand { display: inline-flex; align-items: center; gap: 10px; font-weight: 700; font-size: 16px; margin-bottom: 22px; }
  .brand img { width: 30px; height: 30px; border-radius: 8px; }
  h1 { font-size: 21px; line-height: 1.3; margin: 0 0 10px; }
  p { font-size: 15px; line-height: 1.55; color: #5F5E5A; margin: 0 0 20px; }
  .btn { display: block; width: 100%; min-height: 46px; border: 0; border-radius: 10px; background: #2451D6; color: #fff;
    font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; text-decoration: none; line-height: 46px; }
  .btn:hover { background: #1A3CA3; }
  .btn.secondary { background: #FFFFFF; color: #18191C; border: 1px solid #E4E2DC; margin-top: 10px; }
  .btn.secondary:hover { background: #F0EFEA; }
</style>
</head><body>
<main class="card">
  <div class="brand"><img src="data:image/png;base64,${BRAND_MARK_PNG_BASE64}" alt="">Clean Slate</div>
  <h1>${esc(title)}</h1>
  ${body}
  ${action || ""}
</main>
</body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function findBoard(db, id) {
  const { data, error } = await db.from("boards").select("id, name").eq("id", id).maybeSingle();
  if (error) return { error };
  return { board: data };
}

function badLink() {
  return page({
    title: "This link doesn't work",
    body: "<p>It may have been copied incompletely. Opening the board from your boards page keeps it too.</p>",
    action: `<a class="btn" href="/">Go to my boards</a>`,
  });
}

function gone() {
  return page({
    title: "This board has already been deleted",
    body: "<p>It went unused for over 30 days, so it was cleared away. Sorry about that — new boards are always one tap away.</p>",
    action: `<a class="btn" href="/">Go to my boards</a>`,
  });
}

function read(params) {
  const id = String(params.get("b") || "");
  const token = String(params.get("t") || "");
  return { id, token, valid: verifyKeep(id, token, keepSecret()) };
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const { id, token, valid } = read(params);
  if (!valid) return badLink();
  const db = admin();
  if (!db) return badLink();
  const { board, error } = await findBoard(db, id);
  if (error) return badLink();
  if (!board) return gone();
  const query = new URLSearchParams({ b: id, t: token }).toString();
  return page({
    title: `Keep “${board.name || "Untitled board"}”?`,
    body: "<p>It hasn't been used in a while, so it's due to be deleted. Keep it and it'll stay — nothing else changes.</p>",
    action: `<form method="post" action="/api/boards/keep?${esc(query)}"><button class="btn" type="submit">Keep this board</button></form>
  <a class="btn secondary" href="/board/${esc(encodeURIComponent(id))}">Open it instead</a>`,
  });
}

export async function POST(request) {
  const params = new URL(request.url).searchParams;
  const { id, valid } = read(params);
  if (!valid) return badLink();
  const db = admin();
  if (!db) return badLink();
  const { data, error } = await db
    .from("boards")
    .update({ last_activity_at: new Date().toISOString(), deletion_warned_at: null })
    .eq("id", id)
    .select("id, name");
  if (error) return badLink();
  if (!data || !data.length) return gone();
  return page({
    title: "Kept — it's staying",
    body: `<p>“${esc(data[0].name || "Untitled board")}” won't be deleted. If it goes unused for another 30 days, we'll check with you again first.</p>`,
    action: `<a class="btn" href="/board/${esc(encodeURIComponent(id))}">Open board</a>`,
  });
}
