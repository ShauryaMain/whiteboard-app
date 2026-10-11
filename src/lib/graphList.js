// A board can have several graphs. They are all kept in the board's one
// graph setting (`boards.grid_config`, sent live as `grid-set`):
//
//   null                                   no graphs
//   { ...first graph, more: [graph, …] }   the first graph as before, with
//                                          any others in `more`
//
// so a page still running an older version of the app shows the first
// graph exactly as it always did. Each graph has an `id` (an older graph
// saved without one is given a fixed one, so it is the same every time).
//
// Pure functions only (no React, no Supabase).

import { axesOf, linesOf } from "./graphAxes";

export const FIRST_GRAPH_ID = "graph-first";
// the most graphs one board can have
export const MAX_GRAPHS = 12;

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v) => typeof v === "number" && Number.isFinite(v);

function usable(g) {
  return isObj(g) && finite(g.x) && finite(g.y) && finite(g.size) && g.size > 0 && finite(g.cols) && g.cols > 0;
}

const listCache = new WeakMap();

// Every graph in a saved / received graph setting, in drawing order.
export function graphsOf(grid) {
  if (!isObj(grid)) return [];
  const hit = listCache.get(grid);
  if (hit) return hit;
  const { more, ...first } = grid;
  const out = [];
  const seen = new Set();
  const add = (g, fallbackId) => {
    if (!usable(g)) return;
    let id = typeof g.id === "string" && g.id ? g.id : fallbackId;
    if (seen.has(id)) id = `${id}-${out.length}`;
    seen.add(id);
    const clean = { ...g, id };
    delete clean.more;
    out.push(clean);
  };
  add(first, FIRST_GRAPH_ID);
  if (Array.isArray(more)) more.slice(0, MAX_GRAPHS - 1).forEach((g, i) => add(g, `graph-${i + 2}`));
  listCache.set(grid, out);
  return out;
}

// The setting that is saved and sent for a list of graphs.
export function packGraphs(list) {
  const graphs = (list || []).filter(usable);
  if (!graphs.length) return null;
  const [first, ...rest] = graphs;
  const packed = { ...first };
  delete packed.more;
  if (rest.length) packed.more = rest.map((g) => {
    const c = { ...g };
    delete c.more;
    return c;
  });
  return packed;
}

// The box a graph takes up on the board (without its numbers and names).
export function graphBox(g) {
  const A = axesOf(g);
  const cell = g.size / g.cols;
  const rows = A.paper === "polar" ? A.cols : A.rows;
  return { minX: g.x, minY: g.y, maxX: g.x + g.size, maxY: g.y + cell * rows };
}

// The part of the board a graph takes up, with a little room round its
// box for what's drawn outside it (numbers along an edge, names, a title,
// a number line's marks), for fitting a picture of the board round
// everything on it.
export function graphOuterBounds(g) {
  if (!usable(g)) return null;
  const A = axesOf(g);
  const cell = g.size / g.cols;
  const box = graphBox(g);
  if (![box.minX, box.minY, box.maxX, box.maxY].every(finite)) return null;
  const outside = A.paper === "polar" ? cell * 0.7 : A.x.name || A.y.name || A.title ? cell * 1.1 : cell * 0.6;
  const above = A.paper === "numberline" ? cell * 1.5 : A.title ? cell * 0.9 : outside * 0.5;
  return { minX: box.minX - outside, minY: box.minY - above, maxX: box.maxX + outside * 0.5, maxY: box.maxY + outside };
}

// Round every graph in a graph setting (old or new), or null.
export function graphBounds(grid) {
  let out = null;
  for (const g of graphsOf(grid)) {
    const b = graphOuterBounds(g);
    if (!b) continue;
    if (!out) out = { ...b };
    else {
      out.minX = Math.min(out.minX, b.minX);
      out.minY = Math.min(out.minY, b.minY);
      out.maxX = Math.max(out.maxX, b.maxX);
      out.maxY = Math.max(out.maxY, b.maxY);
    }
  }
  return out;
}

