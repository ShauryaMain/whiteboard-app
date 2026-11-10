// Teaching: classes, students' notebooks and clips (homework and resources
// a teacher sends into students' notebooks). The database side is
// supabase/2026-11-clipping.sql; everything goes through its functions.
//
// Every call here returns null (or an empty answer) when the database
// hasn't got that file yet, so the rest of the app carries on as before.

import { supabase } from "./supabaseClient";
import { newId } from "./boardObjects";
import { checkLiveMode, liveChannel } from "./liveMode";

const missing = (error) => {
  const code = String((error && error.code) || "");
  return code === "PGRST202" || code === "42883" || /could not find the function|does not exist/i.test(String((error && error.message) || ""));
};

// { data } | { missing: true } | { error }
export async function call(fn, args = {}) {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return missing(error) ? { missing: true } : { error };
    return { data };
  } catch (error) {
    return { error };
  }
}

// What went wrong, in words for a dialog.
export function problemText(res, fallback = "Something went wrong. Check your connection and try again.") {
  if (!res) return fallback;
  if (res.missing) return "Classes and homework need a database update first (supabase/2026-11-clipping.sql).";
  const msg = res.error && res.error.message;
  if (msg && msg.length < 120 && !/violates|syntax|function|relation|column/i.test(msg)) return msg;
  return fallback;
}

// ---------- dates ----------

const DAY = 24 * 60 * 60 * 1000;

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// "Today, 5:00 pm", "Tomorrow, 9:00 am", "Thu 13 Nov", "13 Nov 2027".
export function dueText(iso, now = new Date()) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay(d, now)) return `today, ${time}`;
  const tomorrow = new Date(now.getTime() + DAY);
  if (sameDay(d, tomorrow)) return `tomorrow, ${time}`;
  const yesterday = new Date(now.getTime() - DAY);
  if (sameDay(d, yesterday)) return `yesterday, ${time}`;
  const opts = d.getFullYear() === now.getFullYear()
    ? { weekday: "short", day: "numeric", month: "short" }
    : { day: "numeric", month: "short", year: "numeric" };
  return d.toLocaleDateString(undefined, opts);
}

// How urgent: "overdue" (past it, not handed in), "soon" (within a day),
// "later", or "none".
export function dueState(iso, status, now = Date.now()) {
  if (!iso) return "none";
  if (status === "handed_in" || status === "returned") return "none";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "none";
  if (t < now) return "overdue";
  if (t - now < DAY) return "soon";
  return "later";
}

// A short label for a badge on a notebook's cover: "Due today",
// "Due Thu", "Overdue".
export function dueBadge(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (d.getTime() < now.getTime()) return "Overdue";
  if (sameDay(d, now)) return "Due today";
  if (sameDay(d, new Date(now.getTime() + DAY))) return "Due tomorrow";
  if (d.getTime() - now.getTime() < 6 * DAY) return "Due " + d.toLocaleDateString(undefined, { weekday: "short" });
  return "Due " + d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export const STATUS_LABEL = {
  assigned: "Not handed in",
  handed_in: "Handed in",
  returned: "Returned",
};

export function scoreText(score, max) {
  if (score === null || score === undefined || score === "") return "";
  const n = Number(score);
  if (!Number.isFinite(n)) return "";
  const s = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return max ? `${s} / ${Number(max)}` : s;
}

// The date and time a <input type="datetime-local"> shows, and back.
export function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// A sensible due date to start from: the next school day at 9 am... or,
// more simply, a week today at 5 pm.
export function defaultDue(now = new Date()) {
  const d = new Date(now.getTime() + 7 * DAY);
  d.setHours(17, 0, 0, 0);
  return d.toISOString();
}

// ---------- links ----------

export function classLink(code) {
  return `${window.location.origin}/c/${code}`;
}

export function inviteLink(token) {
  return `${window.location.origin}/s/${token}`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    return false;
  }
}

// ---------- clips ----------

