// Text boxes with mixed styles and maths (bold, italic, underline, colour,
// highlight, font, size, alignment; powers, subscripts and fractions).
//
// Storage: a text box's `text` is still one string, so nothing about the
// database or the live messages changes. Plain text stays exactly as it
// was. A styled box is stored as its plain version (x^2, a/b…), two
// invisible separators, then the formatted version as JSON:
//     "x^2 + 1" + MARK + '{"b":[{"n":["x",{"k":"sup","n":["2"]}," + 1"]}]}'
// Anything that only wants the words can use plainText().
//
// The formatted version ("doc"):
//   doc   = { b: [block…], fx?: { family: fontUrl }, s?: size }
//           fx: uploaded fonts used; s: the box's text size when the
//           sizes below (z) were set, so resizing the box scales them too
//   block = { a?: "c" | "r", n: [node…] }                (a: centred / right)
//   node  = "plain text"
//         | { s: "text", b?, i?, u?, c?: "#hex", h?: "#hex", f?: "Font", z?: size }
//         | { k: "sup" | "sub", n: [node…] }        (+ b, i, c, f, z: the writing
//         | { k: "frac", n: [node…], d: [node…] }    it sits in, as for text)
//
// Drawing: layoutText() works out lines and positions once (cached), and
// drawText() paints it onto a canvas, so the board, previews, exports and
// students' screens all show a text box the same way.

import { inkOn } from "./inkColor";

export const MARK = "⁣⁣";
export const BASE_FONT = "-apple-system, BlinkMacSystemFont, sans-serif";
const MAX_CHARS = 20000;
const MAX_DEPTH = 5;

// ---------- reading and writing ----------

const decodeCache = new Map();

export function isStyledRaw(raw) {
  return typeof raw === "string" && raw.indexOf(MARK) >= 0;
}

export function docFromPlain(str) {
  return { b: String(str || "").split("\n").map((line) => ({ n: line ? [line] : [] })) };
}

// The words of a text box, without styles (x^2, a/b for maths).
export function plainText(raw) {
  if (typeof raw !== "string") return "";
  const i = raw.indexOf(MARK);
  return i >= 0 ? raw.slice(0, i) : raw;
}

export function decodeText(raw) {
  const key = typeof raw === "string" ? raw : "";
  const hit = decodeCache.get(key);
  if (hit) return hit;
  let doc = null;
  const i = key.indexOf(MARK);
  if (i >= 0) {
    try {
      doc = sanitizeDoc(JSON.parse(key.slice(i + MARK.length)));
    } catch (err) {
      doc = null;
    }
    if (!doc) doc = docFromPlain(key.slice(0, i));
  } else {
    doc = docFromPlain(key);
  }
  if (decodeCache.size > 600) decodeCache.clear();
  decodeCache.set(key, doc);
  return doc;
}

// Plain when it can be (so ordinary text is stored exactly as before).
export function encodeText(doc) {
  const clean = sanitizeDoc(doc) || docFromPlain("");
  const plain = docPlain(clean);
  if (isPlainDoc(clean)) return plain;
  return plain + MARK + JSON.stringify(clean);
}

function isPlainDoc(doc) {
  if (doc.fx && Object.keys(doc.fx).length) return false;
  return doc.b.every((bl) => !bl.a && bl.n.every((n) => typeof n === "string"));
}

function nodesPlain(nodes) {
  return nodes
    .map((n) => {
      if (typeof n === "string") return n;
      if (n.s !== undefined) return n.s;
      if (n.k === "sup" || n.k === "sub") {
        const inner = nodesPlain(n.n);
        const mark = n.k === "sup" ? "^" : "_";
        return mark + (/^[A-Za-z0-9.]+$/.test(inner) || inner.length <= 1 ? inner : `(${inner})`);
      }
      if (n.k === "frac") {
        const a = nodesPlain(n.n), b = nodesPlain(n.d);
        const wrap = (x) => (/^[A-Za-z0-9.]+$/.test(x) ? x : `(${x})`);
        return `${wrap(a)}/${wrap(b)}`;
      }
      return "";
    })
    .join("");
}

export function docPlain(doc) {
  return doc.b.map((bl) => nodesPlain(bl.n)).join("\n");
}

// The sizes in a doc for a box now `size` big (see doc.s).
export function scaleSizes(doc, size) {
  if (!doc.s || !size || Math.abs(doc.s - size) < 0.01) return doc;
  const k = size / doc.s;
  const z = (v) => Math.max(6, Math.min(300, Math.round(v * k * 10) / 10));
  const walk = (nodes) =>
    nodes.map((n) => {
      if (typeof n === "string") return n;
      const out = { ...n };
      if (out.z) out.z = z(out.z);
      if (out.n) out.n = walk(out.n);
      if (out.d) out.d = walk(out.d);
      return out;
    });
  return { ...doc, s: size, b: doc.b.map((bl) => ({ ...bl, n: walk(bl.n) })) };
}

