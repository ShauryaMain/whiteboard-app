// "Keep this lesson": when a live class ends, a student can keep it in a
// notebook of their own: the teacher's board on its own page(s), and
// their own board on the next.
//
// Students never sign in for a class, so it works like keeping a demo
// board (demoCarry.js):
//   1. When the class ends, the class page has the teacher's board (as it
//      was watching it) and the student's own. Pressing "Keep this lesson"
//      keeps a copy of both in this browser (stashLesson), then signs them
//      in (Google, or an emailed code).
//   2. Once they're signed in, the home page (LessonCarryOver.js) makes a
//      notebook of it (saveLessonNotebook), puts it in a subject called
//      "Lessons" and opens it.
//
// A board doesn't come in pages, so each one is shrunk (if it's wider than
// a page) and cut into page-sized pieces where the cut crosses as little
// writing as it can (lessonPages).

import { supabase } from "./supabaseClient";
import { fileUrl } from "./fileUrls";
import { packStroke, unpackStroke } from "./inkPack";
import { strokeBounds, imageBounds, textBounds, unionBounds } from "./boardObjects";
import { graphOuterBounds, graphsOf, packGraphs } from "./graphList";
import { layoutPages, newNotebook, newPage, PAGE_SIZES, COVER_COLORS } from "./notebook";
import { normalizeBackground, parseBackground } from "./boardBackground";

