// The reference document beside a board (a PDF, or a picture): what it is
// made of, and the markings people put on it.
//
// The document
//   { v: 2, fileName, fileType, url, path,          (url/path/fileType: what
//     pdf: { url, path, pageCount } | null,           older app versions read)
//     pages: [ { id, kind: "pdf", src, rotate }     a page of the PDF file
//            | { id, kind: "image", url, path, rotate }  a picture
//            | { id, kind: "blank", style, rotate } ] }  blank / lined / graph
// Pages are known by their id, so adding, turning or removing a page never
// moves anyone's markings onto the wrong page.
//
// A marking ("mark") is kept in fractions of its page (x across the width,
// y down the height; sizes as a fraction of the width), so it lands in the
// same place on every screen size and at every zoom:
//   { id, pageId, type: "ink", tool: "pen" | "highlighter" | "eraser",
//     color, opacity, widthFrac, points: [{ x, y }] }
//   { id, pageId, type: "text", x, y, w, size, color, text }
//   { id, pageId, type: "tape", x, y, w, h, revealed }

export const REF_MAX_PICK = 30; // pages picked from one PDF at a time
export const REF_MAX_PAGES = 100; // pages in the document altogether
export const REF_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const REF_MAX_READ_BYTES = 200 * 1024 * 1024;
export const BLANK_ASPECT = Math.SQRT2; // A4, portrait (height / width)
export const TAPE_COLOR = "#F2CF66";

export function newRefId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // (older browsers) a version-4 style id
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const isPdfType = (t) => t === "application/pdf";

// Any document (including one from an older version of the app, which has
// no page list) -> the shape above. null for nothing.
export function normalizeDoc(doc) {
  if (!doc || typeof doc !== "object") return null;
  if (doc.v === 2 && Array.isArray(doc.pages)) return doc;
  if (isPdfType(doc.fileType)) {
    const n = Math.max(1, Number(doc.pageCount) || 1);
    const pages = [];
    for (let i = 1; i <= n; i++) pages.push({ id: `p${i}`, kind: "pdf", src: i, rotate: 0 });
    return { ...doc, v: 2, pdf: { url: doc.url, path: doc.path, pageCount: n }, pages };
  }
  return { ...doc, v: 2, pdf: null, pages: [{ id: "p1", kind: "image", url: doc.url, path: doc.path, rotate: 0 }] };
}

// The page's label as people see it: its place in the document.
export function pageNumberOf(doc, pageId) {
  if (!doc) return 0;
  const i = doc.pages.findIndex((p) => p.id === pageId);
  return i + 1;
}

// Every file the document uses in storage (to tidy up when it's removed).
export function docFilePaths(doc) {
  const out = new Set();
  if (!doc) return [];
  if (doc.pdf && doc.pdf.path) out.add(doc.pdf.path);
  if (doc.path) out.add(doc.path);
  for (const p of doc.pages || []) if (p.kind === "image" && p.path) out.add(p.path);
  return [...out];
}

// ---------- markings ----------

// A marking as it may arrive from an older version of the app (a pen line
// with a page number) -> the shape above.
export function normalizeMark(m) {
  if (!m || typeof m !== "object" || !m.id) return null;
  if (m.type) return m;
  if (!Array.isArray(m.points)) return null;
  return {
    id: m.id,
    pageId: m.pageId || `p${m.pageNum || 1}`,
    type: "ink",
    tool: m.tool || "pen",
    color: m.color || "#1a1a1a",
    opacity: m.opacity ?? 1,
    widthFrac: m.widthFrac || 0.005,
    points: m.points,
  };
}

export function normalizeMarks(list) {
  const out = [];
  for (const m of list || []) {
    const n = normalizeMark(m);
    if (n) out.push(n);
  }
  return out;
}