// ---------- checking what comes in (from other people, or the database) ----------

const HEX = /^#[0-9a-f]{6}$/i;
const FAMILY = /^[A-Za-z0-9 _\-]{1,60}$/;

// The style keys of a run (or of the writing a piece of maths sits in:
// its size, font, colour, bold, italic; not underline or highlight).
function copyStyle(n, out, isRun) {
  if (n.b) out.b = 1;
  if (n.i) out.i = 1;
  if (isRun && n.u) out.u = 1;
  if (typeof n.c === "string" && HEX.test(n.c)) out.c = n.c.toLowerCase();
  if (isRun && typeof n.h === "string" && HEX.test(n.h)) out.h = n.h.toLowerCase();
  if (typeof n.f === "string" && FAMILY.test(n.f)) out.f = n.f;
  if (typeof n.z === "number" && n.z >= 6 && n.z <= 300) out.z = Math.round(n.z * 10) / 10;
  return out;
}

function cleanNodes(list, depth, budget) {
  if (!Array.isArray(list) || depth > MAX_DEPTH) return [];
  const out = [];
  for (const n of list) {
    if (budget.left <= 0) break;
    if (typeof n === "string") {
      const s = n.replace(/[\n\t]/g, " ").replace(/[\u0000-\u0008\u000b-\u001f​⁣]/g, "").slice(0, budget.left);
      budget.left -= s.length;
      if (s) out.push(s);
      continue;
    }
    if (!n || typeof n !== "object") continue;
    if (typeof n.s === "string") {
      const s = n.s.replace(/[\n\t]/g, " ").replace(/[\u0000-\u0008\u000b-\u001f​⁣]/g, "").slice(0, budget.left);
      budget.left -= s.length;
      if (!s) continue;
      const run = { s };
      copyStyle(n, run, true);
      out.push(Object.keys(run).length === 1 ? s : run);
      continue;
    }
    if (n.k === "sup" || n.k === "sub") {
      const inner = cleanNodes(n.n, depth + 1, budget);
      if (inner.length) out.push(copyStyle(n, { k: n.k, n: inner }, false));
      continue;
    }
    if (n.k === "frac") {
      const a = cleanNodes(n.n, depth + 1, budget);
      const b = cleanNodes(n.d, depth + 1, budget);
      if (a.length || b.length) out.push(copyStyle(n, { k: "frac", n: a, d: b }, false));
    }
  }
  return out;
}

export function sanitizeDoc(doc) {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.b)) return null;
  const budget = { left: MAX_CHARS };
  const blocks = doc.b.slice(0, 400).map((bl) => {
    const block = { n: cleanNodes(bl && bl.n, 0, budget) };
    if (bl && (bl.a === "c" || bl.a === "r")) block.a = bl.a;
    return block;
  });
  const out = { b: blocks.length ? blocks : [{ n: [] }] };
  if (typeof doc.s === "number" && doc.s >= 6 && doc.s <= 300) out.s = Math.round(doc.s * 10) / 10;
  if (doc.fx && typeof doc.fx === "object") {
    const fx = {};
    for (const [fam, url] of Object.entries(doc.fx).slice(0, 12)) {
      if (FAMILY.test(fam) && isFontUrl(url)) fx[fam] = url;
    }
    if (Object.keys(fx).length) out.fx = fx;
  }
  return out;
}

// Uploaded fonts live in the app's own storage, nowhere else (in its
// fonts folder, or a board's own folder: see fonts.js).
const APP_HOST = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "").host.toLowerCase();
  } catch (err) {
    return "";
  }
})();

export function isFontUrl(url) {
  if (typeof url !== "string" || url.length >= 400 || url.includes("..")) return false;
  const m = /^https:\/\/([a-z0-9.-]+)\/storage\/v1\/object\/public\/board-images\/(?:[A-Za-z0-9-]+\/)?fonts\/[A-Za-z0-9_\-/]+\.(?:ttf|otf|woff2?)$/.exec(url);
  if (!m) return false;
  // the app's own storage (any Supabase project's, if that isn't known here)
  return APP_HOST ? m[1] === APP_HOST : /\.supabase\.co$/.test(m[1]);
}

// The families a box uses (to load them before drawing).
export function familiesIn(doc) {
  const out = new Set();
  const walk = (nodes) => {
    for (const n of nodes) {
      if (typeof n === "string") continue;
      if (n.f) out.add(n.f);
      if (n.n) walk(n.n);
      if (n.d) walk(n.d);
    }
  };
  doc.b.forEach((bl) => walk(bl.n));
  return [...out];
}

