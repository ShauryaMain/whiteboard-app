// Turns the settings in the Shape dialog into a drawing: a list of pen
// lines plus a list of text labels. Pure maths only (no React, no
// Supabase), so the dialog's preview and the board get exactly the same
// picture, and it can be checked on its own.
//
// Everything is worked out in on-screen pixels around (0, 0), with y
// pointing down like the canvas. `shapeToBoardObjects` then places it on
// the board as ordinary strokes and text boxes.

const DEG = Math.PI / 180;

export const INK_FONT = "-apple-system, BlinkMacSystemFont, sans-serif";
export const MIN_SIDES = 3;
export const MAX_SIDES = 20;
export const MAX_BASE_SIDES = 12;
export const MIN_SIZE = 120;
export const MAX_SIZE = 640;

// How each kind of line is drawn, as a share of the chosen thickness.
const MAIN = { w: 1 };
const HIDDEN = { w: 0.8, dash: true };
const THIN = { w: 0.6 };
const THIN_DASH = { w: 0.6, dash: true };
const DOT = { w: 1.9 };

const POLYGON_NAMES = {
  3: "Equilateral triangle", 4: "Square", 5: "Regular pentagon", 6: "Regular hexagon", 7: "Regular heptagon",
  8: "Regular octagon", 9: "Regular nonagon", 10: "Regular decagon", 11: "Regular hendecagon", 12: "Regular dodecagon",
  13: "Regular tridecagon", 14: "Regular tetradecagon", 15: "Regular pentadecagon", 16: "Regular hexadecagon",
  17: "Regular heptadecagon", 18: "Regular octadecagon", 19: "Regular enneadecagon", 20: "Regular icosagon",
};

const BASE_NAMES = {
  3: "triangular", 4: "square", 5: "pentagonal", 6: "hexagonal", 7: "heptagonal", 8: "octagonal",
  9: "nonagonal", 10: "decagonal", 11: "hendecagonal", 12: "dodecagonal",
};

// ---------- the facts about regular polygons ----------

export function polygonName(n) {
  return POLYGON_NAMES[n] || `Regular ${n}-sided polygon`;
}

export function interiorAngle(n) {
  return (180 * (n - 2)) / n;
}

export function exteriorAngle(n) {
  return 360 / n;
}

export function angleSum(n) {
  return 180 * (n - 2);
}

// Which regular polygon has this interior / exterior angle? Returns the
// exact (possibly fractional) number of sides, the nearest whole number
// that's allowed, and whether the angle really belongs to that polygon.
export function sidesForAngle(kind, degrees) {
  const a = Number(degrees);
  if (!Number.isFinite(a) || a <= 0 || a >= 180) return { exact: NaN, nearest: null, matches: false };
  const exact = kind === "interior" ? 360 / (180 - a) : 360 / a;
  const nearest = clamp(Math.round(exact), MIN_SIDES, MAX_SIDES);
  const real = kind === "interior" ? interiorAngle(nearest) : exteriorAngle(nearest);
  return { exact, nearest, matches: Math.abs(real - a) < 0.006 };
}

// ---------- numbers and text ----------

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function fmt(value, dp = 2) {
  if (!Number.isFinite(value)) return "";
  const k = 10 ** dp;
  const r = Math.round(value * k) / k;
  return String(Object.is(r, -0) ? 0 : r);
}

export function cleanUnit(unit) {
  return String(unit || "").replace(/\s+/g, " ").trim().slice(0, 8);
}

// "5 cm" — joined with a non-breaking space so a label never wraps onto
// two lines on a device whose font is a little wider.
export function lengthText(value, unit) {
  const u = cleanUnit(unit);
  return fmt(value) + (u ? " " + u : "");
}

export function angleText(degrees) {
  return fmt(degrees, 1) + "°";
}

function areaText(value, unit) {
  const u = cleanUnit(unit);
  return fmt(value) + (u ? " " + u + "²" : "");
}

function volumeText(value, unit) {
  const u = cleanUnit(unit);
  return fmt(value) + (u ? " " + u + "³" : "");
}

export function letterAt(i) {
  const base = String.fromCharCode(65 + (i % 26));
  return i < 26 ? base : base + Math.floor(i / 26);
}

// Rough text widths, for when there's no canvas to measure with (tests,
// server). The browser version below measures for real.
const NARROW = new Set([".", ",", "'", "i", "l", "I", " ", " ", "1"]);
export const fallbackTextEnv = {
  width(text, size) {
    let w = 0;
    for (const ch of String(text)) w += NARROW.has(ch) ? 0.3 : ch === "°" ? 0.4 : 0.58;
    return w * size;
  },
  // how far below the top of a line of text the middle of a digit sits
  middle(size) {
    return size * 0.46;
  },
};

let browserEnv = null;
export function browserTextEnv() {
  if (typeof document === "undefined") return fallbackTextEnv;
  if (browserEnv) return browserEnv;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return fallbackTextEnv;
  const middles = new Map();
  browserEnv = {
    width(text, size) {
      ctx.font = `${size}px ${INK_FONT}`;
      return ctx.measureText(String(text)).width;
    },
    middle(size) {
      if (middles.has(size)) return middles.get(size);
      ctx.font = `${size}px ${INK_FONT}`;
      ctx.textBaseline = "top";
      const m = ctx.measureText("5");
      const known = Number.isFinite(m.actualBoundingBoxAscent) && Number.isFinite(m.actualBoundingBoxDescent);
      const mid = known ? (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2 : size * 0.46;
      middles.set(size, mid);
      return mid;
    },
  };
  return browserEnv;
}

// ---------- small vector helpers ----------

const pt = (x, y) => ({ x, y });
const add = (a, b) => pt(a.x + b.x, a.y + b.y);
const sub = (a, b) => pt(a.x - b.x, a.y - b.y);
const mul = (a, k) => pt(a.x * k, a.y * k);
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const length = (a) => Math.hypot(a.x, a.y);
const mid = (a, b) => pt((a.x + b.x) / 2, (a.y + b.y) / 2);
const perp = (a) => pt(-a.y, a.x);

function unit(a, fallback = pt(0, -1)) {
  const l = length(a);
  return l > 1e-9 ? pt(a.x / l, a.y / l) : fallback;
}

function boundsOf(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

// ---------- paths ----------
//
// The board draws a pen line of three or more points as a smooth curve
// through them. Writing a corner point twice makes the curve pass exactly
// through it and turn sharply, so one line can hold a whole outline with
// crisp corners.

function cornered(points, closed) {
  const out = [];
  const n = points.length;
  if (n < 2) return points.slice();
  out.push(points[0]);
  for (let i = 1; i < n - 1; i++) out.push(points[i], points[i]);
  if (closed) out.push(points[n - 1], points[n - 1], points[0]);
  else out.push(points[n - 1]);
  return out;
}

function arcPoints(c, r, a0, a1) {
  const sweep = a1 - a0;
  const n = clamp(Math.ceil((Math.abs(sweep) * Math.max(r, 4)) / 5), 4, 120);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    out.push(pt(c.x + r * Math.cos(a), c.y + r * Math.sin(a)));
  }
  return out;
}

function ellipsePoints(c, a, b, t0, t1) {
  const sweep = t1 - t0;
  const n = clamp(Math.ceil((Math.abs(sweep) * Math.max(Math.abs(a), Math.abs(b), 4)) / 5), 6, 120);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + (sweep * i) / n;
    out.push(pt(c.x + a * Math.cos(t), c.y + b * Math.sin(t)));
  }
  return out;
}

// ---------- the drawing being built ----------

