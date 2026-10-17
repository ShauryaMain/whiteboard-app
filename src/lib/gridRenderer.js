// Shared, pure grid/graph-paper rendering logic used by BOTH the live
// whiteboard canvas (Whiteboard.js, via drawGrid) and the "ultimate grid
// tool" customization dialog's live preview (GridToolModal.js). Keeping
// this in one place guarantees the dialog's preview looks exactly like
// what actually gets placed on the board — there's only one implementation
// to keep in sync.
//
// A grid config (persisted per-board as `grid_config`, broadcast over the
// `grid-set` realtime event) looks like:
//   {
//     type: "cartesian" | "polar",
//     x, y, size, cols,        // world-space square bounding box + division count (unchanged from the original simple grid, so move/resize keeps working)
//     unitsPerCell: number,     // value each division represents (radius-per-ring for polar)
//     unitLabel: string,        // suffix shown after plain numbers, e.g. "cm", "units" (ignored for trig-labeled axes)
//     trig: boolean,            // cartesian: label axes as fractions of pi (using trigStep) instead of plain numbers.
//                                // polar: label spokes in radians (fractions of pi) instead of degrees.
//     trigStep: {num, den},     // cartesian+trig only: each cell = (num/den) * pi
//     showAxes: boolean,
//     showNumbers: boolean,
//     showUnitCircle: boolean,  // draws one highlighted ring/circle at radius = unitsPerCell
//     spokeCount: number,       // polar only: angular divisions
//     color: string,            // grid line color
//   }
//
// A config with no `type` (every grid created before this feature existed)
// is treated as a legacy plain grid — same look as before, no axis numbers.
//
// Newer graphs also have a paper type (number line, dotted, isometric,
// log), a range and scale per axis, axis names, a title and more: see
// graphAxes.js, which works out the axes for old and new graphs alike.
// The box is always `cols` squares wide and `rows` high (cell size
// `size / cols`, kept constant by the caller — see Whiteboard.js's
// handleApplyGridConfig).

import { drawPlots } from "./graphPlot";
import { gridFrame, linesOf, tickText, unitCircleAngles, exactCosSin, angleText } from "./graphAxes";
import { drawChart, chartPaperOptions } from "./graphCharts";
import { setGraphDark, graphText, graphAxis, graphName, graphHalo, graphLines } from "./graphInk";

// Real-world physical scale used across the app (rulers, compass, and now
// the grid tool) so "1cm" means the same thing everywhere.
export const WORLD_UNITS_PER_CM = 96 / 2.54;

export function withDefaults(config) {
  if (!config) return config;
  if (config.type) return config;
  return {
    ...config,
    type: "cartesian",
    unitsPerCell: 1,
    unitLabel: "",
    trig: false,
    trigStep: { num: 1, den: 2 },
    showAxes: true,
    showNumbers: false,
    showUnitCircle: false,
    spokeCount: 12,
    color: "#cfd8e3",
  };
}