// Page pictures, uploaded to the teacher's own clips folder:
// [{ blob, w, h, pw, ph }] -> [{ url, path, w, h, pw, ph }] (null if any failed).
export async function uploadClipPages(userId, pages, onProgress) {
  const folder = `clips/${userId}/${newId().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) || Date.now().toString(36)}`;
  const bucket = supabase.storage.from("board-images");
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    if (onProgress) onProgress(i, pages.length);
    const p = pages[i];
    const path = `${folder}/${i + 1}.jpg`;
    const { error } = await bucket.upload(path, p.blob, { contentType: "image/jpeg", upsert: false, cacheControl: "31536000" });
    if (error) return null;
    const { data } = bucket.getPublicUrl(path);
    if (!data || !data.publicUrl) return null;
    out.push({ url: data.publicUrl, path, w: p.w, h: p.h, pw: p.pw, ph: p.ph });
  }
  return out;
}

// Tells notebooks that are open somewhere that pages arrived, so they load
// them now rather than the next time they're opened. Best effort.
export async function nudgeNotebooks(boardIds) {
  const mode = await checkLiveMode().catch(() => null);
  for (const id of (boardIds || []).slice(0, 60)) {
    try {
      const ch = liveChannel(`board-${id}`, { broadcast: { self: false } }, mode || undefined);
      await ch.send({ type: "broadcast", event: "notebook-refresh", payload: { why: "clip" } });
      supabase.removeChannel(ch);
    } catch (err) {
      // they'll see it next time they open it
    }
  }
}

// The size a page picture becomes in a notebook (board units), keeping its
// shape: as wide as the notebook's paper.
export function pageSizeFor(picW, picH, paperW = 794) {
  let pw = paperW;
  let ph = Math.round((paperW * picH) / Math.max(1, picW));
  if (ph > 4000) {
    pw = Math.max(200, Math.round((paperW * 4000) / ph));
    ph = 4000;
  } else if (ph < 200) {
    ph = 200;
  }
  return { pw, ph };
}

// A canvas as a JPEG blob.
export function canvasJpeg(canvas, quality = 0.85) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality));
}

// A picture file (photo of a worksheet) as a clip page: { blob, w, h, pw, ph }.
export async function imageFilePage(file, maxSide = 2200) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await canvasJpeg(canvas);
    const out = blob ? { blob, w: canvas.width, h: canvas.height, ...pageSizeFor(canvas.width, canvas.height) } : null;
    canvas.width = 0;
    canvas.height = 0;
    return out;
  } catch (err) {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Which pages of a notebook belong to which clip, in order:
// [{ clip, first, last, pageIds }] (first/last are page indexes).
export function clipSections(notebook) {
  const out = [];
  const pages = (notebook && notebook.pages) || [];
  pages.forEach((p, i) => {
    if (!p.clip) return;
    const prev = out[out.length - 1];
    if (prev && prev.clip === p.clip && prev.last === i - 1) {
      prev.last = i;
      prev.pageIds.push(p.id);
    } else {
      out.push({ clip: p.clip, first: i, last: i, pageIds: [p.id] });
    }
  });
  return out;
}

// Picked pages of a PDF file as clip pages: [{ blob, w, h, pw, ph }].
// `picked`: page numbers (from 1). Pages that can't be drawn are skipped.
export async function pdfFilePages(file, picked, onProgress) {
  const { openPdfBytes, closePdf, pageBaseSize, drawPage } = await import("./refPdf");
  let bytes = null;
  try {
    bytes = await file.arrayBuffer();
  } catch (err) {
    return null;
  }
  const doc = await openPdfBytes(bytes).catch(() => null);
  if (!doc) return null;
  const out = [];
  try {
    for (let k = 0; k < picked.length; k++) {
      if (onProgress) onProgress(k, picked.length);
      const entry = { kind: "pdf", src: picked[k] };
      const base = await pageBaseSize(doc, entry, null).catch(() => null);
      if (!base) continue;
      // about twice as wide as a page on screen, so it stays sharp zoomed in
      const scale = Math.min(1600 / base.w, Math.sqrt(4200000 / (base.w * base.h)));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(base.w * scale);
      canvas.height = Math.round(base.h * scale);
      const drawn = await drawPage(canvas.getContext("2d"), { pdfDoc: doc, entry, image: null }, scale).then(() => true, () => false);
      const blob = drawn ? await canvasJpeg(canvas) : null;
      if (blob) out.push({ blob, w: canvas.width, h: canvas.height, ...pageSizeFor(base.w, base.h) });
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    closePdf(doc);
  }
  return out;
}