function newDrawing(cfg, env) {
  const size = clamp(Number(cfg.size) || 280, 40, 1200);
  const fontSize = clamp(Math.round(size * 0.062), 14, 22);
  return {
    strokes: [], labels: [], fontSize, size, env,
    unit: cleanUnit(cfg.unit),
    show: { angles: false, lengths: false, letters: false, marks: false, ...(cfg.labels || {}) },
    title: "", facts: [], error: null,
  };
}

function stroke(d, points, style = MAIN) {
  if (points.length < 2) return;
  d.strokes.push({ points, w: style.w, dash: !!style.dash });
}

function dotAt(d, p) {
  d.strokes.push({ points: [p, pt(p.x + 0.01, p.y)], w: DOT.w, dash: false });
}

function textBox(d, text) {
  return { w: d.env.width(text, d.fontSize), h: d.fontSize * 0.78 };
}

// A label next to `p`, pushed out in direction `dir` far enough that its
// box clears the point by `gap` whichever way the direction points.
function labelBeside(d, p, dir, text, gap = 6) {
  const box = textBox(d, text);
  const reach = gap + (Math.abs(dir.x) * box.w) / 2 + (Math.abs(dir.y) * box.h) / 2;
  d.labels.push({ cx: p.x + dir.x * reach, cy: p.y + dir.y * reach, text });
}