const KEY = "cleanslate_lesson_keep";
// How long a kept lesson waits for its student to sign in. Not long: on a
// shared classroom computer, the next person to sign in mustn't get it.
const KEEP_FOR_MS = 3 * 60 * 60 * 1000;
const MARGIN = 36; // board units of paper round the lesson on each page
const BATCH = 40;

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (v) => v.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10).join("")}`;
}

// ---------- laying a board out as pages ----------

function usable(content) {
  const strokes = (content.strokes || []).filter((s) => s && Array.isArray(s.points) && s.points.length > 0);
  return {
    strokes,
    texts: (content.texts || []).filter((t) => t && Number.isFinite(t.x) && Number.isFinite(t.y)),
    images: (content.images || []).filter((i) => i && Number.isFinite(i.x) && i.width > 0 && i.height > 0 && typeof i.src === "string"),
    graphs: content.graphs || [],
  };
}

function isEmpty(c) {
  return !c.strokes.some((s) => s.tool !== "eraser") && !c.texts.length && !c.images.length && !c.graphs.length;
}

// Where to cut a board `total` high into pieces at most `room` high,
// crossing as few things (`spans`: [top, bottom]) as possible. Returns the
// cut heights, top to bottom (not including 0 and `total`).
export function chooseCuts(spans, total, room) {
  const cuts = [];
  let start = 0;
  let guard = 0;
  while (total - start > room && guard++ < 400) {
    const lo = start + room * 0.7;
    const hi = start + room;
    let best = hi;
    let bestCount = Infinity;
    for (let y = hi; y >= lo; y -= 4) {
      let count = 0;
      for (const [a, b] of spans) if (a < y && b > y) count++;
      // (fewer crossings wins; on a tie, the lower cut, so pages stay full)
      if (count < bestCount) {
        bestCount = count;
        best = y;
        if (count === 0) break;
      }
    }
    cuts.push(best);
    start = best;
  }
  return cuts;
}

// The pages a set of boards makes. `parts`: [{ title, content: { strokes,
// texts, images, graphs } }] (the board's own objects, in board units).
// `textHeight(t)`: how tall a text box is. Returns { notebook, strokes,
// texts, images, graphs } with every object given a new id and moved onto
// its page (the notebook's own coordinates). Empty parts are left out.
export function lessonPages(parts, { size = "a4", textHeight = (t) => (t.fontSize || 24) * 1.3, background = "blank" } = {}) {
  const base = PAGE_SIZES[size] || PAGE_SIZES.a4;
  const plans = [];
  for (const part of parts) {
    const c = usable(part.content || {});
    if (isEmpty(c)) continue;
    const items = [];
    for (const s of c.strokes) {
      const b = strokeBounds(s);
      if (b) items.push({ kind: "strokes", o: s, b, anchor: s.points[0].y });
    }
    for (const t of c.texts) {
      const b = textBounds(t, textHeight(t));
      items.push({ kind: "texts", o: t, b, anchor: t.y });
    }
    for (const i of c.images) items.push({ kind: "images", o: i, b: imageBounds(i), anchor: i.y });
    for (const g of c.graphs) {
      const b = graphOuterBounds(g);
      if (b) items.push({ kind: "graphs", o: g, b, anchor: g.y });
    }
    const bounds = unionBounds(items.filter((it) => !(it.kind === "strokes" && it.o.tool === "eraser")).map((it) => it.b));
    if (!bounds) continue;
    const bw = Math.max(1, bounds.maxX - bounds.minX);
    const bh = Math.max(1, bounds.maxY - bounds.minY);
    // a wide, short board goes on pages turned sideways
    const landscape = bw / bh > 1.25 && bw > base.w - 2 * MARGIN;
    const pageW = landscape ? base.h : base.w;
    const pageH = landscape ? base.w : base.h;
    const roomW = pageW - 2 * MARGIN;
    const roomH = pageH - 2 * MARGIN;
    const scale = Math.min(1, roomW / bw);
    const spans = items.map((it) => [(it.b.minY - bounds.minY) * scale, (it.b.maxY - bounds.minY) * scale]);
    const cuts = chooseCuts(spans, bh * scale, roomH);
    plans.push({ title: part.title, items, bounds, scale, landscape, cuts, offsetX: (roomW - bw * scale) / 2 });
  }
  if (!plans.length) return null;

  // the pages, then where each one is
  const pages = [];
  for (const plan of plans) {
    plan.first = pages.length;
    for (let k = 0; k <= plan.cuts.length; k++) {
      const extra = plan.landscape ? { landscape: true } : {};
      if (k === 0 && plan.title) extra.title = plan.title;
      pages.push(newPage("blank", extra));
    }
  }
  const nb = { ...newNotebook({ size, paper: "blank", color: COVER_COLORS[2][1], emoji: "" }), pages };
  const layout = layoutPages(nb);

  const out = { notebook: nb, strokes: [], texts: [], images: [], graphs: [], background: normalizeBackground(background) };
  for (const plan of plans) {
    const tops = [0, ...plan.cuts];
    const s = plan.scale;
    for (const it of plan.items) {
      const a = (it.anchor - plan.bounds.minY) * s;
      let k = 0;
      while (k + 1 < tops.length && a >= tops[k + 1]) k++;
      const rect = layout[plan.first + k];
      const X = (x) => Math.round(((x - plan.bounds.minX) * s + rect.x + MARGIN + plan.offsetX) * 10) / 10;
      const Y = (y) => Math.round(((y - plan.bounds.minY) * s - tops[k] + rect.y + MARGIN) * 10) / 10;
      const o = it.o;
      if (it.kind === "strokes") {
        const points = o.points.map((p) => (p.w !== undefined ? { x: X(p.x), y: Y(p.y), w: p.w * s } : { x: X(p.x), y: Y(p.y) }));
        const stroke = { ...o, id: newId(), points, width: (o.width || 2) * s };
        out.strokes.push(stroke);
      } else if (it.kind === "texts") {
        out.texts.push({ ...o, id: newId(), x: X(o.x), y: Y(o.y), fontSize: (o.fontSize || 24) * s, width: (o.width || 240) * s });
      } else if (it.kind === "images") {
        out.images.push({ id: newId(), src: o.src, x: X(o.x), y: Y(o.y), width: o.width * s, height: o.height * s });
      } else {
        out.graphs.push({ ...o, id: `graph-${newId().slice(0, 8)}`, x: X(o.x), y: Y(o.y), size: o.size * s });
      }
    }
  }
  return out;
}

// ---------- the copy kept in this browser ----------

function store() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch (err) {
    return null;
  }
}

// What a board looks like in the copy: strokes packed (much smaller).
function slim(content) {
  const c = usable(content || {});
  return {
    strokes: c.strokes.map((s) => {
      const { id, ...rest } = s;
      return packStroke(rest);
    }),
    texts: c.texts.map((t) => ({ x: t.x, y: t.y, text: t.text, color: t.color, fontSize: t.fontSize, width: t.width, rotation: t.rotation || 0 })),
    images: c.images.map((i) => ({ x: i.x, y: i.y, width: i.width, height: i.height, src: i.src })).filter((i) => i.src.length < 400000),
    graphs: c.graphs,
  };
}

function unslim(content) {
  return {
    strokes: (content.strokes || []).map((data) => unpackStroke(data)).filter((s) => s && s.points && s.points.length),
    texts: content.texts || [],
    images: content.images || [],
    graphs: content.graphs || [],
  };
}

// Whether there's anything to keep: { teacher, mine } as the class page
// has them.
export function lessonHasWork({ teacher, mine }) {
  return !isEmpty(usable(teacher || {})) || !isEmpty(usable(mine || {}));
}

// Keeps a copy of the lesson in this browser, ready to be saved once the
// student is signed in. `lesson`: { name, classCode, teacher, mine,
// background }. Returns true if it was kept.
export function stashLesson(lesson) {
  const s = store();
  if (!s) return false;
  const copy = {
    v: 1,
    savedAt: Date.now(),
    name: String(lesson.name || "Lesson").slice(0, 60),
    classCode: lesson.classCode || "",
    background: lesson.background || "blank",
    teacher: slim(lesson.teacher),
    mine: slim(lesson.mine),
  };
  try {
    s.setItem(KEY, JSON.stringify(copy));
    return true;
  } catch (err) {
    // too big for this browser's storage: try without the teacher's pictures
    try {
      s.setItem(KEY, JSON.stringify({ ...copy, teacher: { ...copy.teacher, images: [] } }));
      return true;
    } catch (again) {
      return false;
    }
  }
}

export function readLesson() {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return null;
    const copy = JSON.parse(raw);
    if (!copy || copy.v !== 1 || Date.now() - (Number(copy.savedAt) || 0) > KEEP_FOR_MS) {
      s.removeItem(KEY);
      return null;
    }
    return copy;
  } catch (err) {
    return null;
  }
}

export function clearLesson() {
  const s = store();
  if (!s) return;
  try {
    s.removeItem(KEY);
  } catch (err) {
    // nothing to do
  }
}

// The notebook's name: the lesson's, and the day ("Algebra · 23 Oct").
export function lessonName(name, at = Date.now()) {
  const day = new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const base = String(name || "").trim() || "Lesson";
  return `${base.slice(0, 60)} · ${day}`;
}

// ---------- saving it as a notebook ----------

async function insertInBatches(table, rows) {
  let failed = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    let { error } = await supabase.from(table).insert(batch);
    if (error) ({ error } = await supabase.from(table).insert(batch.map(({ created_at, ...rest }) => rest)));
    if (error) {
      failed += batch.length;
      console.error(`Lesson notebook: couldn't save ${batch.length} ${table}:`, error);
    }
  }
  return failed;
}

