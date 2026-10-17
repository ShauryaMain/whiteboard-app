// Drawing what has been plotted on the board's graph: curves, points,
// shading, areas, key features, read-offs and the list of equations.
//
// Everything plotted is kept in the graph's own settings (grid_config.plot,
// see below), so it is saved, sent to everyone watching the board, moves
// and resizes with the graph, and can be changed again later. This file
// draws it; gridRenderer.js calls drawPlots() after the graph paper, so the
// board, the graph dialog's preview, students' views, thumbnails and saved
// pictures all show exactly the same thing.
//
// grid_config.plot:
//   {
//     fns: [{ id, latex, color, hidden?, area?: { on, from, to } }],
//     points: [{ id, color, pts: [[x, y], …], join?, fit?, labels? }],
//     params: { a: { value, min, max, step }, … },   // the sliders
//     features: { roots, yint, turning, intersections, asymptotes },
//     pins: [{ id, fnId, x, tangent? }],               // read-offs left on the board
//     angle: "rad" | "deg",
//     equations: true,                                 // list the equations on the graph
//     trace?: { fnId, x, tangent? },                   // a read-off in progress (never saved)
//   }

import {
  readEquation, readNumber, sampleCurve, zerosOf, turningPointsOf, asymptotesOf, areaUnder,
  bestFitLine, gradientAt, formatValue, asPiMultiple, DEFAULT_PARAM, tableXs, readInterval,
} from "./graphMath";
import { latexToText } from "./calcMath";
import { gridFrame, axesOf } from "./graphAxes";
import { graphDark, graphText, graphAxis, graphHalo, graphHole, graphCard, graphCardEdge, graphInk } from "./graphInk";

export const PLOT_COLORS = ["#E53935", "#1E88E5", "#43A047", "#8E24AA", "#FB8C00", "#00897B", "#1a1a1a"];

const FONT = "-apple-system, BlinkMacSystemFont, sans-serif";
const LABEL_INK = "#1B1D24"; // (lines drawn onto the board as ink)

export const EMPTY_PLOT = {
  fns: [],
  points: [],
  params: {},
  features: {},
  pins: [],
  angle: "rad",
  equations: true,
};

// A plot as saved or sent can be anything (an older version, or a broken
// message), so everything here reads it through this: the lists are
// lists, of objects, and the rest is the right shape. (Kept per plot, so
// drawing every frame doesn't make a new copy each time.)
const cleaned = new WeakMap();
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
export function cleanPlot(plot) {
  if (!isObj(plot)) return null;
  const hit = cleaned.get(plot);
  if (hit) return hit;
  const list = (v) => (Array.isArray(v) ? v.filter(isObj) : []);
  const params = {};
  if (isObj(plot.params)) for (const k in plot.params) if (isObj(plot.params[k])) params[k] = plot.params[k];
  const out = {
    ...plot,
    fns: list(plot.fns).filter((f) => typeof f.latex === "string"),
    points: list(plot.points).map((set) => ({ ...set, pts: Array.isArray(set.pts) ? set.pts.filter((q) => Array.isArray(q) && q.length >= 2) : [] })),
    pins: list(plot.pins),
    params,
    features: isObj(plot.features) ? plot.features : {},
  };
  if (isObj(plot.trace)) out.trace = plot.trace;
  else delete out.trace;
  cleaned.set(plot, out);
  return out;
}

// (charts and isometric paper have nothing plotted on them, whatever an
// earlier paper left behind)
function plotOf(config) {
  if (!config || config.type === "chart" || config.type === "isometric") return null;
  return cleanPlot(config.plot);
}

// The slider letters must match what the equations use: add any new
// letters (starting at 1) and drop ones no longer used.
export function tidyParams(rawPlot) {
  const plot = cleanPlot(rawPlot) || { ...EMPTY_PLOT };
  const used = new Set();
  for (const fn of plot.fns || []) {
    const r = readEquation(fn.latex);
    if (r.ok) for (const p of r.params) used.add(p);
  }
  const params = {};
  for (const n of [...used].sort()) params[n] = (plot.params && plot.params[n]) || { ...DEFAULT_PARAM };
  return { ...plot, params };
}

export function hasPlot(config) {
  const p = plotOf(config);
  return !!(p && (p.fns.length || p.points.length));
}

// The value of every slider letter.
export function paramValues(plot) {
  const out = {};
  const params = (plot && plot.params) || {};
  for (const k in params) {
    const v = Number(params[k] && params[k].value);
    out[k] = Number.isFinite(v) ? v : DEFAULT_PARAM.value;
  }
  return out;
}

// Whether sin, cos and tan work in degrees: always when the x-axis is in
// degrees, never when it's in π, otherwise as chosen on the Plot tab.
export function usesDegrees(config) {
  if (!config) return false;
  const label = axesOf(config).x.label;
  if (label === "deg") return true;
  if (label === "pi") return false;
  return !!(config.plot && config.plot.angle === "deg");
}

// Where the graph's maths coordinates sit on the board (see graphAxes.js).
//   geom: { cellPx, originXPx, originYPx, lineScale } (as for renderGrid)
export function graphFrame(config, geom) {
  return gridFrame(config, geom);
}

// ---------- caches (the board redraws on every movement of a pan) ----------

const curveCache = new Map();
const featureCache = new Map();
const implicitCache = new Map();

function remember(cache, key, make, limit = 80) {
  if (cache.has(key)) return cache.get(key);
  const value = make();
  if (cache.size >= limit) cache.delete(cache.keys().next().value);
  cache.set(key, value);
  return value;
}

function paramsKey(names, values) {
  return names.map((n) => `${n}=${values[n] ?? DEFAULT_PARAM.value}`).join(",");
}

// An equation ready to work with: { read, f (for y = f(x)), key }.
export function prepare(fn, plot, degrees) {
  const read = readEquation(fn.latex, { degrees });
  if (!read.ok) return { read, f: null, key: "" };
  const values = paramValues(plot);
  const scope = { ...values };
  for (const n of read.params) if (!(n in scope)) scope[n] = DEFAULT_PARAM.value;
  const key = `${degrees ? "d" : "r"}|${fn.latex}|${paramsKey(read.params, scope)}`;
  let f = null;
  if (read.kind === "y") {
    f = (x) => {
      scope.x = x;
      scope.θ = x;
      return read.evaluate(scope);
    };
  } else if (read.kind === "x") {
    f = () => read.evaluate(scope);
  } else if (read.kind === "polar") {
    f = (t) => {
      scope.θ = t;
      return read.evaluate(scope);
    };
  } else {
    f = (x, y) => {
      scope.x = x;
      scope.y = y;
      return read.evaluate(scope);
    };
  }
  return { read, f, key };
}