// How much a label at this spot would sit on top of things already drawn.
function segmentHitsBox(a, b, r) {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const edges = [[-dx, a.x - r.minX], [dx, r.maxX - a.x], [-dy, a.y - r.minY], [dy, r.maxY - a.y]];
  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

function clashes(d, cx, cy, text) {
  const box = textBox(d, text);
  const r = { minX: cx - box.w / 2 - 2, maxX: cx + box.w / 2 + 2, minY: cy - box.h / 2 - 2, maxY: cy + box.h / 2 + 2 };
  let n = 0;
  for (const s of d.strokes) {
    for (let i = 1; i < s.points.length; i++) {
      if (segmentHitsBox(s.points[i - 1], s.points[i], r)) {
        n += 1;
        break;
      }
    }
  }
  for (const l of d.labels) {
    const other = textBox(d, l.text);
    if (Math.abs(l.cx - cx) < (box.w + other.w) / 2 + 2 && Math.abs(l.cy - cy) < (box.h + other.h) / 2 + 2) n += 3;
  }
  return n;
}

// Tries each direction in turn and keeps the one where the label covers
// the least; the first direction wins a tie.
function labelWhereClear(d, points, dirs, text, gap = 6) {
  const box = textBox(d, text);
  let best = null;
  for (const p of Array.isArray(points) ? points : [points]) {
    for (const dir of dirs) {
      const reach = gap + (Math.abs(dir.x) * box.w) / 2 + (Math.abs(dir.y) * box.h) / 2;
      const cx = p.x + dir.x * reach, cy = p.y + dir.y * reach;
      const score = clashes(d, cx, cy, text);
      if (!best || score < best.score) best = { cx, cy, score };
      if (score === 0) break;
    }
    if (best.score === 0) break;
  }
  d.labels.push({ cx: best.cx, cy: best.cy, text });
}

// Spots along a line to try a label at: the middle first, then either side.
function alongLine(a, b) {
  return [0.5, 0.36, 0.64, 0.24, 0.76].map((t) => add(a, mul(sub(b, a), t)));
}

// Where a label fits inside the corner at V between the directions u1
// and u2: far enough along the middle of the corner that its box clears
// both sides, and at least `clearance` from the corner itself.
function cornerLabelSpot(d, V, u1, u2, text, clearance) {
  const b = unit(add(u1, u2));
  const box = textBox(d, text);
  const sinHalf = Math.abs(cross(u1, b));
  let far = clearance + (Math.abs(b.x) * box.w) / 2 + (Math.abs(b.y) * box.h) / 2;
  if (sinHalf > 0.02) {
    for (const u of [u1, u2]) {
      const nrm = perp(u);
      far = Math.max(far, ((Math.abs(nrm.x) * box.w) / 2 + (Math.abs(nrm.y) * box.h) / 2 + 3) / sinHalf);
    }
  }
  return add(V, mul(b, far));
}

function fail(d, message) {
  d.error = message;
  d.strokes = [];
  d.labels = [];
  return d;
}

function allPositive(...values) {
  return values.every((v) => Number.isFinite(v) && v > 0);
}

const NEED_POSITIVE = "Lengths need to be bigger than 0.";

// ---------- marks ----------

// The angle at corner V between the directions u1 and u2 (unit vectors).
// A right angle gets the little square; anything else an arc.
function cornerMark(d, V, u1, u2, { text = null, radius = 22, textOnRight = false, textBetween = null } = {}) {
  const theta = Math.acos(clamp(dot(u1, u2), -1, 1));
  const right = Math.abs(theta / DEG - 90) < 0.05;
  if (right) {
    const q = clamp(radius * 0.55, 6, 13);
    stroke(d, cornered([add(V, mul(u1, q)), add(V, mul(add(u1, u2), q)), add(V, mul(u2, q))], false), THIN);
  } else {
    const a0 = Math.atan2(u1.y, u1.x);
    const sweep = Math.atan2(cross(u1, u2), dot(u1, u2));
    stroke(d, arcPoints(V, radius, a0, a0 + sweep), THIN);
  }
  if (text && (!right || textOnRight)) {
    // In a narrow corner the label sits further out, where the two sides
    // have opened up enough to fit it.
    const [t1, t2] = textBetween || [u1, u2];
    const spot = cornerLabelSpot(d, V, t1, t2, text, (right ? clamp(radius * 0.55, 6, 13) : radius) + 4);
    d.labels.push({ cx: spot.x, cy: spot.y, text });
  }
  return theta;
}

function tickMarks(d, P, dir, count) {
  const n = perp(dir);
  for (let i = 0; i < count; i++) {
    const c = add(P, mul(dir, (i - (count - 1) / 2) * 4.5));
    stroke(d, [add(c, mul(n, 5.5)), add(c, mul(n, -5.5))], THIN);
  }
}

function arrowMarks(d, P, dir, count) {
  let f = dir;
  if (f.x < -1e-6 || (Math.abs(f.x) <= 1e-6 && f.y > 0)) f = mul(f, -1);
  const n = perp(f);
  for (let i = 0; i < count; i++) {
    const c = add(P, mul(f, (i - (count - 1) / 2) * 5.5));
    const tip = add(c, mul(f, 3.5));
    const back = add(c, mul(f, -3.5));
    stroke(d, cornered([add(back, mul(n, 4.5)), tip, add(back, mul(n, -4.5))], false), THIN);
  }
}

// Sides that match get the same number: 1 for the first matching group,
// 2 for the next… Sides with no partner get 0.
function groupBy(values, same) {
  const groups = [];
  const out = values.map(() => 0);
  values.forEach((v, i) => {
    const g = groups.find((x) => same(x.value, v));
    if (g) g.members.push(i);
    else groups.push({ value: v, members: [i] });
  });
  let next = 1;
  for (const g of groups) {
    if (g.members.length < 2) continue;
    for (const i of g.members) out[i] = next;
    next += 1;
  }
  return out;
}

// ---------- polygons (regular polygons, triangles, quadrilaterals) ----------

function polygonArea(P) {
  let a = 0;
  for (let i = 0; i < P.length; i++) a += cross(P[i], P[(i + 1) % P.length]);
  return Math.abs(a) / 2;
}

function drawPolygon(d, U, spec = {}) {
  const n = U.length;
  const b = boundsOf(U);
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  if (!(span > 1e-9)) return fail(d, NEED_POSITIVE);
  const k = d.size / span;
  const c = pt((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
  const P = U.map((u) => mul(sub(u, c), k));
  const centre = mul(P.reduce((s, p) => add(s, p), pt(0, 0)), 1 / n);

  stroke(d, cornered(P, true), MAIN);

  const sideLen = U.map((u, i) => length(sub(U[(i + 1) % n], u)));
  const sidePx = sideLen.map((l) => l * k);
  const dirs = P.map((p, i) => unit(sub(P[(i + 1) % n], p)));
  const outward = dirs.map((dir, i) => {
    const nrm = perp(dir);
    return dot(nrm, sub(mid(P[i], P[(i + 1) % n]), centre)) >= 0 ? nrm : mul(nrm, -1);
  });

  const equal = d.show.marks ? groupBy(sideLen, (a, x) => Math.abs(a - x) <= 1e-6 * Math.max(1, a, x)) : sideLen.map(() => 0);
  const parallel = d.show.marks && spec.parallelMarks
    ? groupBy(dirs, (a, x) => Math.abs(cross(a, x)) < 1e-6)
    : sideLen.map(() => 0);

  for (let i = 0; i < n; i++) {
    const A = P[i], B = P[(i + 1) % n];
    const both = equal[i] && parallel[i];
    if (equal[i]) tickMarks(d, add(A, mul(sub(B, A), both ? 0.4 : 0.5)), dirs[i], equal[i]);
    if (parallel[i]) arrowMarks(d, add(A, mul(sub(B, A), both ? 0.62 : 0.5)), dirs[i], parallel[i]);
  }

  if (d.show.lengths) {
    const which = spec.lengthSides || P.map((_, i) => i);
    for (const i of which) {
      const text = lengthText(sideLen[i], d.unit);
      // on a short side the corner letters are in the way: go below them
      const cramped = d.show.letters && sidePx[i] < textBox(d, text).w + d.fontSize * 2.4;
      labelBeside(d, mid(P[i], P[(i + 1) % n]), outward[i], text, (equal[i] || parallel[i] ? 10 : 7) + (cramped ? d.fontSize * 1.1 : 0));
    }
  }

  const cornerDirs = (i) => [dirs[i], mul(dirs[(i + n - 1) % n], -1)];
  const cornerRadius = (i) => clamp(0.26 * Math.min(sidePx[i], sidePx[(i + n - 1) % n]), 9, 26);

  // The height (if asked for): from one corner straight down onto the base
  // (side 0). Worked out first, because the angle at that corner has to
  // keep its label off the height line.
  let height = null;
  if (spec.heightFrom != null) {
    const A = P[0], C = P[spec.heightFrom];
    const e = dirs[0];
    const along = dot(sub(C, A), e);
    const t = along / sidePx[0];
    const F = add(A, mul(e, along));
    const h = length(sub(C, F));
    const onASide = Math.abs(t) < 1e-6 || Math.abs(t - 1) < 1e-6;
    if (h > 1e-6 && !onASide) height = { C, F, e, t, h, down: unit(sub(F, C)) };
  }

  if (d.show.angles) {
    const which = spec.angleCorners || P.map((_, i) => i);
    for (const i of which) {
      const [u1, u2] = cornerDirs(i);
      const theta = Math.acos(clamp(dot(u1, u2), -1, 1)) / DEG;
      // where the height line cuts through this corner, write the angle
      // in the wider of the two parts beside it
      let textBetween = null;
      if (height && i === spec.heightFrom && height.t > 0 && height.t < 1) {
        const a1 = Math.acos(clamp(dot(u1, height.down), -1, 1)), a2 = Math.acos(clamp(dot(u2, height.down), -1, 1));
        // (unless even that part is too thin to write in)
        if (Math.max(a1, a2) >= 25 * DEG) textBetween = a1 >= a2 ? [u1, height.down] : [height.down, u2];
      }
      cornerMark(d, P[i], u1, u2, { text: angleText(theta), radius: cornerRadius(i), textOnRight: !!spec.textOnRightAngles, textBetween });
    }
  }

  // The exterior angle: one side carried on past its corner, and the turn
  // from that line onto the next side.
  if (spec.exteriorAt != null) {
    const i = spec.exteriorAt;
    const before = dirs[(i + n - 1) % n];
    const after = dirs[i];
    const theta = Math.acos(clamp(dot(before, after), -1, 1)) / DEG;
    const narrow = theta < 40;
    const reach = clamp(0.5 * sidePx[i], narrow ? 58 : 34, 90);
    stroke(d, [P[i], add(P[i], mul(before, reach))], THIN_DASH);
    cornerMark(d, P[i], before, after, { text: narrow ? null : angleText(theta), radius: clamp(0.3 * sidePx[i], 14, 30), textOnRight: true });
    // too narrow to write inside: put the number at the end of the dashes
    if (narrow) {
      const lift = unit(sub(after, mul(before, dot(after, before))));
      labelBeside(d, add(add(P[i], mul(before, reach)), mul(lift, d.fontSize * 0.45)), before, angleText(theta), 5);
    }
  }

  if (d.show.letters) {
    for (let i = 0; i < n; i++) {
      const [u1, u2] = cornerDirs(i);
      const out = unit(mul(add(u1, u2), -1), unit(sub(P[i], centre)));
      labelBeside(d, P[i], out, letterAt(i), 6);
    }
  }

  // The dashed height line itself, with its right-angle mark and length.
  if (height) {
    const { C, F, e, t, h } = height;
    const A = P[0], B = P[1];
    stroke(d, [C, F], THIN_DASH);
    if (t < 0) stroke(d, [A, add(F, mul(e, -8))], THIN_DASH);
    if (t > 1) stroke(d, [B, add(F, mul(e, 8))], THIN_DASH);
    const up = unit(sub(C, F));
    const inward = t < 0 ? e : t > 1 ? mul(e, -1) : t <= 0.5 ? e : mul(e, -1);
    cornerMark(d, F, inward, up, { radius: 15 });
    if (d.show.lengths) {
      const first = t < 0 || t > 1 ? mul(inward, -1) : inward;
      labelWhereClear(d, alongLine(C, F), [first, mul(first, -1)], lengthText(h / k, d.unit), 6);
    }
  }

  d.facts.push(`Perimeter ${lengthText(sideLen.reduce((s, l) => s + l, 0), d.unit)}`);
  d.facts.push(`Area ${areaText(polygonArea(U), d.unit)}`);
  return d;
}

function regularPolygon(d, p) {
  const n = clamp(Math.round(Number(p.n) || 0), MIN_SIDES, MAX_SIDES);
  const side = Number(p.side);
  if (!allPositive(side)) return fail(d, NEED_POSITIVE);
  const R = side / (2 * Math.sin(Math.PI / n));
  // A at the bottom left, then round anticlockwise: B bottom right…
  const U = [];
  for (let i = 0; i < n; i++) {
    const a = Math.PI / 2 + Math.PI / n - (2 * Math.PI * i) / n;
    U.push(pt(R * Math.cos(a), R * Math.sin(a)));
  }
  d.title = polygonName(n);
  d.facts.push(`${n} sides`, `Interior ${angleText(interiorAngle(n))}`, `Exterior ${angleText(exteriorAngle(n))}`, `Angles add up to ${angleText(angleSum(n))}`);
  return drawPolygon(d, U, {
    angleCorners: p.everyCorner ? null : [1],
    lengthSides: [0],
    textOnRightAngles: true,
    exteriorAt: p.exterior ? 1 : null,
  });
}

// Corner A bottom left, B bottom right, C on top.
export function triangleCorners(t) {
  const kind = t.kind;
  let AB, AC, angleA;
  if (kind === "equilateral") {
    const s = Number(t.side);
    if (!allPositive(s)) return { error: NEED_POSITIVE };
    AB = s; AC = s; angleA = 60;
  } else if (kind === "isosceles") {
    const base = Number(t.base), eq = Number(t.equal);
    if (!allPositive(base, eq)) return { error: NEED_POSITIVE };
    if (2 * eq <= base) return { error: "The two equal sides are too short to meet. Together they need to be longer than the base." };
    AB = base; AC = eq; angleA = Math.acos(base / (2 * eq)) / DEG;
  } else if (kind === "right") {
    const base = Number(t.base), height = Number(t.height);
    if (!allPositive(base, height)) return { error: NEED_POSITIVE };
    AB = base; AC = height; angleA = 90;
  } else if (t.mode === "sas") {
    AB = Number(t.ab); AC = Number(t.ca); angleA = Number(t.angleA);
    if (!allPositive(AB, AC)) return { error: NEED_POSITIVE };
    if (!(angleA > 0 && angleA < 180)) return { error: "The angle needs to be between 0° and 180°." };
  } else if (t.mode === "asa") {
    AB = Number(t.ab); angleA = Number(t.angleA);
    const angleB = Number(t.angleB);
    if (!allPositive(AB)) return { error: NEED_POSITIVE };
    if (!(angleA > 0 && angleB > 0)) return { error: "Angles need to be bigger than 0°." };
    if (angleA + angleB >= 180) return { error: "Those two angles already add up to 180° or more, so the sides never meet." };
    const angleC = 180 - angleA - angleB;
    AC = (AB * Math.sin(angleB * DEG)) / Math.sin(angleC * DEG);
  } else {
    const c = Number(t.ab), a = Number(t.bc), b = Number(t.ca);
    if (!allPositive(a, b, c)) return { error: NEED_POSITIVE };
    if (a + b <= c || a + c <= b || b + c <= a) {
      return { error: "Those sides can't make a triangle. The two shorter sides together must be longer than the longest side." };
    }
    AB = c; AC = b;
    angleA = Math.acos(clamp((b * b + c * c - a * a) / (2 * b * c), -1, 1)) / DEG;
  }
  const A = pt(0, 0), B = pt(AB, 0);
  const C = pt(AC * Math.cos(angleA * DEG), -AC * Math.sin(angleA * DEG));
  return { points: [A, B, C] };
}

function triangleTitle(U) {
  const s = [length(sub(U[1], U[0])), length(sub(U[2], U[1])), length(sub(U[0], U[2]))];
  const close = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, a, b);
  const sorted = s.slice().sort((a, b) => a - b);
  const rightAngled = Math.abs(sorted[0] ** 2 + sorted[1] ** 2 - sorted[2] ** 2) <= 1e-6 * sorted[2] ** 2;
  if (close(s[0], s[1]) && close(s[1], s[2])) return "Equilateral triangle";
  const iso = close(s[0], s[1]) || close(s[1], s[2]) || close(s[0], s[2]);
  if (rightAngled) return iso ? "Right-angled isosceles triangle" : "Right-angled triangle";
  return iso ? "Isosceles triangle" : "Scalene triangle";
}

function triangle(d, t) {
  const made = triangleCorners(t);
  if (made.error) return fail(d, made.error);
  d.title = triangleTitle(made.points);
  return drawPolygon(d, made.points, { heightFrom: t.heightLine ? 2 : null });
}

// A bottom left, B bottom right, C top right, D top left.
export function quadCorners(q) {
  const kind = q.kind;
  if (kind === "square") {
    const s = Number(q.side);
    if (!allPositive(s)) return { error: NEED_POSITIVE };
    return { points: [pt(0, 0), pt(s, 0), pt(s, -s), pt(0, -s)], title: "Square" };
  }
  if (kind === "rectangle") {
    const w = Number(q.width), h = Number(q.height);
    if (!allPositive(w, h)) return { error: NEED_POSITIVE };
    return { points: [pt(0, 0), pt(w, 0), pt(w, -h), pt(0, -h)], title: "Rectangle" };
  }
  if (kind === "parallelogram" || kind === "rhombus") {
    const base = Number(kind === "rhombus" ? q.side : q.base);
    const slant = Number(kind === "rhombus" ? q.side : q.slant);
    const angle = Number(q.angle);
    if (!allPositive(base, slant)) return { error: NEED_POSITIVE };
    if (!(angle > 0 && angle < 180)) return { error: "The angle needs to be between 0° and 180°." };
    const dx = slant * Math.cos(angle * DEG), dy = -slant * Math.sin(angle * DEG);
    return { points: [pt(0, 0), pt(base, 0), pt(base + dx, dy), pt(dx, dy)], title: kind === "rhombus" ? "Rhombus" : "Parallelogram" };
  }
  if (kind === "trapezium") {
    const a = Number(q.bottom), b = Number(q.top), h = Number(q.height);
    if (!allPositive(a, b, h)) return { error: NEED_POSITIVE };
    const left = q.rightAngled ? 0 : (a - b) / 2;
    return {
      points: [pt(0, 0), pt(a, 0), pt(left + b, -h), pt(left, -h)],
      title: q.rightAngled ? "Right-angled trapezium" : "Isosceles trapezium",
    };
  }
  // kite: A left, B bottom, C right, D top
  const w = Number(q.width), up = Number(q.upper), down = Number(q.lower);
  if (!allPositive(w, up, down)) return { error: NEED_POSITIVE };
  return { points: [pt(-w / 2, 0), pt(0, down), pt(w / 2, 0), pt(0, -up)], title: "Kite" };
}

function quadrilateral(d, q) {
  const made = quadCorners(q);
  if (made.error) return fail(d, made.error);
  d.title = made.title;
  const canHaveHeight = q.kind === "parallelogram" || q.kind === "rhombus" || q.kind === "trapezium";
  return drawPolygon(d, made.points, { parallelMarks: true, heightFrom: q.heightLine && canHaveHeight ? 3 : null });
}

// ---------- circles and parts of circles ----------

function circleFamily(d, c) {
  const kind = c.kind;
  if (kind === "ellipse") return ellipse(d, c);
  const r = Number(c.radius);
  if (!allPositive(r)) return fail(d, NEED_POSITIVE);
  const whole = kind === "circle";
  const angle = whole ? 360 : kind === "semicircle" ? 180 : Number(c.angle);
  if (!(angle > 0 && angle <= 360) || (!whole && angle >= 360)) return fail(d, "The angle needs to be more than 0° and less than 360°.");
  const half = (angle * DEG) / 2;
  const a0 = -Math.PI / 2 - half, a1 = -Math.PI / 2 + half;

  // work out the scale from the outline in the user's own units
  const rough = [pt(r * Math.cos(a0), r * Math.sin(a0)), pt(r * Math.cos(a1), r * Math.sin(a1))];
  for (let q = Math.ceil(a0 / (Math.PI / 2)); q * (Math.PI / 2) <= a1; q++) {
    rough.push(pt(r * Math.cos((q * Math.PI) / 2), r * Math.sin((q * Math.PI) / 2)));
  }
  if (kind === "sector") rough.push(pt(0, 0));
  const b = boundsOf(rough);
  const k = d.size / Math.max(b.maxX - b.minX, b.maxY - b.minY);
  const O = mul(pt(-(b.minX + b.maxX) / 2, -(b.minY + b.maxY) / 2), k);
  const R = r * k;
  const arc = arcPoints(O, R, a0, a1);
  const A = arc[0], B = arc[arc.length - 1];
  const up = pt(0, -1);
  const pi = Math.PI;

  if (whole) {
    stroke(d, arc, MAIN);
    d.title = "Circle";
    d.facts.push(`Circumference ${lengthText(2 * pi * r, d.unit)}`, `Area ${areaText(pi * r * r, d.unit)}`);
    if (c.showDiameter) {
      stroke(d, [pt(O.x - R, O.y), pt(O.x + R, O.y)], THIN);
      if (d.show.lengths) labelBeside(d, pt(O.x - R / 2, O.y), pt(0, 1), lengthText(2 * r, d.unit), 6);
    }
    if (c.showRadius) {
      const dir = pt(Math.cos(-35 * DEG), Math.sin(-35 * DEG));
      stroke(d, [O, add(O, mul(dir, R))], THIN);
      if (d.show.lengths) labelBeside(d, add(O, mul(dir, R / 2)), unit(pt(dir.y, -dir.x)), lengthText(r, d.unit), 6);
    }
    if (c.showCentre || c.showRadius || c.showDiameter) dotAt(d, O);
    if (d.show.letters) labelBeside(d, O, unit(pt(-1, 1)), "O", 6);
    return d;
  }

  if (kind === "semicircle") {
    // one line: along the diameter, then back over the top
    stroke(d, [A, B, B, ...arc.slice().reverse()], MAIN);
    d.title = "Semicircle";
    d.facts.push(`Curved edge ${lengthText(pi * r, d.unit)}`, `Area ${areaText((pi * r * r) / 2, d.unit)}`);
    if (d.show.lengths) labelBeside(d, pt(O.x + R / 2, O.y), pt(0, 1), lengthText(2 * r, d.unit), 7);
    if (c.showRadius) {
      const dir = pt(Math.cos(-55 * DEG), Math.sin(-55 * DEG));
      stroke(d, [O, add(O, mul(dir, R))], THIN);
      if (d.show.lengths) labelBeside(d, add(O, mul(dir, R / 2)), unit(pt(dir.y, -dir.x)), lengthText(r, d.unit), 6);
    }
    if (c.showCentre || c.showRadius) dotAt(d, O);
    if (d.show.letters) {
      labelBeside(d, A, unit(pt(-1, 1)), "A", 5);
      labelBeside(d, B, unit(pt(1, 1)), "B", 5);
      if (c.showCentre || c.showRadius) labelBeside(d, O, pt(0, 1), "O", 7);
    }
    return d;
  }

  const arcLength = angle * DEG * r;
  const uA = unit(sub(A, O)), uB = unit(sub(B, O));
  const outA = unit(pt(uA.y, -uA.x), up);
  const awayFromO = (P) => unit(sub(P, O));
  const markAngle = () => {
    const rad = clamp(R * 0.24, 12, 28);
    stroke(d, arcPoints(O, rad, a0, a1), THIN);
    const text = angleText(angle);
    if (angle < 180) {
      const spot = cornerLabelSpot(d, O, uA, uB, text, rad + 4);
      d.labels.push({ cx: spot.x, cy: spot.y, text });
    } else {
      labelBeside(d, add(O, mul(up, rad)), up, text, 4);
    }
  };

  if (kind === "sector") {
    stroke(d, [O, A, A, ...arc.slice(1, -1), B, B, O], MAIN);
    d.title = angle > 180 ? "Major sector" : "Sector";
    d.facts.push(`Arc length ${lengthText(arcLength, d.unit)}`, `Area ${areaText((angle / 360) * pi * r * r, d.unit)}`);
    if (d.show.marks) {
      tickMarks(d, mid(O, A), uA, 1);
      tickMarks(d, mid(O, B), uB, 1);
    }
    if (d.show.angles) markAngle();
    if (d.show.lengths) labelBeside(d, mid(O, A), outA, lengthText(r, d.unit), d.show.marks ? 10 : 7);
    if (d.show.letters) {
      labelBeside(d, O, pt(0, 1), "O", 7);
      labelBeside(d, A, awayFromO(A), "A", 5);
      labelBeside(d, B, awayFromO(B), "B", 5);
    }
    return d;
  }

  const segment = kind === "segment";
  if (segment) stroke(d, [A, B, B, ...arc.slice().reverse()], MAIN);
  else stroke(d, arc, MAIN);
  d.title = segment ? (angle > 180 ? "Major segment" : "Segment") : "Arc";
  d.facts.push(`Arc length ${lengthText(arcLength, d.unit)}`);
  const chord = 2 * r * Math.sin(half);
  if (segment) {
    d.facts.push(`Area ${areaText((r * r * (angle * DEG - Math.sin(angle * DEG))) / 2, d.unit)}`);
    if (d.show.lengths) labelBeside(d, mid(A, B), pt(0, 1), lengthText(chord, d.unit), 7);
  }
  // dashed radii back to the centre, to show the angle and the radius
  const radii = d.show.angles || (!segment && d.show.lengths);
  if (radii) {
    stroke(d, [O, A], THIN_DASH);
    stroke(d, [O, B], THIN_DASH);
    dotAt(d, O);
    if (d.show.angles) markAngle();
    if (d.show.lengths) labelBeside(d, mid(O, A), outA, lengthText(r, d.unit), 7);
  }
  if (d.show.letters) {
    labelBeside(d, A, awayFromO(A), "A", 5);
    labelBeside(d, B, awayFromO(B), "B", 5);
    if (radii) labelBeside(d, O, pt(0, 1), "O", 7);
  }
  return d;
}

function ellipse(d, c) {
  const w = Number(c.width), h = Number(c.height);
  if (!allPositive(w, h)) return fail(d, NEED_POSITIVE);
  const k = d.size / Math.max(w, h);
  const a = (w * k) / 2, b = (h * k) / 2;
  const O = pt(0, 0);
  stroke(d, ellipsePoints(O, a, b, 0, 2 * Math.PI), MAIN);
  d.title = Math.abs(w - h) < 1e-9 ? "Circle" : "Ellipse";
  d.facts.push(`Area ${areaText((Math.PI * w * h) / 4, d.unit)}`);
  if (d.show.lengths) {
    stroke(d, [pt(-a, 0), pt(a, 0)], THIN_DASH);
    stroke(d, [pt(0, -b), pt(0, b)], THIN_DASH);
    labelBeside(d, pt(-a / 2, 0), pt(0, 1), lengthText(w, d.unit), 6);
    labelBeside(d, pt(0, -b / 2), pt(1, 0), lengthText(h, d.unit), 6);
  }
  if (c.showCentre || d.show.lengths) dotAt(d, O);
  if (d.show.letters) labelBeside(d, O, unit(pt(-1, 1)), "O", 6);
  return d;
}

// ---------- 3D solids ----------

// A solid is sized by the ball it turns inside, so it never changes size
// as you turn it. Seen from most angles it fills less than that ball, so
// it's drawn a little bigger to match a flat shape of the same size.
const SOLID_FILL = 1.2;

function turn(p, yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const x = p.x * cy + p.z * sy;
  const z1 = -p.x * sy + p.z * cy;
  return { x, y: p.y * cp - z1 * sp, z: p.y * sp + z1 * cp };
}

// Joins edges end to end into as few lines as possible.
function chainEdges(edges, P) {
  const left = new Set(edges.map((_, i) => i));
  const at = new Map();
  edges.forEach(([a, b], i) => {
    for (const v of [a, b]) {
      if (!at.has(v)) at.set(v, []);
      at.get(v).push(i);
    }
  });
  const takeFrom = (v) => {
    const i = (at.get(v) || []).find((e) => left.has(e));
    if (i === undefined) return null;
    left.delete(i);
    return edges[i][0] === v ? edges[i][1] : edges[i][0];
  };
  const paths = [];
  for (let i = 0; i < edges.length; i++) {
    if (!left.has(i)) continue;
    left.delete(i);
    const path = [edges[i][0], edges[i][1]];
    for (let next = takeFrom(path[path.length - 1]); next !== null; next = takeFrom(path[path.length - 1])) path.push(next);
    for (let prev = takeFrom(path[0]); prev !== null; prev = takeFrom(path[0])) path.unshift(prev);
    paths.push(cornered(path.map((v) => P[v]), false));
  }
  return paths;
}

function ring(n, radius, y) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.PI / 2 + Math.PI / n - (2 * Math.PI * i) / n;
    out.push({ x: radius * Math.cos(a), y, z: radius * Math.sin(a) });
  }
  return out;
}