// ---------- fonts used while drawing ----------

// Something that can be told when a font has loaded (fonts.js sets it),
// and turns a family into what's asked for (fonts.js loads it).
let fontHooks = { ensure: () => {}, version: () => 0 };
export function setFontHooks(hooks) {
  fontHooks = { ...fontHooks, ...hooks };
}

function fontString(st) {
  const fam = st.f ? `"${st.f}", ${BASE_FONT}` : BASE_FONT;
  return `${st.i ? "italic " : ""}${st.b ? "700 " : ""}${st.z}px ${fam}`;
}

// ---------- layout ----------

const layoutCache = new Map();

function metricsFor(ctx, st) {
  ctx.font = fontString(st);
  const m = ctx.measureText("Hg");
  const asc = m.fontBoundingBoxAscent || st.z * 0.92;
  const desc = m.fontBoundingBoxDescent || st.z * 0.24;
  return { asc, desc };
}

function styleOf(base, n) {
  if (typeof n === "string") return base;
  const st = { ...base };
  if (n.b) st.b = 1;
  if (n.i) st.i = 1;
  if (n.u) st.u = 1;
  if (n.c) st.c = n.c;
  if (n.h) st.h = n.h;
  if (n.f) st.f = n.f;
  if (n.z) st.z = n.z;
  return st;
}

// A row of nodes laid out side by side (no wrapping): used inside powers,
// subscripts and fractions. Returns { w, asc, desc, draw(ctx, x, y, ink) }.
function rowBox(ctx, nodes, st) {
  const items = [];
  let x = 0, asc = 0, desc = 0;
  for (const n of nodes) {
    const parts = n && typeof n === "object" && n.k ? [atomBox(ctx, n, styleOf(st, n))] : [textBox(ctx, typeof n === "string" ? n : n.s, styleOf(st, n))];
    for (const b of parts) {
      items.push({ x, b });
      x += b.w;
      asc = Math.max(asc, b.asc);
      desc = Math.max(desc, b.desc);
    }
  }
  if (!items.length) {
    const m = metricsFor(ctx, st);
    asc = m.asc * 0.7;
    desc = m.desc * 0.5;
    x = st.z * 0.35;
  }
  return {
    w: x, asc, desc,
    draw(c, ox, base, ink) {
      for (const it of items) it.b.draw(c, ox + it.x, base, ink);
    },
  };
}

function textBox(ctx, s, st) {
  ctx.font = fontString(st);
  const w = ctx.measureText(s).width;
  const m = metricsFor(ctx, st);
  return {
    w, asc: m.asc, desc: m.desc, st, text: s,
    draw(c, x, base, ink) {
      if (st.h) {
        c.fillStyle = st.h;
        c.globalAlpha = 0.55;
        c.fillRect(x, base - m.asc, w, m.asc + m.desc);
        c.globalAlpha = 1;
      }
      c.font = fontString(st);
      c.fillStyle = ink(st.c);
      c.textBaseline = "alphabetic";
      c.fillText(s, x, base);
      if (st.u) c.fillRect(x, base + Math.max(1, st.z * 0.1), w, Math.max(1, st.z / 15));
    },
  };
}

function atomBox(ctx, n, st) {
  const z = st.z;
  if (n.k === "sup" || n.k === "sub") {
    const inner = rowBox(ctx, n.n, { ...st, z: Math.max(6, z * 0.7), h: undefined, u: undefined });
    const up = n.k === "sup" ? z * 0.42 : -z * 0.2;
    return {
      w: inner.w + z * 0.04,
      asc: Math.max(0, inner.asc + up),
      desc: Math.max(0, inner.desc - up),
      draw(c, x, base, ink) {
        inner.draw(c, x + z * 0.02, base - up, ink);
      },
    };
  }
  // a fraction
  const small = { ...st, z: Math.max(6, z * 0.85), h: undefined, u: undefined };
  const top = rowBox(ctx, n.n, small);
  const bot = rowBox(ctx, n.d, small);
  const pad = z * 0.12;
  const gap = z * 0.1;
  const bar = Math.max(1, z / 16);
  const axis = z * 0.3; // the fraction line sits this far above the baseline
  const w = Math.max(top.w, bot.w) + pad * 2;
  return {
    w,
    asc: axis + gap + top.desc + top.asc,
    desc: Math.max(0, -axis + gap + bot.asc + bot.desc),
    draw(c, x, base, ink) {
      top.draw(c, x + (w - top.w) / 2, base - axis - gap - top.desc, ink);
      bot.draw(c, x + (w - bot.w) / 2, base - axis + gap + bot.asc, ink);
      c.fillStyle = ink(st.c);
      c.fillRect(x + pad * 0.4, base - axis - bar / 2, w - pad * 0.8, bar);
    },
  };
}

