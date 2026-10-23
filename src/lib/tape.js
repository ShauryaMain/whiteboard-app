// Tape: a strip that covers part of a notebook page (an answer, a word, a
// definition) until it's tapped. For revising: "Quiz me" covers every
// piece on a page and shows them one at a time (see quiz.js).
//
// A piece of tape is kept as a picture on the board (the images table),
// whose picture is a small striped drawing (TAPE_SRC). So it's saved,
// moved with its page, copied, undone and shared live exactly like a
// picture, and anything that only knows about pictures (an exported page,
// an older copy of the app) shows it as covered tape. Unlike a picture, it
// sits *above* the writing, so it hides it.
//
// Whether a piece is showing what's under it is this person's own, for
// now: nothing about that is saved or sent.
//
// Pure functions only (no React, no Supabase).

export const TAPE_COLOR = "#F2CF66";
const MARK = 'id="cs-tape"';

const SVG =
  `<svg ${MARK} xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40" preserveAspectRatio="none">` +
  `<rect width="120" height="40" rx="5" fill="${TAPE_COLOR}"/>` +
  `<path d="M-10 40L30 0M14 40L54 0M38 40L78 0M62 40L102 0M86 40L126 0M110 40L150 0" stroke="#fff" stroke-opacity="0.3" stroke-width="5"/>` +
  `</svg>`;

export const TAPE_SRC = "data:image/svg+xml," + encodeURIComponent(SVG);
const ENCODED_MARK = encodeURIComponent(MARK);

export function isTape(img) {
  return !!img && typeof img.src === "string" && img.src.startsWith("data:image/svg+xml,") && img.src.includes(ENCODED_MARK);
}

export function splitTapes(images) {
  const pictures = [];
  const tapes = [];
  for (const img of images || []) (isTape(img) ? tapes : pictures).push(img);
  return { pictures, tapes };
}

// The smallest piece of tape (board units) worth keeping.
export const MIN_TAPE = 8;

// A new piece of tape between two corners, kept inside `rect` (the page),
// or null when it's too small.
export function tapeFromCorners(id, a, b, rect) {
  let x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  let x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  if (rect) {
    x0 = Math.max(rect.x, x0);
    y0 = Math.max(rect.y, y0);
    x1 = Math.min(rect.x + rect.w, x1);
    y1 = Math.min(rect.y + rect.h, y1);
  }
  const width = x1 - x0, height = y1 - y0;
  if (!(width >= MIN_TAPE) || !(height >= MIN_TAPE * 0.75)) return null;
  const r = (v) => Math.round(v * 10) / 10;
  return { id, x: r(x0), y: r(y0), width: r(width), height: r(height), src: TAPE_SRC };
}

// The topmost piece of tape under a point (pad: board units of slack).
export function tapeAt(images, p, pad = 0) {
  const list = images || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const t = list[i];
    if (!isTape(t)) continue;
    if (p.x >= t.x - pad && p.x <= t.x + t.width + pad && p.y >= t.y - pad && p.y <= t.y + t.height + pad) return t;
  }
  return null;
}

// Pieces of tape a line from `a` to `b` passes over (for the eraser).
export function tapesAlong(images, a, b, pad = 0) {
  const out = [];
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4));
  const seen = new Set();
  for (let i = 0; i <= steps; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps };
    for (const t of images || []) {
      if (seen.has(t.id) || !isTape(t)) continue;
      if (p.x >= t.x - pad && p.x <= t.x + t.width + pad && p.y >= t.y - pad && p.y <= t.y + t.height + pad) {
        seen.add(t.id);
        out.push(t);
      }
    }
  }
  return out;
}

// The pieces of tape on a page (its box), in reading order: top to bottom,
// and left to right along a line.
export function tapesInReadingOrder(images, rect) {
  const inside = (images || []).filter((t) => {
    if (!isTape(t)) return false;
    const cy = t.y + t.height / 2;
    return !rect || (cy >= rect.y && cy <= rect.y + rect.h);
  });
  const lineOf = (t) => t.y + t.height / 2;
  return inside.sort((a, b) => {
    const dy = lineOf(a) - lineOf(b);
    // two pieces on (about) the same line: left first
    if (Math.abs(dy) < Math.min(a.height, b.height) * 0.6) return a.x - b.x;
    return dy;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Draws a piece of tape (board units; the context is already scaled).
// `revealed`: a faint dashed outline instead of the tape.
export function drawTapePiece(ctx, t, { revealed = false, scale = 1 } = {}) {
  const { x, y, width: w, height: h } = t;
  if (!(w > 0) || !(h > 0)) return;
  ctx.save();
  roundRect(ctx, x, y, w, h, Math.min(6, h / 4));
  if (revealed) {
    ctx.fillStyle = "rgba(242, 207, 102, 0.14)";
    ctx.fill();
    ctx.setLineDash([6 / scale, 5 / scale]);
    ctx.lineWidth = 1.5 / scale;
    ctx.strokeStyle = "rgba(163, 120, 0, 0.75)";
    ctx.stroke();
  } else {
    ctx.fillStyle = TAPE_COLOR;
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = 3 / Math.max(scale, 0.2);
    const step = 14;
    for (let sx = x - h; sx < x + w; sx += step) {
      ctx.beginPath();
      ctx.moveTo(sx, y + h);
      ctx.lineTo(sx + h, y);
      ctx.stroke();
    }
  }
  ctx.restore();
}
