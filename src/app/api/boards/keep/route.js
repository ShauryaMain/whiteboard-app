// "Keep this board" from the clean-up warning email.
// GET shows a confirm page (so email link-scanners that open every link
// don't keep boards by accident); its button POSTs back here to keep it.
// No sign-in needed: the link carries a signature for that one board.

import { createClient } from "@supabase/supabase-js";
import { verifyKeep, keepSecret } from "@/lib/keepToken";
import { esc } from "@/lib/cleanupEmail";
import { BRAND_MARK_PNG_BASE64 } from "@/lib/emailBrandMark";
import { LANDING_URL } from "@/lib/links";

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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Shantell+Sans:wght@700;800&family=Caveat:wght@600&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px;
    background-color: #FDFCF7; color: #1B1D24;
    background-image: linear-gradient(#E6ECF7 1px, transparent 1px), linear-gradient(90deg, #E6ECF7 1px, transparent 1px);
    background-size: 32px 32px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .card { position: relative; width: min(100%, 420px); background: #FFFFFF; border: 2px solid #1B1D24; border-radius: 18px;
    box-shadow: 6px 6px 0 #1B1D24; padding: 30px 26px 24px; text-align: center; }
  .card::before { content: ""; position: absolute; top: -13px; left: 50%; width: 96px; height: 26px; margin-left: -48px;
    background: rgba(255,229,138,.9); transform: rotate(-3deg); }
  .brand { color: inherit; text-decoration: none; display: inline-flex; align-items: center; gap: 10px; font-family: "Shantell Sans", sans-serif; font-weight: 800; font-size: 18px; margin-bottom: 20px; }
  .brand img { width: 32px; height: 32px; border-radius: 9px; }
  h1 { font-family: "Shantell Sans", sans-serif; font-weight: 800; font-size: 23px; line-height: 1.25; margin: 0 0 10px; }
  p { font-size: 15px; line-height: 1.55; color: #5F5E5A; margin: 0 0 20px; }
  .btn { display: block; width: 100%; min-height: 50px; border: 2px solid #1B1D24; border-radius: 12px; background: #2451D6; color: #fff;
    font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; text-decoration: none; line-height: 46px;
    box-shadow: 3px 3px 0 #1B1D24; transition: transform .12s ease, box-shadow .12s ease; }
  .btn:hover { transform: translate(1px,1px); box-shadow: 2px 2px 0 #1B1D24; }
  .btn.secondary { background: #FFFFFF; color: #1B1D24; box-shadow: none; margin-top: 12px; }
  .btn.secondary:hover { background: #FDFCF7; transform: none; }
  .note { font-family: Caveat, cursive; font-size: 20px; color: #2451D6; margin-top: 16px; }
</style>
</head><body>
<main class="card">
  <a class="brand" href="${esc(LANDING_URL)}"><img src="data:image/png;base64,${BRAND_MARK_PNG_BASE64}" alt="">Clean Slate</a>
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