// The student's "Lessons" subject (made the first time).
async function lessonsSubject(userId) {
  try {
    const { data } = await supabase.from("subjects").select("id, name").eq("owner_id", userId);
    const found = (data || []).find((s) => String(s.name).trim().toLowerCase() === "lessons");
    if (found) return found.id;
    const made = await supabase.from("subjects").insert({ name: "Lessons", color: COVER_COLORS[2][1], owner_id: userId, position: 0 }).select("id").single();
    return made.data ? made.data.id : null;
  } catch (err) {
    return null; // the notebook is still made, just without a subject
  }
}

// A picture from the teacher's board, copied into the student's own
// notebook (so it stays even if the teacher's board is deleted). Falls back
// to the teacher's copy if it can't be copied.
async function copyPicture(img, boardId) {
  if (!/^https:\/\//.test(img.src)) return img;
  try {
    const res = await fetch(await fileUrl(img.src));
    if (!res.ok) return img;
    const blob = await res.blob();
    const ext = /png/.test(blob.type) ? "png" : /webp/.test(blob.type) ? "webp" : /gif/.test(blob.type) ? "gif" : "jpg";
    const path = `${boardId}/${img.id}.${ext}`;
    const up = await supabase.storage.from("board-images").upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: true });
    if (up.error) return img;
    const { data } = supabase.storage.from("board-images").getPublicUrl(path);
    return data && data.publicUrl ? { ...img, src: data.publicUrl } : img;
  } catch (err) {
    return img;
  }
}