// Adds / changes / removes markings in a list (in the order they came).
export function applyMarksChange(list, change) {
  if (!change) return list;
  const add = normalizeMarks(change.add);
  const update = normalizeMarks(change.update);
  const remove = new Set(change.remove || []);
  if (!add.length && !update.length && !remove.size) return list;
  const replace = new Map();
  for (const m of add) replace.set(m.id, m);
  for (const m of update) replace.set(m.id, m);
  const out = [];
  const seen = new Set();
  for (const m of list) {
    if (remove.has(m.id)) continue;
    const r = replace.get(m.id);
    out.push(r || m);
    seen.add(m.id);
  }
  for (const m of add) if (!seen.has(m.id) && !remove.has(m.id)) {
    out.push(m);
    seen.add(m.id);
  }
  for (const m of update) if (!seen.has(m.id) && !remove.has(m.id)) {
    out.push(m);
    seen.add(m.id);
  }
  return out;
}

// Splits a long list into pieces small enough for one live message.
export function chunkList(list, maxChars = 60000) {
  const pieces = [];
  let piece = [];
  let size = 0;
  for (const item of list) {
    const n = JSON.stringify(item).length;
    if (piece.length && size + n > maxChars) {
      pieces.push(piece);
      piece = [];
      size = 0;
    }
    piece.push(item);
    size += n;
  }
  if (piece.length) pieces.push(piece);
  return pieces;
}

// ---------- geometry (in page pixels: W x H) ----------

let measureCtx = null;
function measurer() {
  if (!measureCtx && typeof document !== "undefined") measureCtx = document.createElement("canvas").getContext("2d");
  return measureCtx;
}

let cachedFamily = null;
export function uiFontFamily() {
  if (cachedFamily) return cachedFamily;
  try {
    cachedFamily = getComputedStyle(document.body).fontFamily || "sans-serif";
  } catch (err) {
    cachedFamily = "sans-serif";
  }
  return cachedFamily;
}

// The lines of a text marking, wrapped to its width, and its height (px).
export function textLayout(m, W, ctx) {
  const c = ctx || measurer();
  const fontPx = Math.max(4, (m.size || 0.03) * W);
  const maxW = Math.max(fontPx * 2, (m.w || 0.4) * W);
  const lines = [];
  if (c) c.font = `${fontPx}px ${uiFontFamily()}`;
  const paragraphs = String(m.text || "").split("\n");
  for (const para of paragraphs) {
    const words = para.split(/(\s+)/);
    let line = "";
    for (const word of words) {
      const next = line + word;
      if (line && c && c.measureText(next).width > maxW) {
        lines.push(line.trimEnd());
        line = word.trimStart();
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  const lineH = fontPx * 1.25;
  return { lines, fontPx, lineH, width: maxW, height: Math.max(lineH, lines.length * lineH) };
}

// Bounding box of a marking, in page pixels.
export function markBounds(m, W, H) {
  if (m.type === "ink") {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of m.points) {
      const x = p.x * W, y = p.y * H;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const pad = ((m.widthFrac || 0) * W) / 2;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }
  if (m.type === "text") {
    const lay = textLayout(m, W);
    return { minX: m.x * W, minY: m.y * H, maxX: m.x * W + lay.width, maxY: m.y * H + lay.height };
  }
  return { minX: m.x * W, minY: m.y * H, maxX: (m.x + m.w) * W, maxY: (m.y + m.h) * H };
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// Is (x, y) (page pixels) on this marking, within `tol` pixels?
export function hitMark(m, x, y, W, H, tol = 6) {
  if (m.type === "ink") {
    if (m.tool === "eraser") return false;
    const b = markBounds(m, W, H);
    if (x < b.minX - tol || x > b.maxX + tol || y < b.minY - tol || y > b.maxY + tol) return false;
    const r = tol + ((m.widthFrac || 0) * W) / 2;
    const pts = m.points;
    if (pts.length === 1) return Math.hypot(x - pts[0].x * W, y - pts[0].y * H) <= r;
    for (let i = 1; i < pts.length; i++) {
      if (distToSegment(x, y, pts[i - 1].x * W, pts[i - 1].y * H, pts[i].x * W, pts[i].y * H) <= r) return true;
    }
    return false;
  }
  const b = markBounds(m, W, H);
  return x >= b.minX - tol && x <= b.maxX + tol && y >= b.minY - tol && y <= b.maxY + tol;
}

// The top-most tape under a point, or null.
export function tapeAt(marks, x, y, W, H) {
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i];
    if (m.type === "tape" && hitMark(m, x, y, W, H, 2)) return m;
  }
  return null;
}

// The top-most text box under a point, or null.
export function textAt(marks, x, y, W, H) {
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i];
    if (m.type === "text" && hitMark(m, x, y, W, H, 4)) return m;
  }
  return null;
}

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
  }
  return inside;
}