// Splits a block into pieces for wrapping: words (with any maths stuck to
// them) and the spaces between.
function piecesOf(ctx, nodes, base) {
  const pieces = [];
  let word = null;
  const flush = () => {
    if (word) pieces.push(word);
    word = null;
  };
  const add = (box) => {
    if (!word) word = { kind: "word", boxes: [], w: 0, asc: 0, desc: 0 };
    word.boxes.push({ x: word.w, b: box });
    word.w += box.w;
    word.asc = Math.max(word.asc, box.asc);
    word.desc = Math.max(word.desc, box.desc);
  };
  for (const n of nodes) {
    if (n && typeof n === "object" && n.k) {
      add(atomBox(ctx, n, styleOf(base, n)));
      continue;
    }
    const st = styleOf(base, n);
    const s = typeof n === "string" ? n : n.s;
    const bits = s.split(/( +)/);
    for (const bit of bits) {
      if (!bit) continue;
      if (/^ +$/.test(bit)) {
        flush();
        const b = textBox(ctx, bit, st);
        pieces.push({ kind: "space", boxes: [{ x: 0, b }], w: b.w, asc: b.asc, desc: b.desc });
      } else {
        add(textBox(ctx, bit, st));
      }
    }
  }
  flush();
  return pieces;
}

// Lines, positions and size of a text box (world units, relative to its
// top-left). Cached: the same box isn't measured twice.
export function layoutText(ctx, t) {
  const width = t.width || 240;
  const size = t.fontSize || 24;
  const key = `${t.text}\u0001${size}\u0001${width}\u0001${t.color}\u0001${fontHooks.version()}`;
  const hit = layoutCache.get(key);
  if (hit) return hit;
  const doc = scaleSizes(decodeText(t.text), size);
  if (doc.fx) for (const [fam, url] of Object.entries(doc.fx)) fontHooks.ensure(fam, url);
  for (const fam of familiesIn(doc)) fontHooks.ensure(fam);
  const base = { z: size, c: t.color || "#1a1a1a" };
  const baseM = metricsFor(ctx, base);
  const lines = [];
  for (const bl of doc.b) {
    const pieces = piecesOf(ctx, bl.n, base);
    let line = { items: [], w: 0, asc: baseM.asc, desc: baseM.desc, minH: size * 1.3, align: bl.a };
    const push = () => {
      // spaces at the end of a line don't count
      while (line.items.length && line.items[line.items.length - 1].p.kind === "space") {
        const sp = line.items.pop();
        line.w -= sp.p.w;
      }
      lines.push(line);
    };
    for (const p of pieces) {
      if (p.kind === "space" && !line.items.length && line.soft) continue;
      if (p.kind === "word" && line.w + p.w > width && line.items.some((it) => it.p.kind === "word")) {
        push();
        line = { items: [], w: 0, asc: baseM.asc, desc: baseM.desc, minH: size * 1.3, align: bl.a, soft: true };
      }
      line.items.push({ x: line.w, p });
      line.w += p.w;
      line.asc = Math.max(line.asc, p.asc);
      line.desc = Math.max(line.desc, p.desc);
      line.minH = Math.max(line.minH, (p.boxes[0] && p.boxes[0].b.st ? p.boxes[0].b.st.z : size) * 1.3);
    }
    push();
  }
  let y = 0;
  for (const ln of lines) {
    ln.top = y;
    ln.h = Math.max(ln.minH, ln.asc + ln.desc);
    ln.base = y + ln.asc;
    const free = Math.max(0, width - ln.w);
    ln.dx = ln.align === "c" ? free / 2 : ln.align === "r" ? free : 0;
    y += ln.h;
  }
  const out = { lines, height: Math.max(y, size * 1.3), width };
  if (layoutCache.size > 400) layoutCache.clear();
  layoutCache.set(key, out);
  return out;
}

export function textBoxHeight(ctx, t) {
  return layoutText(ctx, t).height;
}

// Paints a text box (with its rotation) at its place on the board.
// opts.dark: the page is dark (black writing shows white: inkColor.js).
export function drawText(ctx, t, opts = {}) {
  const lay = layoutText(ctx, t);
  const w = t.width || 240;
  const rotation = t.rotation || 0;
  const baseColor = t.color || "#1a1a1a";
  const ink = (c) => inkOn(c || baseColor, !!opts.dark);
  ctx.save();
  if (rotation) {
    const cx = t.x + w / 2, cy = t.y + lay.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    ctx.translate(-cx, -cy);
  }
  for (const ln of lay.lines) {
    for (const it of ln.items) {
      for (const bx of it.p.boxes) bx.b.draw(ctx, t.x + ln.dx + it.x + bx.x, t.y + ln.base, ink);
    }
  }
  ctx.restore();
  return lay;
}
