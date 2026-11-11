// Notebooks: a board laid out as paper pages, one under another.
//
// A notebook is an ordinary board (same tools, same saving, same live
// sync) whose `notebook` column lists its pages:
//
//   { v: 1, size: "a4" | "letter", cover: { color, emoji },
//     pages: [{ id, paper, landscape?, w?, h?, bg?: { url, path, w, h } }] }
//
// Everything on it keeps ordinary board coordinates. The pages are laid out
// top to bottom, centred on x = 0, with a gap between them, so page n's box
// depends only on the pages before it. Adding, removing or reordering pages
// moves what's on them by whole page heights ("bands": see planRelayout).
//
// Each page has its own paper. The page colour is the board's (its
// background), shared by every page, so ink that flips on dark pages works
// as on a board.

import { lightness } from "./boardBackground";

export const PAGE_SIZES = {
  a4: { w: 794, h: 1123, label: "A4", pdf: { w: 595.28, h: 841.89 } },
  letter: { w: 816, h: 1056, label: "US Letter", pdf: { w: 612, h: 792 } },
};
export const PAGE_GAP = 48; // board units between pages
export const MAX_PAGES = 500;
export const DESK = "#E7E5DF"; // around the pages (light)
export const DESK_DARK = "#2A2C31";

export const NOTEBOOK_PAPERS = [
  { id: "lined", label: "Lined", desc: "Ruled lines with a margin" },
  { id: "graph", label: "Squared", desc: "Square grid for maths" },
  { id: "dots", label: "Dot grid", desc: "Light dots in a square grid" },
  { id: "blank", label: "Blank", desc: "Plain page" },
  { id: "cornell", label: "Cornell", desc: "Cues on the left, notes on the right, summary at the bottom" },
  { id: "margin", label: "Maths", desc: "Squares with a margin and a title line" },
  { id: "iso", label: "Isometric", desc: "Triangular dots for 3D drawing" },
];
const PAPER_IDS = new Set(NOTEBOOK_PAPERS.map((p) => p.id));