// The markings a lasso (a loop of page-pixel points) goes round: a line
// counts when most of it is inside, a text box or tape when its middle is.
export function marksInLasso(marks, poly, W, H) {
  if (!poly || poly.length < 3) return [];
  const out = [];
  for (const m of marks) {
    if (m.type === "ink") {
      if (m.tool === "eraser") continue;
      const pts = m.points;
      const step = Math.max(1, Math.floor(pts.length / 40));
      let inside = 0, total = 0;
      for (let i = 0; i < pts.length; i += step) {
        total++;
        if (pointInPolygon(pts[i].x * W, pts[i].y * H, poly)) inside++;
      }
      if (total && inside / total >= 0.5) out.push(m);
    } else {
      const b = markBounds(m, W, H);
      if (pointInPolygon((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, poly)) out.push(m);
    }
  }
  return out;
}

export function unionMarkBounds(marks, W, H) {
  let b = null;
  for (const m of marks) {
    const r = markBounds(m, W, H);
    if (!b) b = { ...r };
    else {
      b.minX = Math.min(b.minX, r.minX);
      b.minY = Math.min(b.minY, r.minY);
      b.maxX = Math.max(b.maxX, r.maxX);
      b.maxY = Math.max(b.maxY, r.maxY);
    }
  }
  return b;
}

// Moved by (du, dv) and scaled by s about (ou, ov) (all in fractions).
export function transformMark(m, du, dv, s = 1, ou = 0, ov = 0) {
  const fx = (x) => ou + (x - ou) * s + du;
  const fy = (y) => ov + (y - ov) * s + dv;
  if (m.type === "ink") {
    return { ...m, widthFrac: m.widthFrac * s, points: m.points.map((p) => ({ x: fx(p.x), y: fy(p.y) })) };
  }
  if (m.type === "text") return { ...m, x: fx(m.x), y: fy(m.y), w: m.w * s, size: m.size * s };
  return { ...m, x: fx(m.x), y: fy(m.y), w: m.w * s, h: m.h * s };
}

// A page turned a quarter clockwise: its markings turn with it.
// `aspect` is the page's height / width before turning.
export function rotateMarkClockwise(m, aspect) {
  const k = 1 / (aspect || 1); // old width / new width
  if (m.type === "ink") {
    return { ...m, widthFrac: m.widthFrac * k, points: m.points.map((p) => ({ x: 1 - p.y, y: p.x })) };
  }
  if (m.type === "text") return { ...m, x: Math.max(0, 1 - m.y - 0.05), y: m.x, w: Math.min(0.9, m.w * k), size: m.size * k };
  return { ...m, x: 1 - m.y - m.h, y: m.x, w: m.h, h: m.w };
}

// ---------- drawing ----------

// A smooth line through the points (midpoint curves).
export function tracePath(ctx, pts, W, H) {
  if (!pts.length) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x * W, pts[0].y * H);
  if (pts.length === 1) {
    ctx.lineTo(pts[0].x * W + 0.01, pts[0].y * H);
    return;
  }
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x * W, pts[1].y * H);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = ((pts[i].x + pts[i + 1].x) / 2) * W;
    const my = ((pts[i].y + pts[i + 1].y) / 2) * H;
    ctx.quadraticCurveTo(pts[i].x * W, pts[i].y * H, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x * W, last.y * H);
}

export function drawInk(ctx, m, W, H) {
  if (!m.points || !m.points.length) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(0.5, m.widthFrac * W);
  if (m.tool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "#000";
    ctx.globalAlpha = 1;
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = m.color;
    ctx.globalAlpha = m.opacity ?? 1;
  }
  tracePath(ctx, m.points, W, H);
  ctx.stroke();
  ctx.restore();
}