function polyhedron(d, s, raw, faces, plan) {
  const yaw = (Number(s.yaw) || 0) * DEG;
  const pitch = clamp(Number(s.pitch) || 0, -90, 90) * DEG;
  // centre the solid on the middle of its box, so it turns on the spot
  const lo = { x: Infinity, y: Infinity, z: Infinity }, hi = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const v of raw) {
    for (const axis of ["x", "y", "z"]) {
      lo[axis] = Math.min(lo[axis], v[axis]);
      hi[axis] = Math.max(hi[axis], v[axis]);
    }
  }
  const shift = (v) => ({ x: v.x - (lo.x + hi.x) / 2, y: v.y - (lo.y + hi.y) / 2, z: v.z - (lo.z + hi.z) / 2 });
  const verts = raw.map(shift);
  let reach = 0;
  for (const v of verts) reach = Math.max(reach, Math.hypot(v.x, v.y, v.z));
  const k = (d.size * SOLID_FILL) / (2 * reach);
  const T = verts.map((v) => turn(v, yaw, pitch));
  const P = T.map((v) => pt(v.x * k, -v.y * k));

  const middle = T.reduce((m, v) => ({ x: m.x + v.x / T.length, y: m.y + v.y / T.length, z: m.z + v.z / T.length }), { x: 0, y: 0, z: 0 });
  const front = faces.map((f) => {
    const a = T[f[0]], b = T[f[1]], c = T[f[2]];
    const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    const nrm = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x };
    const fc = f.reduce((m, i) => ({ x: m.x + T[i].x / f.length, y: m.y + T[i].y / f.length, z: m.z + T[i].z / f.length }), { x: 0, y: 0, z: 0 });
    const facingOut = nrm.x * (fc.x - middle.x) + nrm.y * (fc.y - middle.y) + nrm.z * (fc.z - middle.z) >= 0;
    return (facingOut ? nrm.z : -nrm.z) > 1e-9;
  });

  const edges = new Map();
  faces.forEach((f, fi) => {
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (!edges.has(key)) edges.set(key, { a: Math.min(a, b), b: Math.max(a, b), seen: false });
      if (front[fi]) edges.get(key).seen = true;
    }
  });
  const list = [...edges.values()];
  for (const path of chainEdges(list.filter((e) => e.seen).map((e) => [e.a, e.b]), P)) stroke(d, path, MAIN);
  if (s.hidden !== false) {
    for (const path of chainEdges(list.filter((e) => !e.seen).map((e) => [e.a, e.b]), P)) stroke(d, path, HIDDEN);
  }

  const lettersLater = [];
  if (d.show.letters) {
    // each letter goes in the widest gap between the edges that meet at
    // its corner, so it isn't written on top of a line
    const around = P.map(() => []);
    for (const e of list) {
      if (!e.seen && s.hidden === false) continue;
      around[e.a].push(Math.atan2(P[e.b].y - P[e.a].y, P[e.b].x - P[e.a].x));
      around[e.b].push(Math.atan2(P[e.a].y - P[e.b].y, P[e.a].x - P[e.b].x));
    }
    P.forEach((p, i) => {
      const angles = around[i].slice().sort((a, b) => a - b);
      const dirs = [];
      if (angles.length) {
        let widest = -1, at = 0;
        angles.forEach((a, j) => {
          const next = j + 1 < angles.length ? angles[j + 1] : angles[0] + 2 * Math.PI;
          if (next - a > widest) {
            widest = next - a;
            at = a + (next - a) / 2;
          }
        });
        dirs.push(pt(Math.cos(at), Math.sin(at)));
      }
      dirs.push(unit(p));
      for (let q = 0; q < 8; q++) dirs.push(pt(Math.cos((q * Math.PI) / 4), Math.sin((q * Math.PI) / 4)));
      lettersLater.push({ p, dirs, text: letterAt(i) });
    });
  }

  if (d.show.lengths) {
    const seen = (a, b) => edges.get(a < b ? `${a}-${b}` : `${b}-${a}`)?.seen;
    for (const item of plan.lengths || []) {
      // of the matching edges, label the one you can see that sits
      // furthest out, so the number lands clear of the drawing
      let best = null;
      for (const [a, b] of item.edges) {
        const span = length(sub(P[b], P[a]));
        if (span < 14) continue;
        const m = mid(P[a], P[b]);
        const score = (seen(a, b) ? 1000 : 0) + length(m) + m.y * 0.01;
        if (!best || score > best.score) best = { a, b, m, score };
      }
      if (!best) continue;
      const nrm = perp(unit(sub(P[best.b], P[best.a])));
      const out = dot(nrm, best.m) >= 0 ? nrm : mul(nrm, -1);
      labelWhereClear(d, best.m, [out, mul(out, -1)], item.text, 7);
    }
    for (const item of plan.inside || []) {
      const a = turn(shift(item.from), yaw, pitch), b = turn(shift(item.to), yaw, pitch);
      const pa = pt(a.x * k, -a.y * k), pb = pt(b.x * k, -b.y * k);
      if (length(sub(pb, pa)) < 10) continue;
      stroke(d, [pa, pb], THIN_DASH);
      labelWhereClear(d, alongLine(pa, pb), [pt(1, 0), pt(-1, 0)], item.text, 6);
    }
  }
  for (const l of lettersLater) labelWhereClear(d, l.p, l.dirs, l.text, 5);
  return d;
}