export const COVER_COLORS = [
  ["Blue", "#2F5BEA"],
  ["Red", "#E0443A"],
  ["Orange", "#F08A24"],
  ["Yellow", "#F2C230"],
  ["Green", "#2E9E5B"],
  ["Teal", "#13897D"],
  ["Purple", "#7A4CD9"],
  ["Pink", "#E0559A"],
  ["Ink", "#1B1D24"],
  ["Sand", "#C9A97A"],
];

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export function newPageId() {
  return "p" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// The paper size most people around here use: US Letter in the US and
// Canada, A4 everywhere else.
export function defaultPageSize() {
  try {
    const langs = typeof navigator !== "undefined" ? [navigator.language, ...(navigator.languages || [])] : [];
    if (langs.some((l) => /-(US|CA)$/i.test(String(l || "")))) return "letter";
  } catch (err) {
    // fall through
  }
  return "a4";
}

function cleanHex(c) {
  return typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null;
}

function cleanBg(bg) {
  if (!bg || typeof bg !== "object") return null;
  const url = typeof bg.url === "string" && /^https:\/\/|^data:image\//.test(bg.url) ? bg.url : null;
  const w = Number(bg.w), h = Number(bg.h);
  if (!url || !(w > 0) || !(h > 0)) return null;
  const out = { url, w: Math.round(w), h: Math.round(h) };
  if (typeof bg.path === "string" && bg.path.length < 300) out.path = bg.path;
  return out;
}

export function normalizePage(p) {
  if (!p || typeof p !== "object") return null;
  const id = typeof p.id === "string" && ID_RE.test(p.id) ? p.id : newPageId();
  const page = { id, paper: PAPER_IDS.has(p.paper) ? p.paper : "lined" };
  if (p.landscape === true) page.landscape = true;
  const w = Number(p.w), h = Number(p.h);
  if (w >= 200 && h >= 200 && w <= 5000 && h <= 5000) {
    page.w = Math.round(w);
    page.h = Math.round(h);
  }
  const bg = cleanBg(p.bg);
  if (bg) page.bg = bg;
  if (typeof p.title === "string" && p.title.trim()) page.title = p.title.trim().slice(0, 80);
  // starred (bookmarked), to find it quickly in the Pages panel
  if (p.star === true) page.star = true;
  // a page a teacher clipped in (src/lib/teaching.js)
  if (typeof p.clip === "string" && /^[0-9a-f-]{36}$/i.test(p.clip)) page.clip = p.clip;
  return page;
}

// Links from something on a page to another page: [{ id, objs, to }].
// objs: what the link is on ([{ k: "s" | "t" | "i", id }]: strokes, text
// boxes, pictures; a handwritten word is several strokes); to: the page id.
export const MAX_LINKS = 300;
const OBJ_ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
function cleanLinks(list, pageIds) {
  const out = [];
  const ids = new Set();
  for (const l of Array.isArray(list) ? list : []) {
    if (!l || typeof l !== "object" || typeof l.to !== "string" || !pageIds.has(l.to)) continue;
    const id = typeof l.id === "string" && ID_RE.test(l.id) && !ids.has(l.id) ? l.id : null;
    if (!id) continue;
    const objs = (Array.isArray(l.objs) ? l.objs : [])
      .filter((o) => o && (o.k === "s" || o.k === "t" || o.k === "i") && typeof o.id === "string" && OBJ_ID_RE.test(o.id))
      .slice(0, 60)
      .map((o) => ({ k: o.k, id: o.id }));
    if (!objs.length) continue;
    ids.add(id);
    out.push({ id, objs, to: l.to });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

export function newPage(paper = "lined", extra = {}) {
  return normalizePage({ id: newPageId(), paper, ...extra });
}

// A notebook as saved, cleaned up (null when it isn't one).
export function normalizeNotebook(raw) {
  if (!raw || typeof raw !== "object") return null;
  const size = PAGE_SIZES[raw.size] ? raw.size : "a4";
  const cover = {
    color: cleanHex(raw.cover && raw.cover.color) || COVER_COLORS[0][1],
    emoji: typeof (raw.cover && raw.cover.emoji) === "string" ? Array.from(raw.cover.emoji.trim()).slice(0, 2).join("") : "",
  };
  const seen = new Set();
  const pages = [];
  for (const p of Array.isArray(raw.pages) ? raw.pages : []) {
    const page = normalizePage(p);
    if (!page || seen.has(page.id)) continue;
    seen.add(page.id);
    pages.push(page);
    if (pages.length >= MAX_PAGES) break;
  }
  if (!pages.length) pages.push(newPage("lined"));
  // which change of pages this is (the database refuses a change made
  // from an out-of-date copy)
  const rev = Number.isInteger(raw.rev) && raw.rev >= 0 ? raw.rev : 0;
  const out = { v: 1, rev, size, cover, pages };
  const links = cleanLinks(raw.links, seen);
  if (links.length) out.links = links;
  return out;
}

export function newNotebook({ size = defaultPageSize(), paper = "lined", color, emoji = "" } = {}) {
  return normalizeNotebook({ size, cover: { color, emoji }, pages: [{ id: newPageId(), paper }] });
}

// ---------- where the pages are ----------

export function pageSize(nb, page) {
  if (page && page.w && page.h) return { w: page.w, h: page.h };
  const s = PAGE_SIZES[(nb && nb.size) || "a4"] || PAGE_SIZES.a4;
  return page && page.landscape ? { w: s.h, h: s.w } : { w: s.w, h: s.h };
}

// [{ id, index, page, x, y, w, h }] top to bottom.
export function layoutPages(nb) {
  const out = [];
  let y = 0;
  (nb ? nb.pages : []).forEach((page, index) => {
    const { w, h } = pageSize(nb, page);
    out.push({ id: page.id, index, page, x: -w / 2, y, w, h });
    y += h + PAGE_GAP;
  });
  return out;
}

// The page a point belongs to: the one whose box (plus the gap under it)
// holds y. Above the first page is the first; below the last, the last.
export function pageIndexAt(layout, y) {
  if (!layout.length) return -1;
  for (let i = 0; i < layout.length; i++) {
    if (y < layout[i].y + layout[i].h + PAGE_GAP / 2) return i;
  }
  return layout.length - 1;
}

// The rectangle of the page a point is on (null in the gaps and on the desk).
export function pageRectAt(layout, p, pad = 0) {
  for (const r of layout) {
    if (p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad) return r;
  }
  return null;
}

// A finished line of ink stays on the page it started on, like paper: it's
// cut where it first leaves that page. (Unchanged when it started off the
// pages.)
export function trimStrokeToPage(stroke, layout) {
  const pts = stroke && stroke.points;
  if (!pts || pts.length < 2 || !layout.length) return stroke;
  const rect = pageRectAt(layout, pts[0]);
  if (!rect) return stroke;
  const inside = (p) => p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
  let end = pts.length;
  for (let i = 1; i < pts.length; i++) {
    if (!inside(pts[i])) {
      end = i;
      break;
    }
  }
  if (end === pts.length) return stroke;
  // the point where it crosses the page's edge, so the line reaches it
  const a = pts[end - 1];
  const b = pts[end];
  let t = 1;
  const edge = (from, to, lo, hi) => {
    if (to < lo) return (lo - from) / (to - from);
    if (to > hi) return (hi - from) / (to - from);
    return 1;
  };
  if (b.x !== a.x) t = Math.min(t, edge(a.x, b.x, rect.x, rect.x + rect.w));
  if (b.y !== a.y) t = Math.min(t, edge(a.y, b.y, rect.y, rect.y + rect.h));
  t = Math.max(0, Math.min(1, t));
  const cut = { ...b, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  const kept = [...pts.slice(0, end), cut];
  return kept.length >= 2 ? { ...stroke, points: kept } : stroke;
}

// The page most of the screen is looking at: the one under the middle of
// the view (or the nearest).
export function pageInView(layout, viewTop, viewBottom) {
  if (!layout.length) return -1;
  const mid = (viewTop + viewBottom) / 2;
  return pageIndexAt(layout, mid);
}

// ---------- moving things when the pages change ----------

// Which way the contents of each page move when the pages go from
// `before` to `after` (the same notebook): [{ from, to, dx, dy, del }],
// for the pages that moved or went. A page's band runs from the middle of
// the gap above it to the middle of the gap below it (the first starts at
// -Infinity, the last runs on to Infinity), so everything on or beside a
// page goes with it. Neighbouring pages that move the same way share one
// band.
export function planRelayout(before, after) {
  const oldL = layoutPages(before);
  const newL = layoutPages(after);
  const byId = new Map(newL.map((r) => [r.id, r]));
  const bands = [];
  oldL.forEach((r, i) => {
    const from = i === 0 ? -Infinity : r.y - PAGE_GAP / 2;
    const to = i === oldL.length - 1 ? Infinity : oldL[i + 1].y - PAGE_GAP / 2;
    const n = byId.get(r.id);
    const band = n ? { from, to, dx: n.x - r.x, dy: n.y - r.y, del: false } : { from, to, dx: 0, dy: 0, del: true };
    if (!band.del && !band.dx && !band.dy) return;
    const prev = bands[bands.length - 1];
    if (prev && prev.to === from && prev.del === band.del && prev.dx === band.dx && prev.dy === band.dy) prev.to = to;
    else bands.push(band);
  });
  return bands;
}

// The band (if any) for something whose anchor is at y.
export function bandFor(bands, y) {
  for (const b of bands) if (y >= b.from && y < b.to) return b;
  return null;
}

// Bands as sent to the database and to others (Infinity isn't JSON).
export function bandsToJson(bands) {
  return bands.map((b) => ({
    lo: Number.isFinite(b.from) ? b.from : -1e12,
    hi: Number.isFinite(b.to) ? b.to : 1e12,
    dx: b.dx,
    dy: b.dy,
    del: !!b.del,
  }));
}

export function bandsFromJson(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((b) => b && Number.isFinite(Number(b.lo)) && Number.isFinite(Number(b.hi)))
    .slice(0, MAX_PAGES + 1)
    .map((b) => ({
      from: Number(b.lo) <= -1e12 ? -Infinity : Number(b.lo),
      to: Number(b.hi) >= 1e12 ? Infinity : Number(b.hi),
      dx: Number(b.dx) || 0,
      dy: Number(b.dy) || 0,
      del: !!b.del,
    }));
}

// Where a thing is for the bands: a stroke by where it starts, text and
// pictures by their top left, a graph by its top left.
export function strokeAnchorY(s) {
  const p = s && s.points && s.points[0];
  return p ? p.y : 0;
}

export function shiftStroke(s, dx, dy) {
  return { ...s, points: s.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) };
}

// Applies bands to on-screen contents. Returns the new lists plus the ids
// that went: { strokes, texts, images, graphs, removed: { strokes, texts, images } }.
export function applyBands(bands, { strokes = [], texts = [], images = [], graphs = [], sims = [] }) {
  const removed = { strokes: [], texts: [], images: [] };
  if (!bands.length) return { strokes, texts, images, graphs, sims, removed };
  const outStrokes = [];
  for (const s of strokes) {
    const b = bandFor(bands, strokeAnchorY(s));
    if (!b) outStrokes.push(s);
    else if (b.del) removed.strokes.push(s.id);
    else outStrokes.push(shiftStroke(s, b.dx, b.dy));
  }
  const move = (list, kind) => {
    const out = [];
    for (const t of list) {
      const b = bandFor(bands, t.y);
      if (!b) out.push(t);
      else if (b.del) {
        if (kind) removed[kind].push(t.id);
      } else out.push({ ...t, x: t.x + b.dx, y: t.y + b.dy });
    }
    return out;
  };
  return {
    strokes: outStrokes,
    texts: move(texts, "texts"),
    images: move(images, "images"),
    graphs: move(graphs, null),
    sims: move(sims, null),
    removed,
  };
}

// ---------- the pages on screen ----------

export function pageColorIsDark(color) {
  return lightness(color) < 0.18;
}

const LINE = "#CBD5E3";
const LINE_DARK = "rgba(255,255,255,0.18)";
const MARGIN_RED = "rgba(229,72,77,0.55)";
const DOT = "#A9B1BE";
const DOT_DARK = "rgba(255,255,255,0.4)";

// Board-unit layout of each paper (measured from the page's top left).
const PAPER = {
  lined: { top: 112, step: 32, bottom: 48, margin: 88 },
  graph: { step: 24 },
  dots: { step: 24 },
  iso: { step: 28 },
  margin: { step: 24, margin: 72, title: 96 },
  cornell: { top: 112, step: 32, cue: 0.3, summary: 0.2 },
};

// Paints one page's paper into ctx, which is set up in board units
// (ctx.setTransform(scale…)). `scale` is board units -> device px, used to
// keep lines one device pixel wide and to thin patterns out when zoomed out.
export function paintPaper(ctx, rect, paper, color, scale, bgImage) {
  const { x, y, w, h } = rect;
  const dark = pageColorIsDark(color);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  if (bgImage) {
    try {
      ctx.drawImage(bgImage, x, y, w, h);
    } catch (err) {
      // not loaded yet / can't be drawn: just the paper
    }
    return;
  }
  const hair = 1 / scale;
  const line = dark ? LINE_DARK : LINE;
  const rows = (top, step, bottom) => {
    if (step * scale < 5) return;
    ctx.fillStyle = line;
    for (let yy = y + top; yy <= y + h - bottom; yy += step) ctx.fillRect(x, yy, w, hair);
  };
  const grid = (step) => {
    let k = step;
    while (k * scale < 6) k *= 5;
    ctx.fillStyle = line;
    for (let yy = y + k; yy < y + h; yy += k) ctx.fillRect(x, yy, w, hair);
    for (let xx = x + k; xx < x + w; xx += k) ctx.fillRect(xx, y, hair, h);
  };
  const vline = (xx, from, to, style, width = 1) => {
    ctx.fillStyle = style;
    ctx.fillRect(xx, from, hair * width, to - from);
  };
  const dots = (step, iso) => {
    let k = step;
    while (k * scale < 8) k *= iso ? 2 : 5;
    ctx.fillStyle = dark ? DOT_DARK : DOT;
    const r = Math.max(0.8, Math.min(1.6, 1.2 * Math.sqrt(scale))) / scale;
    const rowH = iso ? (k * Math.sqrt(3)) / 2 : k;
    let row = 0;
    for (let yy = y + rowH; yy < y + h - r; yy += rowH, row++) {
      const shift = iso && row % 2 ? k / 2 : 0;
      for (let xx = x + k / 2 + shift; xx < x + w - r; xx += k) {
        ctx.beginPath();
        ctx.arc(xx, yy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };
  if (paper === "lined") {
    const P = PAPER.lined;
    rows(P.top, P.step, P.bottom);
    vline(x + P.margin, y, y + h, MARGIN_RED, 1.5);
  } else if (paper === "graph") {
    grid(PAPER.graph.step);
  } else if (paper === "dots") {
    dots(PAPER.dots.step, false);
  } else if (paper === "iso") {
    dots(PAPER.iso.step, true);
  } else if (paper === "margin") {
    const P = PAPER.margin;
    grid(P.step);
    vline(x + P.margin, y, y + h, MARGIN_RED, 1.5);
    ctx.fillStyle = dark ? "rgba(255,255,255,0.45)" : "#9AA6B8";
    ctx.fillRect(x, y + P.title, w, hair * 1.5);
  } else if (paper === "cornell") {
    const P = PAPER.cornell;
    const summaryTop = y + h - Math.round(h * P.summary);
    rows(P.top, P.step, h - (summaryTop - y) + 8);
    const strong = dark ? "rgba(255,255,255,0.5)" : "#8C99AD";
    ctx.fillStyle = strong;
    ctx.fillRect(x, y + P.top - P.step, w, hair * 2);
    vline(x + Math.round(w * P.cue), y + P.top - P.step, summaryTop, strong, 2);
    ctx.fillRect(x, summaryTop, w, hair * 2);
  }
}

// Paints the desk and every page that's on screen. ctx is a canvas the
// size of the board pane (device px); scale/pan as the board's.
export function paintPages(ctx, { layout, color, scale, pan, width, height, ratio, images, onImage }) {
  const dark = pageColorIsDark(color);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = dark ? DESK_DARK : DESK;
  ctx.fillRect(0, 0, width * ratio, height * ratio);
  ctx.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * pan.x, ratio * pan.y);
  const top = -pan.y / scale;
  const bottom = (height - pan.y) / scale;
  const left = -pan.x / scale;
  const right = (width - pan.x) / scale;
  for (const r of layout) {
    if (r.y > bottom || r.y + r.h < top || r.x > right || r.x + r.w < left) continue;
    // a soft edge under the page
    ctx.fillStyle = dark ? "rgba(0,0,0,0.35)" : "rgba(27,29,36,0.10)";
    ctx.fillRect(r.x + 3 / scale, r.y + 4 / scale, r.w, r.h);
    let bg = null;
    if (r.page.bg && images) {
      bg = images.get(r.page.bg.url) || null;
      if (!bg && onImage) onImage(r.page.bg.url);
    }
    paintPaper(ctx, r, r.page.paper, color, scale * ratio, bg && bg.complete && bg.naturalWidth ? bg : null);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// Clips ctx (set up in board units) to the pages on screen, so ink stays on
// its page like on paper.
export function clipToPages(ctx, layout, top, bottom) {
  ctx.beginPath();
  for (const r of layout) {
    if (r.y > bottom || r.y + r.h < top) continue;
    ctx.rect(r.x, r.y, r.w, r.h);
  }
  ctx.clip();
}

// The view that fits a page's width (with a little room either side) and
// shows its top. pane: { width, height } in screen px.
export function viewForPage(rect, pane, { margin = 16, maxScale = 2 } = {}) {
  const scale = Math.max(0.1, Math.min(maxScale, (pane.width - margin * 2) / rect.w));
  return {
    scale,
    pan: { x: pane.width / 2 - (rect.x + rect.w / 2) * scale, y: margin - (rect.y - 0) * scale },
  };
}