// Makes the notebook from the copy kept here. Resolves to the new
// notebook's id, or null if it couldn't be made (the copy is kept then, to
// try again).
export async function saveLessonNotebook(copy, userId, { textHeight } = {}) {
  if (!copy || !userId) return null;
  const parts = [
    { title: "Teacher's board", content: unslim(copy.teacher || {}) },
    { title: "My board", content: unslim(copy.mine || {}) },
  ];
  const laid = lessonPages(parts, { textHeight, background: parseBackground(copy.background).color === "#ffffff" ? "blank" : `blank@${parseBackground(copy.background).color}` });
  if (!laid) return null;
  const subjectId = await lessonsSubject(userId);
  const row = {
    name: lessonName(copy.name, copy.savedAt),
    owner_id: userId,
    kind: "notebook",
    notebook: laid.notebook,
    background: laid.background,
  };
  if (subjectId) row.subject_id = subjectId;
  if (laid.graphs.length) row.grid_config = packGraphs(laid.graphs);
  const made = await supabase.from("boards").insert(row).select("id").single();
  if (made.error || !made.data) {
    console.error("Lesson notebook: couldn't make it:", made.error);
    return null;
  }
  const boardId = made.data.id;
  const images = [];
  for (const img of laid.images) images.push(await copyPicture(img, boardId));
  // each row a millisecond after the one before, so what was on top stays on top
  const total = laid.strokes.length + laid.texts.length + images.length;
  const start = Date.now() - total - 1000;
  let n = 0;
  const stamp = () => new Date(start + n++).toISOString();
  const strokes = laid.strokes.map((s) => {
    const { id, ...rest } = s;
    return { id, board_id: boardId, data: packStroke(rest), created_at: stamp() };
  });
  const texts = laid.texts.map((t) => ({
    id: t.id, board_id: boardId, x: t.x, y: t.y, text: t.text, color: t.color || "#1a1a1a",
    font_size: t.fontSize, width: t.width, rotation: t.rotation || 0, created_at: stamp(),
  }));
  const imageRows = images.map((i) => ({ id: i.id, board_id: boardId, x: i.x, y: i.y, width: i.width, height: i.height, src: i.src, created_at: stamp() }));
  const failed =
    (await insertInBatches("strokes", strokes)) + (await insertInBatches("texts", texts)) + (await insertInBatches("images", imageRows));
  if (total > 0 && failed === total) {
    await supabase.from("boards").delete().eq("id", boardId);
    return null;
  }
  return boardId;
}

// ---------- a tiny store, so the home page can react ----------

let carrying = null;
export function bringLessonAcross(userId, opts) {
  if (carrying) return carrying;
  const copy = readLesson();
  if (!copy || !userId) return Promise.resolve(null);
  carrying = saveLessonNotebook(copy, userId, opts)
    .then((id) => {
      if (id) clearLesson();
      return id;
    })
    .catch((err) => {
      console.error("Lesson notebook: couldn't make it:", err);
      return null;
    })
    .finally(() => {
      carrying = null;
    });
  return carrying;
}