export function drawText(ctx, m, W, H) {
  const lay = textLayout(m, W, ctx);
  ctx.save();
  ctx.font = `${lay.fontPx}px ${uiFontFamily()}`;
  ctx.fillStyle = m.color || "#1a1a1a";
  ctx.textBaseline = "top";
  lay.lines.forEach((line, i) => ctx.fillText(line, m.x * W, m.y * H + i * lay.lineH + lay.fontPx * 0.1));
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function drawTape(ctx, m, W, H) {
  const x = m.x * W, y = m.y * H, w = m.w * W, h = m.h * H;
  if (w < 1 || h < 1) return;
  ctx.save();
  roundRect(ctx, x, y, w, h, Math.min(6, h / 4));
  if (m.revealed) {
    ctx.fillStyle = "rgba(242, 207, 102, 0.14)";
    ctx.fill();
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(163, 120, 0, 0.75)";
    ctx.stroke();
  } else {
    ctx.fillStyle = m.color || TAPE_COLOR;
    ctx.fill();
    // faint stripes, so it reads as tape and not part of the page
    ctx.clip();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
    ctx.lineWidth = 3;
    for (let sx = x - h; sx < x + w; sx += 14) {
      ctx.beginPath();
      ctx.moveTo(sx, y + h);
      ctx.lineTo(sx + h, y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// The ink layer: lines (and the rubbing out between them), in order.
export function drawInkLayer(ctx, marks, W, H, hidden) {
  for (const m of marks) {
    if (m.type !== "ink" || (hidden && hidden.has(m.id))) continue;
    drawInk(ctx, m, W, H);
  }
}

// The top layer: tape, then text boxes (`editing` is left out: it's being
// typed in an editor on top).
export function drawTopLayer(ctx, marks, W, H, hidden, editing) {
  for (const m of marks) {
    if (m.type !== "tape" || (hidden && hidden.has(m.id))) continue;
    drawTape(ctx, m, W, H);
  }
  for (const m of marks) {
    if (m.type !== "text" || m.id === editing || (hidden && hidden.has(m.id))) continue;
    drawText(ctx, m, W, H);
  }
}

// Page patterns for blank pages ("lined", "graph", or plain).
export function drawBlankPage(ctx, style, W, H) {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  const step = W / 24;
  if (style === "lined") {
    ctx.strokeStyle = "rgba(36, 81, 214, 0.22)";
    ctx.lineWidth = Math.max(1, W / 700);
    for (let y = step * 3; y < H - step; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(229, 57, 53, 0.35)";
    ctx.beginPath();
    ctx.moveTo(step * 2.5, 0);
    ctx.lineTo(step * 2.5, H);
    ctx.stroke();
  } else if (style === "graph") {
    ctx.lineWidth = Math.max(0.5, W / 1400);
    for (let i = 0, x = 0; x <= W; x += step / 2, i++) {
      ctx.strokeStyle = i % 2 ? "rgba(36, 81, 214, 0.12)" : "rgba(36, 81, 214, 0.25)";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let i = 0, y = 0; y <= H; y += step / 2, i++) {
      ctx.strokeStyle = i % 2 ? "rgba(36, 81, 214, 0.12)" : "rgba(36, 81, 214, 0.25)";
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ---------- a tiny message bus (live pointer, "follow me") ----------

export function createBus() {
  const listeners = new Map();
  return {
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type).delete(fn);
    },
    emit(type, payload) {
      const set = listeners.get(type);
      if (!set) return;
      set.forEach((fn) => {
        try {
          fn(payload);
        } catch (err) {
          console.error(err);
        }
      });
    },
  };
}

// Live events about the reference document (see Whiteboard.js and
// ClassroomBoardViewer.js).
export const REF_EVENTS = [
  "reference-set", "reference-update", "reference-remove", "reference-request",
  "ref-marks", "ref-laser", "ref-view",
  // from older versions of the app
  "reference-stroke", "reference-stroke-remove",
];