function samplesFor(screenPx) {
  const n = Math.min(2048, Math.max(256, Math.pow(2, Math.ceil(Math.log2(Math.max(1, screenPx))))));
  return n;
}

function curvePieces(prep, frame) {
  const [a, b] = frame.xRange;
  const n = samplesFor(frame.screenWidth * 1.5);
  const yr = frame.yRange[1] - frame.yRange[0];
  if (!frame.logX && !frame.logY) {
    return remember(curveCache, `${prep.key}|${a}|${b}|${n}|${yr}`, () => sampleCurve(prep.f, a, b, n, yr));
  }
  // On log paper: worked out evenly along the paper (in powers of 10), then
  // turned back into the curve's own numbers.
  const { fx, fy, fxInv, fyInv, uRange, vRange } = frame;
  return remember(curveCache, `log|${frame.logX}|${frame.logY}|${prep.key}|${a}|${b}|${n}|${yr}`, () => {
    const g = (u) => fy(prep.f(fxInv(u)));
    return sampleCurve(g, uRange[0], uRange[1], n, vRange[1] - vRange[0]).map((piece) => piece.map(([u, v]) => [fxInv(u), fyInv(v)]));
  });
}

// A straight line (y = mx + c) across the graph: two points, or many on
// log paper (where it's a curve).
function lineThrough(ctx, frame, m, c) {
  const [a, b] = frame.xRange;
  if (!frame.logX && !frame.logY) {
    const [ax, ay] = frame.toWorld(a, m * a + c);
    const [bx, by] = frame.toWorld(b, m * b + c);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    return;
  }
  let first = true;
  const [u0, u1] = frame.uRange;
  for (let i = 0; i <= 160; i++) {
    const x = frame.fxInv(u0 + ((u1 - u0) * i) / 160);
    const [wx, wy] = frame.toWorld(x, m * x + c);
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) {
      first = true;
      continue;
    }
    if (first) ctx.moveTo(wx, wy);
    else ctx.lineTo(wx, wy);
    first = false;
  }
}

// ---------- drawing helpers ----------

function withAlpha(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return `rgba(30,136,229,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function tracePieces(ctx, pieces, frame) {
  const { box } = frame;
  const h = box.y1 - box.y0;
  const top = box.y0 - 4 * h, bottom = box.y1 + 4 * h;
  for (const piece of pieces) {
    let first = true;
    for (const [mx, my] of piece) {
      const [wx, wyRaw] = frame.toWorld(mx, my);
      if (!Number.isFinite(wx) || !Number.isFinite(wyRaw)) {
        first = true;
        continue;
      }
      const wy = Math.max(top, Math.min(bottom, wyRaw));
      if (first) ctx.moveTo(wx, wy);
      else ctx.lineTo(wx, wy);
      first = false;
    }
  }
}

function label(ctx, text, x, y, ls, { align = "left", baseline = "bottom", color, size = 13 } = {}) {
  ctx.save();
  ctx.font = `600 ${size * ls}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.lineJoin = "round";
  ctx.lineWidth = 4 * ls;
  ctx.strokeStyle = graphHalo();
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color || graphText();
  ctx.fillText(text, x, y);
  ctx.restore();
}

// Puts a point's label at the first corner around it that is inside the
// graph and clear of the labels already placed. Returns false if none is.
function placeLabel(ctx, text, x, y, ls, frame, placed, preferBelow = false) {
  ctx.save();
  ctx.font = `600 ${13 * ls}px ${FONT}`;
  const w = ctx.measureText(text).width;
  ctx.restore();
  const h = 15 * ls, gap = 7 * ls;
  const { box } = frame;
  const spots = [
    [x + gap, y - gap - h], [x - gap - w, y - gap - h], [x + gap, y + gap], [x - gap - w, y + gap],
  ];
  if (preferBelow) spots.unshift(spots.splice(2, 1)[0]);
  for (const [lx, ly] of spots) {
    if (lx < box.x0 + 2 * ls || lx + w > box.x1 - 2 * ls || ly < box.y0 + 2 * ls || ly + h > box.y1 - 2 * ls) continue;
    const r = { x0: lx - 2 * ls, y0: ly - 1 * ls, x1: lx + w + 2 * ls, y1: ly + h + 1 * ls };
    if (placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) continue;
    placed.push(r);
    label(ctx, text, lx, ly, ls, { baseline: "top" });
    return true;
  }
  return false;
}

