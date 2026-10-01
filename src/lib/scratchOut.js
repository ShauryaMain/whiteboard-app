// "Scribble to erase": decides whether a finished pen stroke was a
// scratch-out (a quick back-and-forth zig-zag drawn over something) and,
// if so, what it covered. Deliberately strict — it must look like a
// scribble AND sit on top of existing ink — so tracing over a line twice,
// shading, or writing zig-zaggy letters never deletes anything.
//
// All measurements are in screen pixels (world × zoom), so it behaves the
// same at any zoom level.

const RESAMPLE_PX = 3;
const TURN_WINDOW = 3; // samples (~9px) either side when measuring direction
const TURN_COS = -0.5; // a turn sharper than 120° counts as a reversal
const MIN_TURNS = 4; // at least ~3 full back-and-forths
const MIN_INK_RATIO = 2.2; // path length ÷ size of the area it covers
const MIN_STRAIGHTNESS = 0.72; // passes are mostly straight (not loopy letters)
const MIN_REVERSAL_SHARE = 0.75; // consecutive passes mostly point opposite ways
const COVER_SHARE = 0.6; // ≥60% of a stroke must be under the scribble
const MIN_SPAN_SHARE = 0.5; // what's erased must stretch across most of the scribble

function resample(points, step) {
  if (!points.length) return [];
  const out = [{ x: points[0].x, y: points[0].y }];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg === 0) continue;
    let d = step - carry;
    while (d <= seg) {
      const t = d / seg;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      d += step;
    }
    carry = seg - (d - step);
  }
  const last = points[points.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last.x - tail.x, last.y - tail.y) > step / 3) out.push({ x: last.x, y: last.y });
  return out;
}

function pathLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

function bounds(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

// Indices where the path sharply reverses direction.
function findTurns(r) {
  const k = TURN_WINDOW;
  const candidates = [];
  for (let i = k; i < r.length - k; i++) {
    const ax = r[i].x - r[i - k].x, ay = r[i].y - r[i - k].y;
    const bx = r[i + k].x - r[i].x, by = r[i + k].y - r[i].y;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1 || lb < 1) continue;
    const cos = (ax * bx + ay * by) / (la * lb);
    if (cos < TURN_COS) candidates.push({ i, cos });
  }
  // Each sharp corner shows up as a run of neighbouring samples — keep the
  // sharpest sample of each run.
  const turns = [];
  for (const c of candidates) {
    const prev = turns[turns.length - 1];
    if (prev && c.i - prev.i <= k + 1) {
      if (c.cos < prev.cos) turns[turns.length - 1] = c;
    } else {
      turns.push(c);
    }
  }
  return turns.map((t) => t.i);
}

// Returns null, or a description of the scribble's shape for the coverage
// step: { hull, box, pad }.
export function scribbleShape(stroke, scale) {
  if (!stroke || stroke.tool !== "pen" || !stroke.points || stroke.points.length < 10) return null;
  const screen = stroke.points.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  const r = resample(screen, RESAMPLE_PX);
  if (r.length < 16) return null;
  const length = pathLength(r);
  const box = bounds(r);
  const diag = Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
  if (diag < 14 || length < 70) return null;
  if (length / diag < MIN_INK_RATIO) return null;

  const turns = findTurns(r);
  if (turns.length < MIN_TURNS) return null;

  // Passes = the pieces between turns (ignoring the run-in and run-out).
  const passes = [];
  for (let t = 0; t + 1 < turns.length; t++) {
    const piece = r.slice(turns[t], turns[t + 1] + 1);
    const chord = { x: piece[piece.length - 1].x - piece[0].x, y: piece[piece.length - 1].y - piece[0].y };
    const len = pathLength(piece);
    passes.push({ chord, len, straight: len > 0 ? Math.hypot(chord.x, chord.y) / len : 0 });
  }
  if (passes.length < MIN_TURNS - 1) return null;
  const straightness = passes.map((p) => p.straight).sort((a, b) => a - b)[Math.floor(passes.length / 2)];
  if (straightness < MIN_STRAIGHTNESS) return null;
  const medianLen = passes.map((p) => p.len).sort((a, b) => a - b)[Math.floor(passes.length / 2)];
  if (medianLen < 10) return null;
  let reversals = 0;
  for (let i = 1; i < passes.length; i++) {
    const a = passes[i - 1].chord, b = passes[i].chord;
    const la = Math.hypot(a.x, a.y), lb = Math.hypot(b.x, b.y);
    if (la && lb && (a.x * b.x + a.y * b.y) / (la * lb) < TURN_COS) reversals++;
  }
  if (reversals / (passes.length - 1) < MIN_REVERSAL_SHARE) return null;

  return { hull: convexHull(r), box, pad: 4 + ((stroke.width || 3) * scale) / 2 };
}