// The topmost graph whose box is under a point (pad: board units of slack).
export function graphAt(list, p, pad = 0) {
  for (let i = list.length - 1; i >= 0; i--) {
    const b = graphBox(list[i]);
    if (p.x >= b.minX - pad && p.x <= b.maxX + pad && p.y >= b.minY - pad && p.y <= b.maxY + pad) return list[i];
  }
  return null;
}

export function translateGraph(g, dx, dy) {
  return { ...g, x: g.x + dx, y: g.y + dy };
}

// A graph made bigger or smaller from its top left corner (its squares
// grow; what's on it stays the same). Never smaller than `minSize`.
export function resizeGraph(g, size, minSize = 1) {
  return { ...g, size: Math.max(minSize, size) };
}

// Where a new graph of this size goes: in the middle of the view, unless
// that is on top of a graph already there, in which case beside it (to the
// right, else below), so two graphs end up side by side.
export function placeGraph(list, w, h, center, gap) {
  const overlaps = (x, y) =>
    list.some((g) => {
      const b = graphBox(g);
      return x < b.maxX + gap && x + w > b.minX - gap && y < b.maxY + gap && y + h > b.minY - gap;
    });
  const x0 = center.x - w / 2, y0 = center.y - h / 2;
  if (!overlaps(x0, y0)) return { x: x0, y: y0 };
  // beside the last graph
  const last = graphBox(list[list.length - 1]);
  const tries = [
    { x: last.maxX + gap * 2.5, y: last.minY },
    { x: last.minX, y: last.maxY + gap * 2.5 },
    { x: last.minX - w - gap * 2.5, y: last.minY },
    { x: last.minX, y: last.minY - h - gap * 2.5 },
  ];
  for (const t of tries) if (!overlaps(t.x, t.y)) return t;
  return { x: last.maxX + gap * 2.5, y: last.minY };
}

// ---------- snapping to the grid ----------

function nearest(values, v) {
  let best = null;
  for (const c of values) if (best === null || Math.abs(c - v) < Math.abs(best - v)) best = c;
  return best;
}

// The grid crossing nearest to a point on the board, on a graph whose box
// it is in (or a tick on a number line, a point of an isometric grid).
// `frame` is the graph's gridFrame. null when there is nothing to snap to.
export function snapPoint(g, frame, p) {
  const { box } = frame;
  const slack = (box.x1 - box.x0) * 0.01;
  if (p.x < box.x0 - slack || p.x > box.x1 + slack || p.y < box.y0 - slack || p.y > box.y1 + slack) return null;
  const A = frame.A;
  if (A.paper === "polar") return null;
  if (A.paper === "isometric") {
    const s = frame.cell, h = (s * Math.sqrt(3)) / 2;
    const i = Math.round((p.x - box.x0) / h);
    const off = i % 2 ? s / 2 : 0;
    const j = Math.round((p.y - box.y0 - off) / s);
    return { x: box.x0 + i * h, y: box.y0 + j * s + off };
  }
  const xs = linesOf(A.x, A.minor);
  const xVals = [...xs.main, ...xs.small];
  if (!xVals.length) return null;
  const toPx = (v) => frame.ox + frame.fx(v) * frame.sx;
  const xPx = xVals.map(toPx);
  const sx = nearest(xPx, p.x);
  if (A.paper === "numberline") return { x: sx, y: frame.lineY };
  const ys = linesOf(A.y, A.minor);
  const yPx = [...ys.main, ...ys.small].map((v) => frame.oy - frame.fy(v) * frame.sy);
  if (!yPx.length) return null;
  return { x: sx, y: nearest(yPx, p.y) };
}

// The spacing of the crossings a graph snaps to, in board units (the
// smallest square), for deciding what counts as "a dot".
export function snapSpacing(g, frame) {
  const A = frame.A;
  if (A.paper === "isometric") return frame.cell;
  if (A.paper === "log") return frame.cell / 3;
  return frame.cell / (A.minor > 1 ? A.minor : 1);
}