function pairs(indexes) {
  return indexes.map((v, i) => [v, indexes[(i + 1) % indexes.length]]);
}

function solid(d, s) {
  const kind = s.kind;
  const len = (v) => lengthText(v, d.unit);

  if (kind === "cube" || kind === "cuboid") {
    const w = Number(kind === "cube" ? s.side : s.width);
    const h = Number(kind === "cube" ? s.side : s.height);
    const dp = Number(kind === "cube" ? s.side : s.depth);
    if (!allPositive(w, h, dp)) return fail(d, NEED_POSITIVE);
    const corner = (x, y, z) => ({ x: (x * w) / 2, y: (y * h) / 2, z: (z * dp) / 2 });
    const verts = [
      corner(-1, -1, 1), corner(1, -1, 1), corner(1, -1, -1), corner(-1, -1, -1),
      corner(-1, 1, 1), corner(1, 1, 1), corner(1, 1, -1), corner(-1, 1, -1),
    ];
    const faces = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
    const across = [[0, 1], [3, 2], [4, 5], [7, 6]];
    const back = [[1, 2], [0, 3], [5, 6], [4, 7]];
    const upright = [[0, 4], [1, 5], [2, 6], [3, 7]];
    d.title = kind === "cube" ? "Cube" : "Cuboid";
    d.facts.push(`Volume ${volumeText(w * h * dp, d.unit)}`, `Surface area ${areaText(2 * (w * h + w * dp + h * dp), d.unit)}`);
    const lengths = kind === "cube"
      ? [{ edges: across, text: len(w) }]
      : [{ edges: across, text: len(w) }, { edges: back, text: len(dp) }, { edges: upright, text: len(h) }];
    return polyhedron(d, s, verts, faces, { lengths });
  }

  if (kind === "prism" || kind === "pyramid") {
    const n = clamp(Math.round(Number(kind === "prism" ? s.prismSides : s.pyramidSides) || 0), MIN_SIDES, MAX_BASE_SIDES);
    const side = Number(s.baseSide), h = Number(s.height);
    if (!allPositive(side, h)) return fail(d, NEED_POSITIVE);
    const R = side / (2 * Math.sin(Math.PI / n));
    const baseArea = (n * side * side) / (4 * Math.tan(Math.PI / n));
    const bottom = ring(n, R, -h / 2);
    const idx = bottom.map((_, i) => i);
    if (kind === "prism") {
      // lying down, the ends face you (the usual picture of a triangular
      // prism); standing up, it sits on one end
      const lay = (v) => (s.lying ? { x: v.x, y: -v.z, z: -v.y } : v);
      const verts = [...bottom, ...ring(n, R, h / 2)].map(lay);
      const top = idx.map((i) => i + n);
      const faces = [idx, top, ...idx.map((i) => [i, (i + 1) % n, ((i + 1) % n) + n, i + n])];
      d.title = n === 4 ? "Square prism" : `${cap(BASE_NAMES[n])} prism`;
      d.facts.push(`Volume ${volumeText(baseArea * h, d.unit)}`, `Surface area ${areaText(2 * baseArea + n * side * h, d.unit)}`);
      return polyhedron(d, s, verts, faces, {
        lengths: [{ edges: [...pairs(idx), ...pairs(top)], text: len(side) }, { edges: idx.map((i) => [i, i + n]), text: len(h) }],
      });
    }
    const apex = { x: 0, y: h / 2, z: 0 };
    const verts = [...bottom, apex];
    const faces = [idx, ...idx.map((i) => [i, (i + 1) % n, n])];
    const apothem = side / (2 * Math.tan(Math.PI / n));
    const slant = Math.hypot(h, apothem);
    d.title = `${cap(BASE_NAMES[n])}-based pyramid`;
    d.facts.push(`Volume ${volumeText((baseArea * h) / 3, d.unit)}`, `Surface area ${areaText(baseArea + (n * side * slant) / 2, d.unit)}`);
    return polyhedron(d, s, verts, faces, {
      lengths: [{ edges: pairs(idx), text: len(side) }],
      inside: [{ from: apex, to: { x: 0, y: -h / 2, z: 0 }, text: len(h) }],
    });
  }

  return roundSolid(d, s);
}