function dot(ctx, x, y, ls, color, r = 4.5) {
  ctx.beginPath();
  ctx.arc(x, y, r * ls, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5 * ls;
  ctx.strokeStyle = graphHole();
  ctx.stroke();
}

// A value as it should be written for an axis: in π on a π axis, with ° on
// a degrees axis.
function axisValueText(v, axis) {
  if (axis && axis.label === "pi") {
    const p = asPiMultiple(v);
    if (p) return p;
  }
  if (axis && axis.label === "deg") return `${formatValue(v)}°`;
  return formatValue(v);
}

export function formatX(v, config) {
  return axisValueText(v, config ? axesOf(config).x : null);
}

export function formatY(v, config) {
  return axisValueText(v, config ? axesOf(config).y : null);
}

export function pointText(x, y, config) {
  return `(${formatX(x, config)}, ${formatY(y, config)})`;
}

// ---------- key features ----------

export function featuresOf(prep, frame, config) {
  const [a, b] = frame.xRange;
  const yr = frame.yRange[1] - frame.yRange[0];
  return remember(featureCache, `${prep.key}|${a}|${b}`, () => {
    const f = prep.f;
    const roots = zerosOf(f, a, b, 1200, yr).map((x) => ({ x: Math.abs(x) < 1e-12 ? 0 : x, y: 0 }));
    const turning = turningPointsOf(f, a, b, yr);
    const y0 = a <= 0 && b >= 0 ? f(0) : NaN;
    const asym = asymptotesOf(f, a, b, yr);
    return { roots, turning, yint: Number.isFinite(y0) ? { x: 0, y: y0 } : null, asym };
  });
}

function intersectionsOf(p1, p2, frame) {
  const [a, b] = frame.xRange;
  const yr = frame.yRange[1] - frame.yRange[0];
  return remember(featureCache, `x|${p1.key}|${p2.key}|${a}|${b}`, () => {
    const g = (x) => p1.f(x) - p2.f(x);
    return zerosOf(g, a, b, 1200, yr)
      .map((x) => ({ x, y: p1.f(x) }))
      .filter((p) => Number.isFinite(p.y));
  });
}

// ---------- implicit curves (x² + y² = 25) ----------

function implicitGrid(prep, frame) {
  // detail in a few fixed steps by size on screen, so zooming doesn't work
  // the whole thing out again on every frame
  const detail = (px) => (px < 270 ? 60 : px < 480 ? 120 : px < 780 ? 200 : 320);
  const cols = detail(frame.screenWidth);
  const rows = detail(frame.screenHeight);
  // worked out evenly across the paper (in powers of 10 on log paper)
  const [xa, xb] = frame.uRange, [ya, yb] = frame.vRange;
  const { fxInv, fyInv } = frame;
  return remember(implicitCache, `${frame.logX}|${frame.logY}|${prep.key}|${xa}|${xb}|${ya}|${yb}|${cols}|${rows}`, () => {
    const vals = new Float64Array((cols + 1) * (rows + 1));
    for (let j = 0; j <= rows; j++) {
      const y = fyInv(yb - ((yb - ya) * j) / rows);
      for (let i = 0; i <= cols; i++) {
        const x = fxInv(xa + ((xb - xa) * i) / cols);
        vals[j * (cols + 1) + i] = prep.f(x, y);
      }
    }
    // the curve itself: marching squares
    const segs = [];
    const at = (i, j) => vals[j * (cols + 1) + i];
    const px = (i) => xa + ((xb - xa) * i) / cols;
    const py = (j) => yb - ((yb - ya) * j) / rows;
    const cross = (i1, j1, v1, i2, j2, v2) => {
      const t = v1 / (v1 - v2);
      return [px(i1) + (px(i2) - px(i1)) * t, py(j1) + (py(j2) - py(j1)) * t];
    };
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
        if (![a, b, c, d].every(Number.isFinite)) continue;
        const pts = [];
        if ((a < 0) !== (b < 0)) pts.push(cross(i, j, a, i + 1, j, b));
        if ((b < 0) !== (c < 0)) pts.push(cross(i + 1, j, b, i + 1, j + 1, c));
        if ((c < 0) !== (d < 0)) pts.push(cross(i + 1, j + 1, c, i, j + 1, d));
        if ((d < 0) !== (a < 0)) pts.push(cross(i, j + 1, d, i, j, a));
        // a sign change across a "jump" (1/x-style) isn't part of the curve
        const big = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
        if (pts.length >= 2 && big < 1e8) {
          segs.push(pts[0], pts[1]);
          if (pts.length === 4) segs.push(pts[2], pts[3]);
        }
      }
    }
    const paths = joinSegments(segs, (xb - xa) / cols / 1000).map((path) => path.map(([u, v]) => [fxInv(u), fyInv(v)]));
    return { vals, cols, rows, paths, mask: null };
  }, 24);
}