function gcd(a, b) {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

// n: integer cell index measured from the origin. step: {num, den} meaning
// one cell = (num/den) * pi.
export function formatPiFraction(n, step) {
  let num = n * (step?.num ?? 1);
  const den = step?.den ?? 1;
  if (num === 0) return "0";
  const sign = num < 0 ? "-" : "";
  num = Math.abs(num);
  const g = gcd(num, den);
  const reducedNum = num / g;
  const reducedDen = den / g;
  const numPart = reducedNum === 1 ? "π" : `${reducedNum}π`;
  return reducedDen === 1 ? `${sign}${numPart}` : `${sign}${numPart}/${reducedDen}`;
}

export function formatPlainValue(value, unitLabel) {
  if (Math.abs(value) < 1e-9) return "0";
  const rounded = Math.round(value * 1000) / 1000;
  return `${rounded}${unitLabel || ""}`;
}

function drawLine(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

const FONT = "-apple-system, BlinkMacSystemFont, sans-serif";

// The darker version of a grid colour, for dots (the default light blue-grey
// is too faint as dots).
function dotColor(color) {
  return !color || color === "#cfd8e3" ? "#90a4ae" : color;
}

// How many lines apart the numbers go, so they don't crowd: every line,
// every 2nd, 5th, 10th...
function chooseEvery(spacingScreenPx, needPx, fixed) {
  if (fixed !== "auto") return fixed;
  for (const e of [1, 2, 5, 10, 20, 50, 100, 200, 500]) if (spacingScreenPx * e >= needPx) return e;
  return 1000;
}

function arrowHead(ctx, x, y, dx, dy, ls) {
  const len = 11 * ls, half = 5 * ls;
  ctx.beginPath();
  ctx.moveTo(x + dx * 2 * ls, y + dy * 2 * ls);
  ctx.lineTo(x - dx * len - dy * half, y - dy * len + dx * half);
  ctx.lineTo(x - dx * len + dy * half, y - dy * len - dx * half);
  ctx.closePath();
  ctx.fill();
}

function haloText(ctx, text, x, y, ls) {
  ctx.lineJoin = "round";
  ctx.lineWidth = 3.5 * ls;
  ctx.strokeStyle = graphHalo();
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

// The numbers along one axis: [{ v, text }], already thinned out so they
// fit (`along` is "x" or "y").
function axisNumbers(ctx, axis, lines, f, A, along) {
  const ls = f.lineScale;
  const out = [];
  if (axis.log) {
    // the decades; 2 and 5 too when a decade is wide enough
    const perDecadePx = (along === "x" ? f.sx : f.sy) / ls;
    const extra = perDecadePx >= (along === "x" ? 150 : 100);
    for (const v of lines.main) out.push({ v, text: tickText(v, axis) });
    if (extra) for (const v of lines.small) {
      const m = Math.round(v / Math.pow(10, Math.floor(Math.log10(v) + 1e-9)));
      if (m === 2 || m === 5) out.push({ v, text: tickText(v, axis) });
    }
    return out;
  }
  const spacing = (axis.step * (along === "x" ? f.sx : f.sy)) / ls;
  let need;
  if (along === "x") {
    let w = 0;
    for (let n = 0; n < lines.main.length; n += Math.max(1, Math.floor(lines.main.length / 12))) {
      w = Math.max(w, ctx.measureText(tickText(lines.main[n], axis, A.unit)).width / ls);
    }
    need = w + 12;
  } else {
    need = 15 * 1.6;
  }
  const every = chooseEvery(spacing, need, A.every);
  lines.main.forEach((v, n) => {
    const k = lines.mainIndex[n];
    if (k % every !== 0) return;
    out.push({ v, text: tickText(v, axis, A.unit) });
  });
  return out;
}

// Graph paper: squares (or dots), axes, numbers, names (and log paper,
// which is the same with a log scale along one or both axes).
//   opts (charts): { xLines, yLines, xNumbers, yNumbers, minor } — false to leave out
function renderCartesianGrid(ctx, config, f, opts = {}) {
  const { A, box, lineScale: ls } = f;
  const { x0, y0, x1, y1 } = box;
  const color = graphLines(config.color);
  const minor = opts.minor === false ? 0 : A.minor;
  const X = opts.xLines === false ? { main: [], mainIndex: [], small: [] } : linesOf(A.x, minor);
  const Y = opts.yLines === false ? { main: [], mainIndex: [], small: [] } : linesOf(A.y, minor);
  // the numbers still go on every main line
  const XN = opts.xNumbers === false ? { main: [], mainIndex: [], small: [] } : opts.xLines === false ? linesOf(A.x, 0) : X;
  const YN = opts.yNumbers === false ? { main: [], mainIndex: [], small: [] } : opts.yLines === false ? linesOf(A.y, 0) : Y;
  const px = (v) => f.ox + f.fx(v) * f.sx;
  const py = (v) => f.oy - f.fy(v) * f.sy;

  ctx.save();
  if (A.paper === "dots" && X.main.length * Y.main.length <= 40000) {
    ctx.fillStyle = dotColor(color);
    ctx.beginPath();
    const r = 1.9 * ls;
    for (const xv of X.main) {
      const gx = px(xv);
      for (const yv of Y.main) {
        const gy = py(yv);
        ctx.moveTo(gx + r, gy);
        ctx.arc(gx, gy, r, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  } else if (A.paper !== "dots") {
    // the small squares, then the main lines and the edge of the box
    if (X.small.length || Y.small.length) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 0.75 * ls;
      ctx.beginPath();
      for (const v of X.small) {
        ctx.moveTo(px(v), y0);
        ctx.lineTo(px(v), y1);
      }
      for (const v of Y.small) {
        ctx.moveTo(x0, py(v));
        ctx.lineTo(x1, py(v));
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 * ls;
    ctx.beginPath();
    for (const v of X.main) {
      ctx.moveTo(px(v), y0);
      ctx.lineTo(px(v), y1);
    }
    for (const v of Y.main) {
      ctx.moveTo(x0, py(v));
      ctx.lineTo(x1, py(v));
    }
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.stroke();
  }
  ctx.restore();

  const ax = f.axisX, ay = f.axisY;
  const near = (a, b) => Math.abs(a - b) < 0.5 * ls;
  if (config.showAxes) {
    ctx.save();
    ctx.strokeStyle = graphAxis();
    ctx.fillStyle = graphAxis();
    ctx.lineWidth = 1.5 * ls;
    ctx.beginPath();
    ctx.moveTo(ax, y0);
    ctx.lineTo(ax, y1);
    ctx.moveTo(x0, ay);
    ctx.lineTo(x1, ay);
    ctx.stroke();
    if (A.arrows) {
      // at each end, except the end where the other axis starts
      arrowHead(ctx, x1, ay, 1, 0, ls);
      if (!near(ax, x0)) arrowHead(ctx, x0, ay, -1, 0, ls);
      arrowHead(ctx, ax, y0, 0, -1, ls);
      if (!near(ay, y1)) arrowHead(ctx, ax, y1, 0, 1, ls);
    }
    ctx.restore();
  }

  drawUnitCircle(ctx, config, f);

  let yNumbersWidth = 0;
  let xNumbersBelow = false;
  if (config.showNumbers) {
    ctx.save();
    ctx.fillStyle = graphAxis();
    ctx.font = `${15 * ls}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const { v, text } of axisNumbers(ctx, A.x, XN, f, A, "x")) {
      if (f.crossAtOrigin && v === 0) continue;
      ctx.fillText(text, px(v), ay + 4 * ls);
    }
    xNumbersBelow = true;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const { v, text } of axisNumbers(ctx, A.y, YN, f, A, "y")) {
      if (f.crossAtOrigin && v === 0) continue;
      yNumbersWidth = Math.max(yNumbersWidth, ctx.measureText(text).width);
      ctx.fillText(text, ax - 6 * ls, py(v));
    }
    // one 0 where the axes meet, when that's a corner or an edge
    if (f.crossAtOrigin && (near(ax, x0) || near(ay, y1))) {
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText("0", ax - 5 * ls, ay + 4 * ls);
    }
    ctx.restore();
  }

  // the axes' names: under / beside the numbers when the axis runs along
  // the edge of the box, otherwise just past the end of the axis (outside
  // the box, so they never sit on top of what's plotted)
  ctx.save();
  ctx.fillStyle = graphName();
  ctx.font = `700 ${15 * ls}px ${FONT}`;
  if (A.x.name) {
    if (near(ay, y1)) {
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(A.x.name, (x0 + x1) / 2, y1 + (xNumbersBelow ? 26 : 8) * ls);
    } else {
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(A.x.name, x1 + (A.arrows && config.showAxes ? 10 : 7) * ls, ay);
    }
  }
  if (A.y.name) {
    if (near(ax, x0)) {
      ctx.save();
      ctx.translate(x0 - yNumbersWidth - 14 * ls, (y0 + y1) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(A.y.name, 0, 0);
      ctx.restore();
    } else {
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(A.y.name, ax, y0 - (A.arrows && config.showAxes ? 9 : 6) * ls);
    }
  }
  ctx.restore();
}

// A number line: one line with ticks and numbers (what's marked on it is
// drawn by graphPlot.js).
function renderNumberLine(ctx, config, f) {
  const { A, box, lineScale: ls, lineY } = f;
  const X = linesOf(A.x, A.minor);
  const px = (v) => f.ox + v * f.sx;
  ctx.save();
  ctx.strokeStyle = graphName();
  ctx.fillStyle = graphName();
  ctx.lineWidth = 2 * ls;
  ctx.beginPath();
  ctx.moveTo(box.x0, lineY);
  ctx.lineTo(box.x1, lineY);
  for (const v of X.main) {
    ctx.moveTo(px(v), lineY - 8 * ls);
    ctx.lineTo(px(v), lineY + 8 * ls);
  }
  ctx.stroke();
  if (X.small.length) {
    ctx.lineWidth = 1.2 * ls;
    ctx.beginPath();
    for (const v of X.small) {
      ctx.moveTo(px(v), lineY - 4 * ls);
      ctx.lineTo(px(v), lineY + 4 * ls);
    }
    ctx.stroke();
  }
  if (A.arrows) {
    arrowHead(ctx, box.x1, lineY, 1, 0, ls);
    arrowHead(ctx, box.x0, lineY, -1, 0, ls);
  }
  if (config.showNumbers !== false) {
    ctx.font = `${16 * ls}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const { v, text } of axisNumbers(ctx, A.x, X, f, A, "x")) ctx.fillText(text, px(v), lineY + 12 * ls);
  }
  if (A.x.name) {
    ctx.font = `700 ${15 * ls}px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(A.x.name, box.x1 + 16 * ls, lineY);
  }
  ctx.restore();
}

// Isometric paper: a triangle grid (lines or dots), for drawing 3D shapes.
function renderIsometric(ctx, config, f) {
  const { A, box, lineScale: ls, cell } = f;
  const { x0, y0, x1, y1 } = box;
  const s = cell; // the side of a triangle
  const h = (s * Math.sqrt(3)) / 2; // between two columns of points
  const W = x1 - x0, H = y1 - y0;
  const color = graphLines(config.color);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, W, H);
  ctx.clip();
  const cols = Math.ceil(W / h);
  if (A.style === "dots") {
    ctx.fillStyle = dotColor(color);
    ctx.beginPath();
    const r = 1.9 * ls;
    for (let i = 0; i <= cols; i++) {
      const gx = x0 + i * h;
      for (let j = -1; j * s <= H + s; j++) {
        const gy = y0 + j * s + (i % 2 ? s / 2 : 0);
        ctx.moveTo(gx + r, gy);
        ctx.arc(gx, gy, r, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 * ls;
    ctx.beginPath();
    for (let i = 0; i <= cols; i++) {
      ctx.moveTo(x0 + i * h, y0);
      ctx.lineTo(x0 + i * h, y1);
    }
    // the two slanting families, 30° either side of horizontal
    const t = 1 / Math.sqrt(3);
    const kMax = Math.ceil((H + W * t) / s) + 1;
    for (let k = -kMax; k <= kMax; k++) {
      ctx.moveTo(x0, y0 + k * s);
      ctx.lineTo(x1, y0 + k * s + W * t);
      ctx.moveTo(x0, y0 + k * s);
      ctx.lineTo(x1, y0 + k * s - W * t);
    }
    ctx.stroke();
  }
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1 * ls;
  ctx.strokeRect(x0, y0, W, H);
  ctx.restore();
}

// The unit circle, and (if chosen) the standard angles round it with
// their cos and sin.
function drawUnitCircle(ctx, config, f) {
  if (!config.showUnitCircle) return;
  const { A, lineScale: ls, box } = f;
  // radius 1 means nothing on a log scale or along degrees
  if (f.logX || f.logY || A.x.label === "deg" || A.y.label === "deg") return;
  // the angles and their (cos, sin) only where both axes are ordinary numbers
  const marks = f.polar || (A.x.label === "number" && A.y.label === "number");
  const [cx, cy] = f.toWorld(0, 0);
  const rx = f.sx, ry = f.sy;
  if (![cx, cy, rx, ry].every(Number.isFinite)) return;
  ctx.save();
  // (only the part inside the graph: with the origin in a corner, that's a
  // quarter of it, and a graph far from 0 shows none)
  ctx.beginPath();
  ctx.rect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
  ctx.clip();
  ctx.strokeStyle = "#E53935";
  ctx.lineWidth = 1.5 * ls;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  const angles = marks ? unitCircleAngles(A.unitCircle.angles) : [];
  if (angles.length) {
    const rScreen = Math.min(rx, ry) / ls;
    const pts = angles.map((d) => {
      const t = (d * Math.PI) / 180;
      return { d, c: Math.cos(t), s: Math.sin(t) };
    });
    ctx.strokeStyle = "rgba(229,57,53,0.35)";
    ctx.lineWidth = 1 * ls;
    ctx.beginPath();
    for (const p of pts) {
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + p.c * rx, cy - p.s * ry);
    }
    ctx.stroke();
    ctx.fillStyle = "#E53935";
    ctx.beginPath();
    for (const p of pts) {
      ctx.moveTo(cx + p.c * rx + 3.5 * ls, cy - p.s * ry);
      ctx.arc(cx + p.c * rx, cy - p.s * ry, 3.5 * ls, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.font = `600 ${12 * ls}px ${FONT}`;
    if (rScreen >= 60) {
      // the angle, inside the circle
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#C62828";
      for (const p of pts) haloText(ctx, angleText(p.d, A.unitCircle.units), cx + p.c * rx * 0.74, cy - p.s * ry * 0.74, ls);
    }
    if (A.unitCircle.values && rScreen >= 90) {
      // (cos, sin), just outside
      ctx.fillStyle = graphText();
      for (const p of pts) {
        const [ct, st] = exactCosSin(p.d);
        ctx.textAlign = p.c > 0.1 ? "left" : p.c < -0.1 ? "right" : "center";
        ctx.textBaseline = p.s > 0.1 ? "bottom" : p.s < -0.1 ? "top" : "middle";
        haloText(ctx, `(${ct}, ${st})`, cx + p.c * rx + p.c * 9 * ls, cy - p.s * ry - p.s * 9 * ls, ls);
      }
    }
  }
  ctx.restore();
}

function drawTitle(ctx, f) {
  const { A, box, lineScale: ls } = f;
  if (!A.title) return;
  ctx.save();
  ctx.fillStyle = graphText();
  ctx.font = `700 ${18 * ls}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  // polar paper has its angle numbers round the outside
  // (above the y-axis' name when that's written over the top of the box)
  const nameAbove = !f.polar && !f.numberLine && A.paper !== "isometric" && A.y.name && Math.abs(f.axisX - box.x0) >= 0.5 * ls;
  ctx.fillText(A.title, (box.x0 + box.x1) / 2, box.y0 - (f.polar ? 30 : nameAbove ? 30 : 10) * ls);
  ctx.restore();
}

function renderPolarGrid(ctx, config, geom, frame) {
  const { cellPx, originXPx, originYPx, lineScale = 1 } = geom;
  const cols = config.cols;
  const size = cellPx * cols;
  const cx = originXPx + size / 2;
  const cy = originYPx + size / 2;
  const maxRadius = size / 2;
  const spokeCount = Math.max(1, config.spokeCount || 12);

  ctx.save();
  ctx.strokeStyle = graphLines(config.color);
  ctx.lineWidth = 1 * lineScale;
  for (let i = 1; i <= cols; i++) {
    const r = (i / cols) * maxRadius;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let s = 0; s < spokeCount; s++) {
    const angle = (s / spokeCount) * Math.PI * 2;
    drawLine(ctx, cx, cy, cx + Math.cos(angle) * maxRadius, cy + Math.sin(angle) * maxRadius);
  }
  ctx.restore();

  if (config.showAxes) {
    ctx.save();
    ctx.strokeStyle = graphAxis();
    ctx.lineWidth = 1.5 * lineScale;
    drawLine(ctx, cx - maxRadius, cy, cx + maxRadius, cy);
    drawLine(ctx, cx, cy - maxRadius, cx, cy + maxRadius);
    ctx.restore();
  }

  // radius 1: a ring is worth unitsPerCell
  drawUnitCircle(ctx, config, frame);

  if (config.showNumbers) {
    ctx.save();
    ctx.fillStyle = graphAxis();
    // Same constant on-screen size treatment as the cartesian labels above.
    const fontPx = 15 * lineScale;
    ctx.font = `${fontPx}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    for (let i = 1; i <= cols; i++) {
      const r = (i / cols) * maxRadius;
      const label = formatPlainValue(i * config.unitsPerCell, config.unitLabel);
      ctx.fillText(label, cx + 3, cy - r + fontPx);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let s = 0; s < spokeCount; s++) {
      const angle = (s / spokeCount) * Math.PI * 2;
      const label = config.trig
        ? formatPiFraction(s, { num: 2, den: spokeCount })
        : `${Math.round((s / spokeCount) * 360)}°`;
      // anticlockwise from the right, as angles are measured in maths
      // (the board's y runs downwards)
      const lx = cx + Math.cos(angle) * (maxRadius + 14 * lineScale);
      const ly = cy - Math.sin(angle) * (maxRadius + 14 * lineScale);
      ctx.fillText(label, lx, ly);
    }
    ctx.restore();
  }
}

export function renderGrid(ctx, rawConfig, geom) {
  const config = withDefaults(rawConfig);
  if (!config) return;
  // geom.dark: the page is dark (lighter labels and lines)
  const was = setGraphDark(geom && geom.dark);
  try {
    renderGridInner(ctx, config, geom);
  } finally {
    setGraphDark(was);
  }
}

function renderGridInner(ctx, config, geom) {
  const f = gridFrame(config, geom);
  if (f.paper === "polar") renderPolarGrid(ctx, config, geom, f);
  else if (f.paper === "numberline") renderNumberLine(ctx, config, f);
  else if (f.paper === "isometric") renderIsometric(ctx, config, f);
  else if (f.paper === "chart") {
    renderCartesianGrid(ctx, config, f, chartPaperOptions(config.chart));
    try {
      drawChart(ctx, config, f);
    } catch (err) {
      // a chart that can't be drawn leaves the paper
    }
  } else renderCartesianGrid(ctx, config, f);
  // What has been plotted on it (graphPlot.js). A plot that can't be drawn
  // never stops the graph paper itself being drawn.
  if (config.plot && f.paper !== "isometric" && f.paper !== "chart") {
    try {
      drawPlots(ctx, config, geom);
    } catch (err) {
      // leave it out
    }
  }
  drawTitle(ctx, f);
}