function convexHull(points) {
  const pts = points.map((p) => [p.x, p.y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function insideHull(hull, x, y) {
  // hull is counter-clockwise from convexHull()
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false;
  }
  return true;
}

function distToSegment(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  let t = len ? ((px - a[0]) * dx + (py - a[1]) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a[0] + t * dx - px, a[1] + t * dy - py);
}

function covered(shape, x, y) {
  const { hull, pad } = shape;
  if (hull.length >= 3 && insideHull(hull, x, y)) return true;
  for (let i = 0; i < hull.length; i++) {
    if (distToSegment(x, y, hull[i], hull[(i + 1) % hull.length]) <= pad) return true;
  }
  return false;
}

// Finds what a scribble scratched out. `strokes` and `texts` are the
// board's current objects (world units); `textHeight(t)` gives a text box's
// height. Returns { strokeIds, textIds } or null when nothing qualifies.
export function detectScratchOut(stroke, { strokes = [], texts = [], textHeight }, scale) {
  const shape = scribbleShape(stroke, scale);
  if (!shape) return null;
  const pad = shape.pad;
  const area = {
    minX: shape.box.minX - pad, minY: shape.box.minY - pad,
    maxX: shape.box.maxX + pad, maxY: shape.box.maxY + pad,
  };
  const strokeIds = [];
  const textIds = [];
  const hitBoxes = [];

  for (const s of strokes) {
    if (!s || s.id === stroke.id || s.tool === "eraser" || !s.points || !s.points.length) continue;
    const pts = s.points.map((p) => ({ x: p.x * scale, y: p.y * scale }));
    const b = bounds(pts);
    if (b.maxX < area.minX || b.minX > area.maxX || b.maxY < area.minY || b.minY > area.maxY) continue;
    const r = pts.length === 1 ? pts : resample(pts, RESAMPLE_PX);
    let inside = 0;
    for (const p of r) if (covered(shape, p.x, p.y)) inside++;
    if (inside / r.length >= COVER_SHARE) {
      strokeIds.push(s.id);
      hitBoxes.push(b);
    }
  }

  for (const t of texts) {
    const h = (textHeight ? textHeight(t) : (t.fontSize || 24) * 1.3) * scale;
    const w = (t.width || 240) * scale;
    const x0 = t.x * scale, y0 = t.y * scale;
    const b = { minX: x0, minY: y0, maxX: x0 + w, maxY: y0 + h };
    if (b.maxX < area.minX || b.minX > area.maxX || b.maxY < area.minY || b.minY > area.maxY) continue;
    let inside = 0, total = 0;
    for (let gx = 0; gx <= 4; gx++) {
      for (let gy = 0; gy <= 2; gy++) {
        total++;
        if (covered(shape, x0 + (w * gx) / 4, y0 + (h * gy) / 2)) inside++;
      }
    }
    if (inside / total >= COVER_SHARE) {
      textIds.push(t.id);
      hitBoxes.push(b);
    }
  }

  if (!strokeIds.length && !textIds.length) return null;
  // Guard against shading: what gets erased has to stretch across at least
  // half the scribble (in width or height) — not be a small mark somewhere
  // inside a big shaded area. A crossed-out line passes (it spans the
  // width); a little label inside hatching doesn't.
  const u = hitBoxes.reduce((acc, b) => ({
    minX: Math.min(acc.minX, b.minX), minY: Math.min(acc.minY, b.minY),
    maxX: Math.max(acc.maxX, b.maxX), maxY: Math.max(acc.maxY, b.maxY),
  }));
  const spanX = (Math.min(u.maxX, area.maxX) - Math.max(u.minX, area.minX)) / (area.maxX - area.minX);
  const spanY = (Math.min(u.maxY, area.maxY) - Math.max(u.minY, area.minY)) / (area.maxY - area.minY);
  if (Math.max(spanX, spanY) < MIN_SPAN_SHARE) return null;
  return { strokeIds, textIds };
}