// Marching squares gives the curve as thousands of tiny separate pieces;
// joined into long lines, a dashed edge (x² + y² < 9) really is dashed.
function joinSegments(segs, tol) {
  const key = (p) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`;
  const ends = new Map();
  const n = segs.length / 2;
  const used = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    for (const p of [segs[2 * k], segs[2 * k + 1]]) {
      const id = key(p);
      if (!ends.has(id)) ends.set(id, []);
      ends.get(id).push(k);
    }
  }
  const other = (k, p) => (key(segs[2 * k]) === key(p) ? segs[2 * k + 1] : segs[2 * k]);
  const extend = (path) => {
    for (;;) {
      const tail = path[path.length - 1];
      const next = (ends.get(key(tail)) || []).find((k) => !used[k]);
      if (next === undefined) return;
      used[next] = 1;
      path.push(other(next, tail));
    }
  };
  const paths = [];
  for (let k = 0; k < n; k++) {
    if (used[k]) continue;
    used[k] = 1;
    const path = [segs[2 * k], segs[2 * k + 1]];
    extend(path);
    path.reverse();
    extend(path);
    paths.push(path);
  }
  return paths;
}

function implicitMask(grid, op) {
  if (grid.mask && grid.mask.op === op) return grid.mask.canvas;
  if (typeof document === "undefined") return null;
  const { vals, cols, rows } = grid;
  const canvas = document.createElement("canvas");
  canvas.width = cols + 1;
  canvas.height = rows + 1;
  const c = canvas.getContext("2d");
  if (!c) return null;
  const img = c.createImageData(cols + 1, rows + 1);
  for (let k = 0; k < vals.length; k++) {
    const v = vals[k];
    const inside = op === "<" || op === "≤" ? v < 0 : v > 0;
    img.data[k * 4 + 3] = Number.isFinite(v) && inside ? 255 : 0;
  }
  c.putImageData(img, 0, 0);
  grid.mask = { op, canvas };
  return canvas;
}

// ---------- the whole plot ----------

// On a dark page, black lines and points show white (like ink).
// (Kept per plot, so the curves worked out for it aren't worked out again
// every frame.)
const onDark = new WeakMap();
function onPage(plot) {
  if (!plot || !graphDark()) return plot;
  const hit = onDark.get(plot);
  if (hit) return hit;
  const out = {
    ...plot,
    fns: (plot.fns || []).map((fn) => {
      if (!fn || !fn.color || graphInk(fn.color) === fn.color) return fn;
      return { ...fn, color: graphInk(fn.color) };
    }),
    points: (plot.points || []).map((set) => (set && set.color ? { ...set, color: graphInk(set.color) } : set)),
  };
  onDark.set(plot, out);
  return out;
}

export function drawPlots(ctx, config, geom) {
  const plot = onPage(plotOf(config));
  if (!plot) return;
  const frame = graphFrame(config, geom);
  if (frame.numberLine) {
    drawNumberLineMarks(ctx, plot, frame);
    return;
  }
  const ls = frame.lineScale;
  const { box } = frame;
  // roots, turning points and areas aren't worked out on log paper
  const onLog = frame.logX || frame.logY;
  const degrees = usesDegrees(config);
  const fns = (plot.fns || []).filter((fn) => fn && !fn.hidden && fn.latex);
  const preps = fns.map((fn) => ({ fn, prep: prepare(fn, plot, degrees) })).filter((p) => p.prep.read.ok);

  ctx.save();
  // (whatever happens, the clip comes off again)
  try {
    ctx.beginPath();
    ctx.rect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
    ctx.clip();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    // every point label drawn so far, so none lands on another
    const placed = [];
    if (plot.equations !== false) placed.push(legendBox(ctx, plot, preps, frame, ls));

    // 1. shading underneath everything. Not while a line is being drawn
    // (geom.quick): the graph is drawn again over each new bit of the line
    // without clearing, so see-through shading would build up and hide it.
    for (const { fn, prep } of geom.quick ? [] : preps) {
      const { read } = prep;
      const fill = withAlpha(fn.color, 0.16);
      if (read.kind === "y" && read.op !== "=") {
        const above = read.op === ">" || read.op === "≥";
        const edgeY = above ? box.y0 : box.y1;
        ctx.beginPath();
        for (const piece of curvePieces(prep, frame)) {
          if (!piece.length) continue;
          const h = box.y1 - box.y0;
          const clampY = (y) => Math.max(box.y0 - 4 * h, Math.min(box.y1 + 4 * h, y));
          const [sx0] = frame.toWorld(piece[0][0], 0);
          ctx.moveTo(sx0, edgeY);
          for (const [mx, my] of piece) {
            const [wx, wy] = frame.toWorld(mx, my);
            ctx.lineTo(wx, clampY(wy));
          }
          const [sx1] = frame.toWorld(piece[piece.length - 1][0], 0);
          ctx.lineTo(sx1, edgeY);
          ctx.closePath();
        }
        ctx.fillStyle = fill;
        ctx.fill();
      } else if (read.kind === "x" && read.op !== "=") {
        const c = prep.f();
        if (Number.isFinite(c)) {
          const [wx] = frame.toWorld(c, 0);
          const right = read.op === ">" || read.op === "≥";
          ctx.fillStyle = fill;
          if (right) ctx.fillRect(wx, box.y0, box.x1 - wx, box.y1 - box.y0);
          else ctx.fillRect(box.x0, box.y0, wx - box.x0, box.y1 - box.y0);
        }
      } else if (read.kind === "implicit" && read.op !== "=") {
        const grid = implicitGrid(prep, frame);
        const mask = implicitMask(grid, read.op);
        if (mask) {
          // tint the mask in the curve's colour, then lay it over the box
          const tinted = tintCanvas(mask, fn.color);
          if (tinted) {
            ctx.save();
            ctx.globalAlpha = 0.16;
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(tinted, box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
            ctx.restore();
          }
        }
      }
      // the area under the curve between two values of x
      if (read.kind === "y" && fn.area && fn.area.on && !onLog) {
        const values = paramValues(plot);
        const a = readNumber(fn.area.from, values), b = readNumber(fn.area.to, values);
        if (Number.isFinite(a) && Number.isFinite(b) && a !== b) {
          const lo = Math.min(a, b), hi = Math.max(a, b);
          const yr = frame.yRange[1] - frame.yRange[0];
          const pieces = remember(curveCache, `area|${prep.key}|${lo}|${hi}`, () => sampleCurve(prep.f, lo, hi, 400, yr));
          const [, axisY] = frame.toWorld(0, 0);
          ctx.beginPath();
          for (const piece of pieces) {
            if (!piece.length) continue;
            ctx.moveTo(frame.toWorld(piece[0][0], 0)[0], axisY);
            for (const [mx, my] of piece) {
              const [wx, wy] = frame.toWorld(mx, my);
              ctx.lineTo(wx, Math.max(box.y0 - 2 * (box.y1 - box.y0), Math.min(box.y1 + 2 * (box.y1 - box.y0), wy)));
            }
            ctx.lineTo(frame.toWorld(piece[piece.length - 1][0], 0)[0], axisY);
            ctx.closePath();
          }
          ctx.fillStyle = withAlpha(fn.color, 0.28);
          ctx.fill();
        }
      }
    }

    // 2. the curves
    for (const { fn, prep } of preps) {
      const { read } = prep;
      ctx.save();
      ctx.strokeStyle = fn.color || PLOT_COLORS[0];
      ctx.lineWidth = 2.6 * ls;
      if (read.strict) ctx.setLineDash([9 * ls, 7 * ls]);
      ctx.beginPath();
      if (read.kind === "y") {
        tracePieces(ctx, curvePieces(prep, frame), frame);
      } else if (read.kind === "x") {
        const c = prep.f();
        if (Number.isFinite(c)) {
          const [wx] = frame.toWorld(c, 0);
          ctx.moveTo(wx, box.y0);
          ctx.lineTo(wx, box.y1);
        }
      } else if (read.kind === "polar") {
        const turn = degrees ? 360 : Math.PI * 2;
        const pieces = remember(curveCache, `polar|${prep.key}`, () => {
          const out = [];
          let piece = null;
          const n = 1440;
          for (let i = 0; i <= n; i++) {
            const t = (turn * i) / n;
            const r = prep.f(t);
            const rad = degrees ? (t * Math.PI) / 180 : t;
            if (!Number.isFinite(r)) {
              if (piece) out.push(piece);
              piece = null;
              continue;
            }
            if (!piece) piece = [];
            piece.push([r * Math.cos(rad), r * Math.sin(rad)]);
          }
          if (piece) out.push(piece);
          return out;
        });
        tracePieces(ctx, pieces, frame);
      } else {
        tracePieces(ctx, implicitGrid(prep, frame).paths, frame);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 3. plotted points, joined up or with a line of best fit
    for (const set of plot.points || []) {
      const pts = (set.pts || []).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
      if (!pts.length) continue;
      const color = set.color || PLOT_COLORS[1];
      if (set.join && pts.length > 1) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 * ls;
        ctx.beginPath();
        let first = true;
        for (const [x, y] of pts) {
          const [wx, wy] = frame.toWorld(x, y);
          // (a point log paper can't show, at 0 or below, is left out)
          if (!Number.isFinite(wx) || !Number.isFinite(wy)) continue;
          if (first) ctx.moveTo(wx, wy);
          else ctx.lineTo(wx, wy);
          first = false;
        }
        ctx.stroke();
        ctx.restore();
      }
      if (set.fit) {
        const fit = bestFitLine(pts);
        if (fit) {
          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = 2 * ls;
          ctx.setLineDash([12 * ls, 6 * ls]);
          ctx.beginPath();
          lineThrough(ctx, frame, fit.m, fit.c);
          ctx.stroke();
          ctx.restore();
        }
      }
      for (const [x, y] of pts) {
        const [wx, wy] = frame.toWorld(x, y);
        if (!Number.isFinite(wx) || !Number.isFinite(wy)) continue;
        dot(ctx, wx, wy, ls, color, 5);
        if (set.labels) placeLabel(ctx, pointText(x, y, config), wx, wy, ls, frame, placed);
      }
    }

    // 4. key features
    const want = onLog ? {} : plot.features || {};
    const explicit = preps.filter((p) => p.prep.read.kind === "y" && p.prep.read.op === "=");
    const marks = [];
    for (const { fn, prep } of explicit) {
      if (!(want.roots || want.yint || want.turning || want.asymptotes)) break;
      const feats = featuresOf(prep, frame, config);
      if (want.asymptotes) {
        ctx.save();
        ctx.strokeStyle = withAlpha(fn.color, 0.85);
        ctx.lineWidth = 1.5 * ls;
        ctx.setLineDash([5 * ls, 5 * ls]);
        for (const x of feats.asym.vertical) {
          const [wx] = frame.toWorld(x, 0);
          ctx.beginPath();
          ctx.moveTo(wx, box.y0);
          ctx.lineTo(wx, box.y1);
          ctx.stroke();
          label(ctx, `x = ${formatX(x, config)}`, wx + 5 * ls, box.y0 + 6 * ls, ls, { baseline: "top", color: fn.color });
        }
        for (const yv of feats.asym.horizontal) {
          if (yv < frame.yRange[0] || yv > frame.yRange[1]) continue;
          const [, wy] = frame.toWorld(0, yv);
          ctx.beginPath();
          ctx.moveTo(box.x0, wy);
          ctx.lineTo(box.x1, wy);
          ctx.stroke();
          label(ctx, `y = ${formatValue(yv)}`, box.x1 - 6 * ls, wy - 4 * ls, ls, { align: "right", color: fn.color });
        }
        ctx.restore();
      }
      if (want.roots) for (const p of feats.roots) marks.push({ ...p, color: fn.color });
      if (want.yint && feats.yint) marks.push({ ...feats.yint, color: fn.color });
      if (want.turning) for (const p of feats.turning) marks.push({ ...p, color: fn.color });
    }
    if (want.intersections) {
      for (let i = 0; i < explicit.length; i++) {
        for (let j = i + 1; j < explicit.length; j++) {
          for (const p of intersectionsOf(explicit[i].prep, explicit[j].prep, frame)) marks.push({ ...p, color: graphText() });
        }
        // with vertical lines, x = c
        for (const other of preps) {
          if (other.prep.read.kind !== "x" || other.prep.read.op !== "=") continue;
          const c = other.prep.f();
          const y = explicit[i].prep.f(c);
          if (Number.isFinite(c) && Number.isFinite(y)) marks.push({ x: c, y, color: graphText() });
        }
      }
    }
    const seen = [];
    const shown = marks.filter((m) => {
      if (m.y < frame.yRange[0] || m.y > frame.yRange[1] || m.x < frame.xRange[0] || m.x > frame.xRange[1]) return false;
      const [wx, wy] = frame.toWorld(m.x, m.y);
      if (seen.some(([sx2, sy2]) => Math.abs(sx2 - wx) < 3 * ls && Math.abs(sy2 - wy) < 3 * ls)) return false;
      seen.push([wx, wy]);
      return true;
    });
    for (const m of shown) {
      const [wx, wy] = frame.toWorld(m.x, m.y);
      dot(ctx, wx, wy, ls, m.color, 5);
    }
    // labels only while they fit (a curve like sin x over a wide range has
    // dozens), and never on top of each other: each tries the four corners
    // around its dot and is left out if none is free
    if (shown.length <= 16) {
      for (const m of shown) {
        const [wx, wy] = frame.toWorld(m.x, m.y);
        placeLabel(ctx, pointText(m.x, m.y, config), wx, wy, ls, frame, placed, m.kind === "min");
      }
    }

    // 5. areas' values
    for (const { fn, prep } of preps) {
      if (prep.read.kind !== "y" || !fn.area || !fn.area.on || onLog) continue;
      const values = paramValues(plot);
      const a = readNumber(fn.area.from, values), b = readNumber(fn.area.to, values);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) continue;
      const res = remember(featureCache, `areaval|${prep.key}|${a}|${b}`, () => areaUnder(prep.f, a, b));
      const mid = (a + b) / 2;
      const ym = prep.f(mid);
      const [wx, wy] = frame.toWorld(mid, Number.isFinite(ym) ? ym / 2 : 0);
      const text = !Number.isFinite(res.integral)
        ? "Area can't be worked out here"
        : res.crosses
          ? `∫ = ${formatValue(res.integral, 3)}  (area ${formatValue(res.area, 3)})`
          : `Area = ${formatValue(res.area, 3)}`;
      label(ctx, text, wx, Math.max(box.y0 + 16 * ls, Math.min(box.y1 - 6 * ls, wy)), ls, { align: "center", baseline: "middle", color: graphText(), size: 14 });
    }

    // 6. read-offs: the pinned ones, and one being moved along a curve now
    const readouts = [...(plot.pins || []).map((p) => ({ ...p, pinned: true }))];
    if (plot.trace) readouts.push({ ...plot.trace, pinned: false });
    for (const r of readouts) {
      const owner = preps.find((p) => p.fn.id === r.fnId && p.prep.read.kind === "y");
      if (!owner) continue;
      drawReadout(ctx, owner, r, frame, config, ls, placed);
    }

  } finally {
    ctx.restore();
  }

  // 7. the equations, top left
  if (plot.equations !== false) drawLegend(ctx, plot, preps, frame, ls);
}

// ---------- a number line ----------

// What's marked on a number line: each line on the Plot tab is a point
// (x = 2) or an inequality (x > 2, −1 ≤ x < 3). A point is a dot on the
// line; an inequality is a thick bar above it, with a filled circle where
// the end is included and an open one where it isn't, and an arrow where
// it carries on for ever.
function drawNumberLineMarks(ctx, plot, frame) {
  const { box, lineScale: ls, lineY } = frame;
  const px = (v) => frame.ox + v * frame.sx;
  const clampX = (x) => Math.max(box.x0, Math.min(box.x1, x));
  let level = 0;
  for (const fn of plot.fns) {
    if (fn.hidden || !fn.latex) continue;
    const m = readInterval(fn.latex);
    if (!m.ok) continue;
    const color = fn.color || PLOT_COLORS[0];
    if (m.kind === "point") {
      if (m.lo < frame.xRange[0] || m.lo > frame.xRange[1]) continue;
      ctx.save();
      ctx.beginPath();
      ctx.arc(px(m.lo), lineY, 6.5 * ls, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
      continue;
    }
    const y = lineY - (24 + 28 * level) * ls;
    level++;
    const a = Number.isFinite(m.lo) ? px(m.lo) : -Infinity;
    const b = Number.isFinite(m.hi) ? px(m.hi) : Infinity;
    const xa = clampX(a), xb = clampX(b);
    if (xb < xa) continue;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = "butt";
    // faint lines down to where the ends are on the number line
    ctx.lineWidth = 1.2 * ls;
    ctx.setLineDash([3 * ls, 3 * ls]);
    ctx.beginPath();
    for (const e of [a, b]) {
      if (!Number.isFinite(e) || e < box.x0 || e > box.x1) continue;
      ctx.moveTo(e, y);
      ctx.lineTo(e, lineY);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 4.5 * ls;
    ctx.beginPath();
    ctx.moveTo(xa, y);
    ctx.lineTo(xb, y);
    ctx.stroke();
    // an arrow where it goes on for ever (or off the end of the line)
    const head = (x, dir) => {
      ctx.beginPath();
      ctx.moveTo(x + dir * 4 * ls, y);
      ctx.lineTo(x - dir * 9 * ls, y - 7 * ls);
      ctx.lineTo(x - dir * 9 * ls, y + 7 * ls);
      ctx.closePath();
      ctx.fill();
    };
    if (b > box.x1) head(box.x1, 1);
    if (a < box.x0) head(box.x0, -1);
    const end = (x, closed) => {
      if (!Number.isFinite(x) || x < box.x0 || x > box.x1) return;
      ctx.beginPath();
      ctx.arc(x, y, 6.5 * ls, 0, Math.PI * 2);
      ctx.fillStyle = closed ? color : graphHole();
      ctx.fill();
      ctx.lineWidth = 2.5 * ls;
      ctx.stroke();
    };
    end(a, m.loClosed);
    end(b, m.hiClosed);
    ctx.restore();
    if (plot.equations !== false) {
      label(ctx, equationText(fn.latex).replace(/^y = /, ""), Math.max(box.x0 + 4 * ls, Math.min(xa, xb - 40 * ls)) + 10 * ls, y - 6 * ls, ls, { color, size: 12 });
    }
  }
}

function drawReadout(ctx, owner, r, frame, config, ls, placed) {
  const { box } = frame;
  const x = Number(r.x);
  const y = owner.prep.f(x);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const [wx, wy] = frame.toWorld(x, y);
  if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;
  // dotted lines across to the axes, wherever they are drawn
  const toX = Math.max(box.x0, Math.min(box.x1, frame.axisX));
  const toY = Math.max(box.y0, Math.min(box.y1, frame.axisY));
  ctx.save();
  ctx.strokeStyle = owner.fn.color;
  ctx.lineWidth = 1.5 * ls;
  ctx.setLineDash([3 * ls, 4 * ls]);
  ctx.beginPath();
  ctx.moveTo(wx, wy);
  ctx.lineTo(wx, toY);
  ctx.moveTo(wx, wy);
  ctx.lineTo(toX, wy);
  ctx.stroke();
  ctx.restore();
  if (r.tangent) {
    const span = frame.xRange[1] - frame.xRange[0];
    const m = gradientAt(owner.prep.f, x, span);
    if (Number.isFinite(m)) {
      ctx.save();
      ctx.strokeStyle = graphText();
      ctx.lineWidth = 1.8 * ls;
      ctx.beginPath();
      lineThrough(ctx, frame, m, y - m * x);
      ctx.stroke();
      ctx.restore();
      placeLabel(ctx, `gradient = ${formatValue(m, 3)}`, wx, wy + 16 * ls, ls, frame, placed, true);
    }
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(wx, wy, (r.pinned ? 6 : 8) * ls, 0, Math.PI * 2);
  ctx.fillStyle = graphHole();
  ctx.fill();
  ctx.lineWidth = 3 * ls;
  ctx.strokeStyle = owner.fn.color;
  ctx.stroke();
  ctx.restore();
  placeLabel(ctx, pointText(x, y, config), wx, wy, ls, frame, placed);
}

function legendRows(plot, preps) {
  const rows = [];
  for (const { fn } of preps) rows.push({ color: fn.color, text: equationText(fn.latex) });
  for (const set of plot.points || []) {
    if (!set.fit) continue;
    const pts = (set.pts || []).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    const fit = bestFitLine(pts);
    if (fit) rows.push({ color: set.color, text: `best fit: ${lineText(fit.m, fit.c)}`, dashed: true });
  }
  const used = new Set();
  for (const { prep } of preps) for (const n of prep.read.params) used.add(n);
  const values = paramValues(plot);
  const sliderText = [...used].sort().map((n) => `${n} = ${formatValue(values[n] ?? DEFAULT_PARAM.value)}`).join(",  ");
  if (sliderText) rows.push({ color: null, text: sliderText });
  return rows;
}

function legendLayout(ctx, rows, frame, ls) {
  const size = 14 * ls;
  ctx.save();
  ctx.font = `600 ${size}px ${FONT}`;
  const pad = 7 * ls, sw = 14 * ls, gap = 6 * ls, lineH = size * 1.45;
  const width = Math.max(...rows.map((r) => ctx.measureText(r.text).width + (r.color ? sw + gap : 0))) + pad * 2;
  ctx.restore();
  const height = rows.length * lineH + pad * 2 - (lineH - size);
  const x = frame.box.x0 + 8 * ls, y = frame.box.y0 + 8 * ls;
  return { size, pad, sw, gap, lineH, width, height, x, y };
}

function legendBox(ctx, plot, preps, frame, ls) {
  const rows = legendRows(plot, preps);
  if (!rows.length) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  const L = legendLayout(ctx, rows, frame, ls);
  return { x0: L.x, y0: L.y, x1: L.x + L.width, y1: L.y + L.height };
}

function drawLegend(ctx, plot, preps, frame, ls) {
  const rows = legendRows(plot, preps);
  if (!rows.length) return;
  const { size, pad, sw, gap, lineH, width, height, x, y } = legendLayout(ctx, rows, frame, ls);
  ctx.save();
  ctx.font = `600 ${size}px ${FONT}`;
  ctx.fillStyle = graphCard();
  ctx.strokeStyle = graphCardEdge();
  ctx.lineWidth = 1 * ls;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, width, height, 6 * ls);
  else ctx.rect(x, y, width, height);
  ctx.fill();
  ctx.stroke();
  ctx.textBaseline = "top";
  rows.forEach((r, k) => {
    const ty = y + pad + k * lineH;
    let tx = x + pad;
    if (r.color) {
      ctx.save();
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3 * ls;
      if (r.dashed) ctx.setLineDash([4 * ls, 3 * ls]);
      ctx.beginPath();
      ctx.moveTo(tx, ty + size * 0.55);
      ctx.lineTo(tx + sw, ty + size * 0.55);
      ctx.stroke();
      ctx.restore();
      tx += sw + gap;
    }
    ctx.fillStyle = r.color ? graphText() : graphAxis();
    ctx.fillText(r.text, tx, ty);
  });
  ctx.restore();
}

export function equationText(latex) {
  const t = latexToText(String(latex || "").replace(/\\(var)?theta(?![a-zA-Z])/g, "θ"))
    .replace(/(sin|cos|tan|sec|csc|cot)θ/g, "$1 θ")
    // "a sin(x)", not "asin(x)" (which reads like arcsin)
    .replace(/([0-9a-zA-Zπθ)])(sin|cos|tan|sec|csc|cot|ln|log)(?=[(\s\w])/g, "$1 $2")
    .replace(/\s*([=<>≤≥])\s*/g, " $1 ")
    // "(1/2)x²", not "1/2x²" (which reads like 1 over 2x²)
    .replace(/(^|[^\w.)])(\d+(?:\.\d+)?\/\d+(?:\.\d+)?)(?=\s?[a-zA-Zπθ(√∛])/g, "$1($2)")
    // "2ˣ" rather than "2^(x)"
    .replace(/\^\(x\)/g, "ˣ")
    .replace(/\^\(n\)/g, "ⁿ")
    .replace(/-/g, "−")
    .replace(/\s+/g, " ")
    .trim();
  return /[=<>≤≥]/.test(t) ? t : `y = ${t}`;
}

export function lineText(m, c) {
  const mm = formatValue(m, 3);
  const cc = formatValue(Math.abs(c), 3);
  const sign = c < 0 ? "−" : "+";
  if (Math.abs(c) < 1e-9) return `y = ${mm}x`;
  return `y = ${mm}x ${sign} ${cc}`;
}

let tintCache = new WeakMap();
function tintCanvas(mask, color) {
  if (typeof document === "undefined") return null;
  const key = color || "#1E88E5";
  let byColor = tintCache.get(mask);
  if (!byColor) {
    byColor = new Map();
    tintCache.set(mask, byColor);
  }
  if (byColor.has(key)) return byColor.get(key);
  const c = document.createElement("canvas");
  c.width = mask.width;
  c.height = mask.height;
  const x = c.getContext("2d");
  if (!x) return null;
  x.drawImage(mask, 0, 0);
  x.globalCompositeOperation = "source-in";
  x.fillStyle = key;
  x.fillRect(0, 0, c.width, c.height);
  byColor.set(key, c);
  return c;
}

// ---------- reading off a curve ----------

// The point on a curve (y = f(x)) nearest to a place on the board, if one
// is within `reach` (board units). { fnId, x, y } or null.
export function curvePointNear(config, geom, wx, wy, reach) {
  const plot = plotOf(config);
  if (!plot) return null;
  const frame = graphFrame(config, geom);
  if (frame.numberLine) return null;
  const { box } = frame;
  if (wx < box.x0 - reach || wx > box.x1 + reach || wy < box.y0 - reach || wy > box.y1 + reach) return null;
  const degrees = usesDegrees(config);
  let best = null;
  for (const fn of plot.fns || []) {
    if (!fn || fn.hidden) continue;
    const prep = prepare(fn, plot, degrees);
    if (!prep.read.ok || prep.read.kind !== "y") continue;
    // (along the paper, so it works the same on log paper)
    const u = (wx - frame.ox) / frame.sx;
    const span = reach / frame.sx;
    for (let k = -20; k <= 20; k++) {
      const x = frame.fxInv(u + (span * k) / 20);
      const y = prep.f(x);
      if (!Number.isFinite(y)) continue;
      const [px, py] = frame.toWorld(x, y);
      const d = Math.hypot(px - wx, py - wy);
      if (d <= reach && (!best || d < best.d)) best = { fnId: fn.id, x, y, d };
    }
  }
  return best ? { fnId: best.fnId, x: best.x, y: best.y } : null;
}

// Moving along one curve: x follows the finger; it settles on a root,
// turning point or intercept when one is close (so exact values are easy).
export function traceAlong(config, geom, fnId, wx, snapReach = 0) {
  const plot = plotOf(config);
  if (!plot) return null;
  const fn = (plot.fns || []).find((f) => f.id === fnId);
  if (!fn) return null;
  const frame = graphFrame(config, geom);
  const prep = prepare(fn, plot, usesDegrees(config));
  if (!prep.read.ok || prep.read.kind !== "y") return null;
  let [x] = frame.toMath(wx, 0);
  x = Math.max(frame.xRange[0], Math.min(frame.xRange[1], x));
  if (snapReach > 0 && !frame.logX && !frame.logY) {
    const feats = featuresOf(prep, frame, config);
    const special = [...feats.roots, ...feats.turning, ...(feats.yint ? [feats.yint] : [])];
    let best = null;
    for (const p of special) {
      const d = Math.abs(p.x - x) * frame.sx;
      if (d <= snapReach && (!best || d < best.d)) best = { x: p.x, d };
    }
    if (best) x = best.x;
  }
  const y = prep.f(x);
  return { fnId, x, y: Number.isFinite(y) ? y : NaN };
}

// A pinned read-off near a place on the board (to take it off again).
export function pinNear(config, geom, wx, wy, reach) {
  const plot = plotOf(config);
  if (!plot || !plot.pins || !plot.pins.length) return null;
  const frame = graphFrame(config, geom);
  if (frame.numberLine) return null;
  const degrees = usesDegrees(config);
  for (const pin of plot.pins) {
    const fn = (plot.fns || []).find((f) => f.id === pin.fnId);
    if (!fn) continue;
    const prep = prepare(fn, plot, degrees);
    if (!prep.read.ok || prep.read.kind !== "y") continue;
    const y = prep.f(pin.x);
    if (!Number.isFinite(y)) continue;
    const [px, py] = frame.toWorld(pin.x, y);
    if (Math.hypot(px - wx, py - wy) <= reach) return pin;
  }
  return null;
}

// Where on the board a point of the graph is (for the little bar shown
// beside a read-off).
export function worldPointOf(config, geom, x, y) {
  return graphFrame(config, geom).toWorld(x, y);
}

export function readoutValues(config, geom, fnId, x) {
  const plot = plotOf(config);
  const fn = plot && (plot.fns || []).find((f) => f.id === fnId);
  if (!fn) return null;
  const frame = graphFrame(config, geom);
  const prep = prepare(fn, plot, usesDegrees(config));
  if (!prep.read.ok || prep.read.kind !== "y") return null;
  const y = prep.f(x);
  const m = gradientAt(prep.f, x, frame.xRange[1] - frame.xRange[0]);
  return { x, y, gradient: m, text: pointText(x, y, config), color: fn.color };
}

// ---------- a table of values, as ordinary writing on the board ----------

// Builds the table as board objects (lines and text boxes) with its top
// left corner at `at` (board units). `zoom` is the board's zoom, so the
// table is a comfortable size on screen whatever the zoom.
export function tableObjects(config, { fnId, from, to, step, blankY = false }, { at, zoom = 1, makeId, env }) {
  const plot = plotOf(config);
  const fn = plot && (plot.fns || []).find((f) => f.id === fnId);
  if (!fn) return null;
  const values = paramValues(plot);
  const xs = tableXs(readNumber(from, values), readNumber(to, values), readNumber(step, values));
  if (!xs.length) return null;
  const prep = prepare(fn, plot, usesDegrees(config));
  if (!prep.read.ok || prep.read.kind !== "y") return null;
  const z = zoom > 0 ? zoom : 1;
  const fontPx = 18;
  const fontSize = fontPx / z;
  const xLabels = xs.map((x) => formatX(x, config));
  const yLabels = xs.map((x) => (blankY ? "" : formatValue(prep.f(x))));
  const headerX = "x", headerY = "y";
  const measure = (t) => (env ? env.width(t, fontPx) : String(t).length * fontPx * 0.6);
  const colW = Math.max(36, ...[...xLabels, ...yLabels].map(measure)) + 16;
  const headW = Math.max(36, measure(headerX), measure(headerY)) + 16;
  const rowH = fontPx * 2;
  const n = xs.length;
  const widthPx = headW + colW * n;
  const strokes = [];
  const color = LABEL_INK;
  const line = (x1, y1, x2, y2) => strokes.push({
    id: makeId(), tool: "pen", color, width: Math.round((2 / z) * 1000) / 1000, opacity: 1,
    points: [{ x: at.x + x1 / z, y: at.y + y1 / z }, { x: at.x + x2 / z, y: at.y + y2 / z }],
  });
  // outline, the line between the rows, and the column lines
  line(0, 0, widthPx, 0);
  line(0, rowH, widthPx, rowH);
  line(0, rowH * 2, widthPx, rowH * 2);
  line(0, 0, 0, rowH * 2);
  line(headW, 0, headW, rowH * 2);
  for (let k = 1; k <= n; k++) line(headW + colW * k, 0, headW + colW * k, rowH * 2);
  const round = (v) => Math.round(v * 100) / 100;
  const middle = env ? env.middle(fontPx) : fontPx * 0.46;
  const texts = [];
  const cell = (text, cx, cy) => {
    if (!text) return;
    const w = measure(text);
    texts.push({
      id: makeId(),
      x: round(at.x + (cx - w / 2) / z),
      y: round(at.y + (cy - middle) / z),
      text,
      color,
      fontSize: round(fontSize),
      width: round((w + 6) / z),
      rotation: 0,
    });
  };
  cell(headerX, headW / 2, rowH / 2);
  cell(headerY, headW / 2, rowH * 1.5);
  xs.forEach((x, k) => {
    cell(xLabels[k], headW + colW * k + colW / 2, rowH / 2);
    cell(yLabels[k], headW + colW * k + colW / 2, rowH * 1.5);
  });
  return { strokes, texts, images: [], count: n };
}

// ---------- for the board ----------

// The graph's settings without a read-off in progress (which is only ever
// shown live, never saved).
export function withoutTrace(config) {
  if (!config || !config.plot || !("trace" in config.plot)) return config;
  const plot = { ...config.plot };
  delete plot.trace;
  return { ...config, plot };
}

// A tiny store the board's overlays (sliders, the read-off bar) read the
// graphs from, so they update whenever the board redraws them.
//   { graphs: [graph, …], trace: { graphId, fnId, x, tangent?, pinId? } | null }
export function createGraphStore() {
  let state = { graphs: [], trace: null };
  const subs = new Set();
  return {
    get: () => state,
    set(graphs, trace) {
      if (graphs === state.graphs && trace === state.trace) return;
      state = { graphs, trace };
      subs.forEach((f) => f());
    },
    subscribe(f) {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
}

// The letters that have sliders and are used by an equation on show.
export function sliderParams(config) {
  const plot = plotOf(config);
  if (!plot || !plot.params) return [];
  // (a number line has no sliders)
  if (axesOf(config).paper === "numberline") return [];
  const used = new Set();
  const degrees = usesDegrees(config);
  for (const fn of plot.fns || []) {
    if (!fn || fn.hidden) continue;
    const r = readEquation(fn.latex, { degrees });
    if (r.ok) for (const n of r.params) used.add(n);
  }
  return Object.keys(plot.params).filter((n) => used.has(n)).sort();
}