function cap(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// Cylinder, cone and sphere. They look the same from every side, so only
// the tilt matters.
function roundSolid(d, s) {
  const kind = s.kind;
  const r = Number(s.radius);
  const h = kind === "sphere" ? 2 * r : Number(s.height);
  if (!allPositive(r, h)) return fail(d, NEED_POSITIVE);
  const pitch = clamp(Number(s.pitch) || 0, -90, 90) * DEG;
  const sp = Math.sin(pitch), cp = Math.cos(pitch);
  const showHidden = s.hidden !== false;
  const len = (v) => lengthText(v, d.unit);
  const pi = Math.PI;

  if (kind === "sphere") {
    const R = d.size / 2;
    const O = pt(0, 0);
    stroke(d, arcPoints(O, R, 0, 2 * pi), MAIN);
    stroke(d, ellipsePoints(O, R, R * sp, 0, pi), THIN);
    if (showHidden) stroke(d, ellipsePoints(O, R, R * sp, pi, 2 * pi), THIN_DASH);
    d.title = "Sphere";
    d.facts.push(`Volume ${volumeText((4 / 3) * pi * r ** 3, d.unit)}`, `Surface area ${areaText(4 * pi * r * r, d.unit)}`);
    if (d.show.lengths) {
      dotAt(d, O);
      stroke(d, [O, pt(R, 0)], THIN_DASH);
      labelBeside(d, pt(R / 2, 0), pt(0, -1), len(r), 6);
    }
    return d;
  }

  const k = (d.size * SOLID_FILL) / (2 * Math.hypot(r, h / 2));
  const a = r * k, b = r * k * sp;
  const topC = pt(0, -(h / 2) * k * cp), botC = pt(0, (h / 2) * k * cp);
  const rim = (c, t) => pt(c.x + a * Math.cos(t), c.y + b * Math.sin(t));

  if (kind === "cylinder") {
    // the end you can see is a whole oval; on the other end only the near
    // half shows, as the bottom edge of the curved side
    const seenC = sp >= 0 ? topC : botC;
    const farC = sp >= 0 ? botC : topC;
    stroke(d, ellipsePoints(seenC, a, b, 0, 2 * pi), MAIN);
    const near = ellipsePoints(farC, a, b, 0, pi);
    stroke(d, [rim(seenC, 0), near[0], near[0], ...near.slice(1, -1), near[near.length - 1], near[near.length - 1], rim(seenC, pi)], MAIN);
    if (showHidden) stroke(d, ellipsePoints(farC, a, b, pi, 2 * pi), HIDDEN);
    d.title = "Cylinder";
    d.facts.push(`Volume ${volumeText(pi * r * r * h, d.unit)}`, `Surface area ${areaText(2 * pi * r * r + 2 * pi * r * h, d.unit)}`);
    if (d.show.lengths) {
      dotAt(d, seenC);
      stroke(d, [seenC, rim(seenC, 0)], THIN);
      labelBeside(d, pt(a / 2, seenC.y), pt(0, -1), len(r), 5);
      labelBeside(d, pt(a, 0), pt(1, 0), len(h), 7);
    }
    return d;
  }

  // cone: point at the top, round base at the bottom
  const apex = topC;
  const slant = Math.hypot(r, h);
  d.title = "Cone";
  d.facts.push(`Volume ${volumeText((pi * r * r * h) / 3, d.unit)}`, `Surface area ${areaText(pi * r * r + pi * r * slant, d.unit)}`);
  // where the curved side turns away from you: sin(t) = -q
  const q = cp < 1e-9 ? Infinity * Math.sign(sp || 1) : (r * sp) / (h * cp);
  const baseSeen = sp < 0;
  if (Math.abs(q) >= 1) {
    // looking almost straight down (or up): just the round base, with
    // the point in the middle
    stroke(d, ellipsePoints(botC, a, b, 0, 2 * pi), MAIN);
    if (!baseSeen) dotAt(d, apex);
  } else {
    const t1 = Math.asin(-q), t2 = pi - t1;
    if (baseSeen) {
      stroke(d, ellipsePoints(botC, a, b, 0, 2 * pi), MAIN);
      stroke(d, cornered([rim(botC, t1), apex, rim(botC, t2)], false), MAIN);
    } else {
      const seen = ellipsePoints(botC, a, b, t1, t2);
      stroke(d, [apex, seen[0], seen[0], ...seen.slice(1, -1), seen[seen.length - 1], seen[seen.length - 1], apex], MAIN);
      if (showHidden) stroke(d, ellipsePoints(botC, a, b, t2, 2 * pi + t1), HIDDEN);
    }
  }
  if (d.show.lengths) {
    dotAt(d, botC);
    stroke(d, [botC, rim(botC, 0)], baseSeen ? THIN : THIN_DASH);
    labelBeside(d, pt(a / 2, botC.y), pt(0, -1), len(r), 5);
    if (length(sub(apex, botC)) > 10) {
      stroke(d, [apex, botC], THIN_DASH);
      labelWhereClear(d, alongLine(apex, botC), [pt(-1, 0), pt(1, 0)], len(h), 6);
    }
  }
  return d;
}

// ---------- the dialog's settings ----------

export const FAMILIES = [
  { id: "polygon", label: "Polygon" },
  { id: "triangle", label: "Triangle" },
  { id: "quad", label: "Quadrilateral" },
  { id: "circle", label: "Circle" },
  { id: "solid", label: "3D" },
];

export const TRIANGLE_KINDS = [
  { id: "equilateral", label: "Equilateral" },
  { id: "isosceles", label: "Isosceles" },
  { id: "right", label: "Right-angled" },
  { id: "custom", label: "Any triangle" },
];

export const QUAD_KINDS = [
  { id: "square", label: "Square" },
  { id: "rectangle", label: "Rectangle" },
  { id: "parallelogram", label: "Parallelogram" },
  { id: "rhombus", label: "Rhombus" },
  { id: "trapezium", label: "Trapezium" },
  { id: "kite", label: "Kite" },
];

export const CIRCLE_KINDS = [
  { id: "circle", label: "Circle" },
  { id: "semicircle", label: "Semicircle" },
  { id: "sector", label: "Sector" },
  { id: "segment", label: "Segment" },
  { id: "arc", label: "Arc" },
  { id: "ellipse", label: "Ellipse" },
];

export const SOLID_KINDS = [
  { id: "cube", label: "Cube" },
  { id: "cuboid", label: "Cuboid" },
  { id: "prism", label: "Prism" },
  { id: "pyramid", label: "Pyramid" },
  { id: "cylinder", label: "Cylinder" },
  { id: "cone", label: "Cone" },
  { id: "sphere", label: "Sphere" },
];

export const DEFAULT_VIEW = { yaw: -28, pitch: 22 };

export function defaultShapeConfig() {
  return {
    family: "polygon",
    size: 280,
    unit: "cm",
    labels: { angles: true, lengths: true, letters: false, marks: true },
    polygon: { n: 6, side: 5, everyCorner: false, exterior: true },
    triangle: {
      kind: "equilateral", side: 6, base: 6, equal: 5, height: 4, mode: "sss",
      ab: 7, bc: 5, ca: 6, angleA: 50, angleB: 60, heightLine: false,
    },
    quad: {
      kind: "square", side: 5, width: 7, height: 4, base: 7, slant: 4, angle: 60,
      bottom: 8, top: 5, rightAngled: false, upper: 3, lower: 6, heightLine: false,
    },
    circle: { kind: "circle", radius: 5, angle: 60, width: 8, height: 5, showCentre: true, showRadius: true, showDiameter: false },
    solid: {
      kind: "cube", side: 4, width: 6, depth: 4, height: 5, prismSides: 3, pyramidSides: 4, lying: true,
      baseSide: 3, radius: 3, hidden: true, ...DEFAULT_VIEW,
    },
  };
}

// Which label switches make sense for the shape that's picked.
export function labelOptions(cfg) {
  const f = cfg.family;
  if (f === "solid") {
    const flat = ["cube", "cuboid", "prism", "pyramid"].includes(cfg.solid.kind);
    return { angles: false, lengths: true, letters: flat, marks: false };
  }
  if (f === "circle") {
    const k = cfg.circle.kind;
    return {
      angles: k === "sector" || k === "segment" || k === "arc",
      lengths: true,
      letters: true,
      marks: k === "sector",
    };
  }
  return { angles: true, lengths: true, letters: true, marks: true };
}

export function canShowHeight(cfg) {
  if (cfg.family === "triangle") return cfg.triangle.kind !== "right";
  if (cfg.family === "quad") {
    const q = cfg.quad;
    return q.kind === "parallelogram" || q.kind === "rhombus" || (q.kind === "trapezium" && !q.rightAngled);
  }
  return false;
}

export function buildShape(cfg, env = fallbackTextEnv) {
  const d = newDrawing(cfg, env);
  const allowed = labelOptions(cfg);
  for (const key of Object.keys(d.show)) if (!allowed[key]) d.show[key] = false;
  if (cfg.family === "polygon") regularPolygon(d, cfg.polygon);
  else if (cfg.family === "triangle") triangle(d, cfg.triangle);
  else if (cfg.family === "quad") quadrilateral(d, cfg.quad);
  else if (cfg.family === "circle") circleFamily(d, cfg.circle);
  else solid(d, cfg.solid);
  return {
    strokes: d.strokes, labels: d.labels, fontSize: d.fontSize, size: d.size,
    title: d.title, facts: d.error ? [] : d.facts, error: d.error,
  };
}

// ---------- drawing it ----------

export function strokeWidthFor(s, lineWidth) {
  return Math.max(1, Math.round(lineWidth * (s.w || 1) * 10) / 10);
}

// Dashes sized to the line: with the pen's round ends, this reads as an
// even dash-gap pattern at any thickness.
export function dashFor(width) {
  return [Math.round(width * 1500) / 1000, Math.round(width * 2600) / 1000];
}

// Same curve the board draws for a pen line.
export function tracePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  }
  ctx.stroke();
}

// The box around everything in the drawing, labels included.
export function shapeBounds(built, env = fallbackTextEnv) {
  const pts = [];
  for (const s of built.strokes) for (const p of s.points) pts.push(p);
  for (const l of built.labels) {
    const w = env.width(l.text, built.fontSize) / 2, h = built.fontSize * 0.65;
    pts.push(pt(l.cx - w, l.cy - h), pt(l.cx + w, l.cy + h));
  }
  if (!pts.length) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  return boundsOf(pts);
}

// Draws the shape as it will look on the board. `lineWidth` is the
// thickness in on-screen pixels.
export function drawShape(ctx, built, { color, lineWidth, env = fallbackTextEnv }) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  for (const s of built.strokes) {
    const w = strokeWidthFor(s, lineWidth);
    ctx.lineWidth = w;
    ctx.setLineDash(s.dash ? dashFor(w) : []);
    tracePath(ctx, s.points);
  }
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  ctx.font = `${built.fontSize}px ${INK_FONT}`;
  for (const l of built.labels) {
    ctx.fillText(l.text, l.cx - env.width(l.text, built.fontSize) / 2, l.cy - env.middle(built.fontSize));
  }
}

// Places the drawing on the board: pen strokes for the lines and text
// boxes for the labels, centred on `at`. `scale` is the board's zoom:
// sizes, line thickness and labels are all divided by it, so the shape
// lands looking exactly as it did in the preview however far you're
// zoomed in or out.
export function shapeToBoardObjects(built, { at, scale = 1, color, lineWidth, makeId, env = fallbackTextEnv }) {
  const z = scale > 0 ? scale : 1;
  const strokes = built.strokes.map((s) => {
    const width = Math.round((strokeWidthFor(s, lineWidth) / z) * 1000) / 1000;
    const out = {
      id: makeId(), tool: "pen", color, width, opacity: 1,
      points: s.points.map((p) => ({ x: at.x + p.x / z, y: at.y + p.y / z })),
    };
    if (s.dash) out.dash = dashFor(width);
    return out;
  });
  const round = (v) => Math.round(v * 100) / 100;
  const texts = built.labels.map((l) => {
    const w = env.width(l.text, built.fontSize);
    return {
      id: makeId(),
      x: round(at.x + (l.cx - w / 2) / z),
      y: round(at.y + (l.cy - env.middle(built.fontSize)) / z),
      text: l.text,
      color,
      fontSize: round(built.fontSize / z),
      width: round((w + 6) / z),
      rotation: 0,
    };
  });
  return { strokes, texts, images: [] };
}

// The dialog reopens with whatever you last added, until the page reloads.
let lastConfig = null;

export function rememberShapeConfig(cfg) {
  lastConfig = cfg;
}

export function recallShapeConfig() {
  return lastConfig;
}
