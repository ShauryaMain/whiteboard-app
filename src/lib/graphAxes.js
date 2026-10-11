// The graph's paper and axes: what kind of paper it is, the range and
// scale along each axis, and where on the board each value sits. Used by
// the drawing of the paper (gridRenderer.js), by everything plotted on it
// (graphPlot.js) and by the graph dialog, so they always agree.
//
// Saved in the graph's settings (grid_config), next to the older fields:
//   type: "cartesian" | "polar" | "numberline" | "dots" | "isometric" | "log" | "chart"
//   chart: { kind, …data }  (a statistics chart: see graphCharts.js)
//   snap: boolean                    ruler lines and dots snap to its grid
//   axes: {
//     x: { min, max, step, label: "number" | "pi" | "deg", piStep: { num, den },
//          log, perDecade, name },
//     y: { …the same; label "number" | "pi" },
//   }
//   minor: 0 | 2 | 4 | 5 | 10        small squares across each main square
//   numbersEvery: "auto" | 1 | 2 | 5 | 10
//   arrows: boolean                  arrowheads on the axes
//   title: string
//   style: "lines" | "dots"          isometric paper drawn with lines or dots
//   unitCircle: { angles: "none" | "all" | "30" | "45" | "90", values, units: "deg" | "rad" }
//
// A graph saved before `axes` existed has its origin in the middle and the
// same scale both ways (unitsPerCell, or trig/trigStep for π); that is
// worked out here, so it looks just as it did.
//
import { chartAxes, histogramClasses, usesDensity, sampleChart } from "./graphCharts";

// One main square is one `step` along each axis. The squares stay square
// on the board, so a graph whose axes have different steps (x in 1s, y in
// 5s) is as many squares wide and high as its ranges need; `cols` and
// `rows` are kept equal to that (and may be fractional, when a range isn't
// a whole number of steps), so everything that only knows the box (moving,
// resizing, thumbnails) keeps working.

export const PAPERS = ["cartesian", "polar", "numberline", "dots", "isometric", "log", "chart"];
const PAPER_SET = new Set(PAPERS);

// the most squares along one side the dialog lets you make
export const MAX_CELLS = 120;
// a number line is this many squares high
export const NUMBER_LINE_ROWS = 3;

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const num = (v, fallback) => (finite(v) ? v : fallback);

export function piStepValue(ps) {
  const n = ps && ps.num > 0 ? ps.num : 1;
  const d = ps && ps.den > 0 ? ps.den : 1;
  return (Math.PI * n) / d;
}

function legacyAxis(config, cells) {
  const trig = !!config.trig;
  const piStep = isObj(config.trigStep) ? { num: config.trigStep.num || 1, den: config.trigStep.den || 1 } : { num: 1, den: 2 };
  const per = trig ? piStepValue(piStep) : finite(config.unitsPerCell) && config.unitsPerCell > 0 ? config.unitsPerCell : 1;
  // An odd number of squares put the old graph's lines on the half values
  // (−3.5, −2.5…): those stay where they were, counted from the edge.
  const anchor = Math.abs(cells / 2 - Math.round(cells / 2)) > 1e-9 ? "edge" : "zero";
  return { min: (-cells / 2) * per, max: (cells / 2) * per, step: per, label: trig ? "pi" : "number", piStep, log: false, perDecade: 3, name: "", anchor };
}

function cleanAxis(a, fallback, paper) {
  if (!isObj(a)) return fallback;
  let label = a.label === "pi" || a.label === "deg" ? a.label : "number";
  const log = paper === "log" && !!a.log && label === "number";
  const piStep = isObj(a.piStep) && a.piStep.num > 0 && a.piStep.den > 0 ? { num: a.piStep.num, den: a.piStep.den } : { num: 1, den: 2 };
  let min = num(a.min, fallback.min);
  let max = num(a.max, fallback.max);
  if (log) {
    if (!(min > 0)) min = 1;
    if (!(max > min)) max = min * 1000;
  } else if (!(max > min) || !finite(max - min)) {
    min = fallback.min;
    max = fallback.max;
  }
  if (log && !(Math.log10(max / min) <= 40)) {
    min = 1;
    max = 1000;
  }
  let step = label === "pi" ? piStepValue(piStep) : num(a.step, fallback.step);
  if (!(step > 0)) step = fallback.step > 0 ? fallback.step : 1;
  // never thousands of lines, whatever was saved (and never steps too small
  // for the numbers they're added to: 10¹⁶ + 2 is 10¹⁶ to a computer)
  if (!log && ((max - min) / step > MAX_CELLS * 4 || Math.max(Math.abs(min), Math.abs(max)) / step > 1e9)) {
    step = (max - min) / Math.min(MAX_CELLS * 4, 10);
    if (Math.max(Math.abs(min), Math.abs(max)) / step > 1e9) {
      min = fallback.min;
      max = fallback.max;
      step = fallback.step;
    }
    if (label === "pi") label = "number";
  }
  const perDecade = Math.max(1, Math.min(12, Math.round(num(a.perDecade, 3))));
  const name = typeof a.name === "string" ? a.name.slice(0, 60) : "";
  const anchor = a.anchor === "edge" ? "edge" : "zero";
  return { min, max, step, label, piStep, log, perDecade, name, anchor };
}

// How many squares an axis takes up.
export function cellsAlong(axis) {
  if (axis.log) return Math.log10(axis.max / axis.min) * axis.perDecade;
  return (axis.max - axis.min) / axis.step;
}

const axesCache = new WeakMap();

// Everything about the paper and its axes, from a saved graph (old or new).
export function axesOf(config) {
  if (!isObj(config)) return axesOfUncached({});
  const hit = axesCache.get(config);
  if (hit) return hit;
  const out = axesOfUncached(config);
  axesCache.set(config, out);
  return out;
}

function axesOfUncached(config) {
  const paper = PAPER_SET.has(config.type) ? config.type : "cartesian";
  const cols = finite(config.cols) && config.cols > 0 && config.cols <= 2000 ? config.cols : 10;
  const rows = paper === "polar" ? cols : finite(config.rows) && config.rows > 0 && config.rows <= 2000 ? config.rows : cols;
  // (polar and isometric paper have no ranges: any left over from another
  // paper are ignored)
  const ax = isObj(config.axes) && paper !== "polar" && paper !== "isometric" ? config.axes : {};
  const x = cleanAxis(ax.x, legacyAxis(config, cols), paper);
  const y = paper === "numberline" ? { ...legacyAxis({}, rows), name: "" } : cleanAxis(ax.y, legacyAxis(config, rows), paper);
  // a chart's frequency axis is named for it, unless named by hand
  if (paper === "chart" && !y.name && isObj(config.chart)) {
    if (config.chart.kind === "histogram") y.name = usesDensity(config.chart, histogramClasses(config.chart)) ? "Frequency density" : "Frequency";
    else if (config.chart.kind === "bar") y.name = "Frequency";
    // (not saved as the axis' own name, so it follows the data)
    if (y.name) y.autoName = true;
  }
  const uc = isObj(config.unitCircle) ? config.unitCircle : null;
  return {
    paper,
    cols,
    rows,
    x,
    y,
    minor: [2, 4, 5, 10].includes(config.minor) ? config.minor : 0,
    every: [1, 2, 5, 10].includes(config.numbersEvery) ? config.numbersEvery : "auto",
    arrows: !!config.arrows,
    title: typeof config.title === "string" ? config.title.slice(0, 80) : "",
    unit: typeof config.unitLabel === "string" ? config.unitLabel : "",
    style: config.style === "dots" ? "dots" : "lines",
    unitCircle: {
      // a graph from before this setting showed just the circle
      angles: uc && ["all", "30", "45", "90"].includes(uc.angles) ? uc.angles : "none",
      values: !!(uc && uc.values !== false),
      units: uc && uc.units === "rad" ? "rad" : "deg",
    },
  };
}

// The box's size in squares for some axes (what `cols` and `rows` are set
// to when the graph is saved).
export function boxCells(paper, axes, fallback = {}) {
  if (paper === "polar" || paper === "isometric") {
    const cols = fallback.cols || 10;
    return { cols, rows: paper === "polar" ? cols : fallback.rows || cols };
  }
  // (rounded off: 5.999999999 squares is 6)
  const tidy = (v) => Number(v.toFixed(9));
  const cols = tidy(cellsAlong(axes.x));
  const rows = paper === "numberline" ? NUMBER_LINE_ROWS : tidy(cellsAlong(axes.y));
  return { cols, rows };
}

// ---------- where things are on the board ----------

const ident = (v) => v;
const log10 = (v) => (v > 0 ? Math.log10(v) : NaN);
const pow10 = (v) => Math.pow(10, v);

// geom: { cellPx, originXPx, originYPx (top left of the box), lineScale }
export function gridFrame(config, geom) {
  const A = axesOf(config);
  const cell = geom.cellPx;
  const ls = geom.lineScale || 1;
  const x0 = geom.originXPx, y0 = geom.originYPx;
  const x1 = x0 + cell * A.cols, y1 = y0 + cell * A.rows;
  const box = { x0, y0, x1, y1 };
  const base = {
    A,
    box,
    cell,
    lineScale: ls,
    screenWidth: (x1 - x0) / ls,
    screenHeight: (y1 - y0) / ls,
    paper: A.paper,
    polar: A.paper === "polar",
    numberLine: A.paper === "numberline",
    logX: false,
    logY: false,
    fx: ident,
    fy: ident,
    fxInv: ident,
    fyInv: ident,
  };
  if (A.paper === "polar") {
    // a ring every half square, each worth unitsPerCell
    const u = config && config.unitsPerCell > 0 ? config.unitsPerCell : 1;
    const s = cell / 2 / u;
    const ox = (x0 + x1) / 2, oy = (y0 + y1) / 2;
    return finish(base, ox, oy, s, s);
  }
  if (A.paper === "numberline") {
    const s = (x1 - x0) / (A.x.max - A.x.min);
    const lineY = y0 + (y1 - y0) * 0.64;
    return finish(base, x0 - A.x.min * s, lineY, s, s, { lineY });
  }
  const logX = A.x.log, logY = A.y.log;
  const fx = logX ? log10 : ident, fy = logY ? log10 : ident;
  const fxInv = logX ? pow10 : ident, fyInv = logY ? pow10 : ident;
  const u0 = fx(A.x.min), u1 = fx(A.x.max);
  const v0 = fy(A.y.min), v1 = fy(A.y.max);
  const sx = (x1 - x0) / (u1 - u0);
  const sy = (y1 - y0) / (v1 - v0);
  const ox = x0 - u0 * sx;
  const oy = y1 + v0 * sy;
  return finish({ ...base, logX, logY, fx, fy, fxInv, fyInv }, ox, oy, sx, sy);
}

function finish(base, ox, oy, sx, sy, extra = {}) {
  const { fx, fy, fxInv, fyInv, box, A } = base;
  const toWorld = (mx, my) => [ox + fx(mx) * sx, oy - fy(my) * sy];
  const toMath = (wx, wy) => [fxInv((wx - ox) / sx), fyInv((oy - wy) / sy)];
  let xRange, yRange;
  if (base.polar) {
    xRange = [(box.x0 - ox) / sx, (box.x1 - ox) / sx];
    yRange = [(oy - box.y1) / sy, (oy - box.y0) / sy];
  } else if (base.numberLine) {
    xRange = [A.x.min, A.x.max];
    yRange = [(oy - box.y1) / sy, (oy - box.y0) / sy];
  } else {
    xRange = [A.x.min, A.x.max];
    yRange = [A.y.min, A.y.max];
  }
  // where the axes are drawn: through 0, or along the edge nearest to it
  // (and along the bottom / left of a log scale, which has no 0)
  const xAt = base.logX ? xRange[0] : Math.max(xRange[0], Math.min(xRange[1], 0));
  const yAt = base.logY ? yRange[0] : Math.max(yRange[0], Math.min(yRange[1], 0));
  const axisX = base.numberLine ? null : ox + fx(xAt) * sx;
  const axisY = base.numberLine ? oy : oy - fy(yAt) * sy;
  return {
    ...base,
    ...extra,
    ox,
    oy,
    sx,
    sy,
    toWorld,
    toMath,
    xRange,
    yRange,
    uRange: [fx(xRange[0]), fx(xRange[1])],
    vRange: [fy(yRange[0]), fy(yRange[1])],
    xAt,
    yAt,
    axisX,
    axisY,
    // the axes cross at the real origin (0, 0)
    crossAtOrigin: xAt === 0 && yAt === 0 && !base.logX && !base.logY,
  };
}

// ---------- the lines and their numbers ----------

// The values of the main and the small lines along an axis.
export function linesOf(axis, minor = 0) {
  const main = [];
  const small = [];
  if (axis.log) {
    const k0 = Math.floor(Math.log10(axis.min) - 1e-9), k1 = Math.ceil(Math.log10(axis.max) + 1e-9);
    for (let k = k0; k <= k1 && k - k0 < 40; k++) {
      const d = Math.pow(10, k);
      if (d >= axis.min * (1 - 1e-9) && d <= axis.max * (1 + 1e-9)) main.push(d);
      for (let m = 2; m <= 9; m++) {
        const v = m * d;
        if (v > axis.min * (1 + 1e-9) && v < axis.max * (1 - 1e-9)) small.push(v);
      }
    }
    return { main, small };
  }
  const { min, max, step } = axis;
  // Lines at whole steps from 0 (or, for an older graph with an odd number
  // of squares, from its edge). Counted from the first line, never more
  // than a few thousand, so odd saved numbers can't loop for ever.
  const edge = axis.anchor === "edge";
  const from = edge ? min : 0;
  const k0 = Math.ceil((min - from) / step - 1e-9), k1 = Math.floor((max - from) / step + 1e-9);
  if (!finite(k0) || !finite(k1) || !(step > 0)) return { main: [], mainIndex: [], small: [] };
  const count = Math.min(k1 - k0, 1000);
  for (let n = 0; n <= count; n++) main.push({ k: k0 + n, v: from + (k0 + n) * step });
  if (minor > 1 && count * minor <= 2400) {
    const s = step / minor;
    const j0 = Math.ceil((min - from) / s - 1e-9);
    const total = Math.min(Math.floor((max - from) / s + 1e-9) - j0, 2400);
    for (let n = 0; n <= total; n++) {
      const j = j0 + n;
      if (((j % minor) + minor) % minor !== 0) small.push(from + j * s);
    }
  }
  return { main: main.map((m) => m.v), mainIndex: main.map((m) => m.k), small };
}

const SUPERSCRIPT = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };

function gcd(a, b) {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

// k steps of (num/den)π, written as a fraction of π: "π/2", "−3π/4", "2π".
export function piText(k, piStep) {
  let n = k * ((piStep && piStep.num) || 1);
  const d = (piStep && piStep.den) || 1;
  if (n === 0) return "0";
  const sign = n < 0 ? "−" : "";
  n = Math.abs(n);
  const g = gcd(n, d);
  const top = n / g === 1 ? "π" : `${n / g}π`;
  return d / g === 1 ? `${sign}${top}` : `${sign}${top}/${d / g}`;
}

// A number as it is written along an axis.
// How many decimal places a number needs (0.125 → 3, 22.5 → 1, 2 → 0).
function placesOf(x) {
  if (!finite(x) || x === 0) return 0;
  const t = String(Number(Math.abs(x).toPrecision(12)));
  const e = /e-(\d+)$/.exec(t);
  if (e) {
    const mant = t.split("e")[0];
    return Math.min(12, Number(e[1]) + (mant.split(".")[1] || "").length);
  }
  return Math.min(12, (t.split(".")[1] || "").length);
}

// A number as it is written along an axis whose lines are `step` apart
// (starting from `from`): as many decimals as the step needs, and no more.
export function numberText(v, step = 1, from = 0) {
  if (Math.abs(v) < 1e-12 * Math.max(1, Math.abs(step))) return "0";
  const places = Math.max(placesOf(step), placesOf(from));
  const t = String(Number(v.toFixed(places)));
  return t.replace("-", "−");
}

function logText(v) {
  const k = Math.round(Math.log10(v));
  const decade = Math.abs(v / Math.pow(10, k) - 1) < 1e-9;
  if (decade && (k > 5 || k < -3)) return `10${String(k).split("").map((c) => SUPERSCRIPT[c] || c).join("")}`;
  return String(Number(v.toPrecision(4)));
}

// The number written at value v along an axis.
export function tickText(v, axis, unit = "") {
  if (axis.log) return logText(v);
  const from = axis.anchor === "edge" ? axis.min : 0;
  if (axis.label === "pi") {
    const ps = axis.piStep || { num: 1, den: 1 };
    const k = v / piStepValue(ps);
    // (an older graph's half-way lines: −7π/4)
    if (Math.abs(k - Math.round(k)) > 1e-6) return piText(Math.round(2 * k), { num: ps.num, den: ps.den * 2 });
    return piText(Math.round(k), ps);
  }
  if (axis.label === "deg") return `${numberText(v, axis.step, from)}°`;
  return `${numberText(v, axis.step, from)}${unit}`;
}

// ---------- the unit circle's standard angles ----------

const COS_TEXT = { 0: "1", 30: "√3/2", 45: "√2/2", 60: "1/2", 90: "0" };
const SIN_TEXT = { 0: "0", 30: "1/2", 45: "√2/2", 60: "√3/2", 90: "1" };

export function unitCircleAngles(which) {
  if (which === "none") return [];
  const out = [];
  for (let d = 0; d < 360; d += 15) {
    const ok =
      which === "90" ? d % 90 === 0 : which === "45" ? d % 45 === 0 : which === "30" ? d % 30 === 0 : d % 30 === 0 || d % 45 === 0;
    if (ok) out.push(d);
  }
  return out;
}

// cos and sin of a standard angle, exactly: ["√3/2", "1/2"].
export function exactCosSin(deg) {
  const r = ((deg % 360) + 360) % 360;
  const ref = r <= 90 ? r : r <= 180 ? 180 - r : r <= 270 ? r - 180 : 360 - r;
  const rad = (r * Math.PI) / 180;
  const sign = (value, text) => (text === "0" ? "0" : value < 0 ? `−${text}` : text);
  return [sign(Math.cos(rad), COS_TEXT[ref]), sign(Math.sin(rad), SIN_TEXT[ref])];
}

export function angleText(deg, units) {
  if (units === "rad") return piText(deg / 15, { num: 1, den: 12 });
  return `${deg}°`;
}

// ---------- the dialog's one-tap layouts ----------

// Each sets the ranges (keeping the steps already chosen where it can).
export function layoutAxes(layout, x, y) {
  const sx = x.step > 0 ? x.step : 1, sy = y.step > 0 ? y.step : 1;
  // (new ranges have their lines at whole steps from 0)
  x = { ...x, anchor: "zero" };
  y = { ...y, anchor: "zero" };
  switch (layout) {
    case "first":
      return { x: { ...x, min: 0, max: 10 * sx }, y: { ...y, min: 0, max: 10 * sy } };
    case "top":
      return { x: { ...x, min: -5 * sx, max: 5 * sx }, y: { ...y, min: 0, max: 8 * sy } };
    case "circle":
      return {
        x: { ...x, label: "number", min: -1.5, max: 1.5, step: 0.5 },
        y: { ...y, label: "number", min: -1.5, max: 1.5, step: 0.5 },
      };
    case "four":
    default:
      return { x: { ...x, min: -5 * sx, max: 5 * sx }, y: { ...y, min: -5 * sy, max: 5 * sy } };
  }
}

// Which layout some ranges are (for showing it as chosen), or "custom".
export function layoutOf(x, y) {
  const near = (a, b) => Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  if (x.min === 0 && y.min === 0 && x.max > 0 && y.max > 0) return "first";
  if (near(x.min, -x.max) && near(y.min, -1.5) && near(y.max, 1.5) && near(x.min, -1.5) && x.label === "number") return "circle";
  if (near(x.min, -x.max) && near(y.min, -y.max)) return "four";
  if (near(x.min, -x.max) && y.min === 0) return "top";
  return "custom";
}

// ---------- for the graph dialog ----------

export const DEFAULT_AXIS = { min: -5, max: 5, step: 1, label: "number", piStep: { num: 1, den: 2 }, log: false, perDecade: 3, name: "" };

// The ranges an axis gets when its numbers are changed to π, degrees or
// plain numbers (keeping its name).
export function withLabel(axis, label) {
  const name = axis.name || "";
  if (label === "pi") return { ...DEFAULT_AXIS, name, label: "pi", piStep: { num: 1, den: 2 }, min: -2 * Math.PI, max: 2 * Math.PI, step: Math.PI / 2 };
  if (label === "deg") return { ...DEFAULT_AXIS, name, label: "deg", min: -360, max: 360, step: 90 };
  return { ...DEFAULT_AXIS, name };
}

// An axis switched to or from a log scale.
export function withLog(axis, log) {
  if (log) return { ...DEFAULT_AXIS, name: axis.name || "", log: true, min: 1, max: 1000, perDecade: 3 };
  return { ...DEFAULT_AXIS, name: axis.name || "", min: 0, max: 10 };
}

// The settings that change when a different paper is picked.
export function switchPaper(config, paper) {
  const x = isObj(config.axes) && isObj(config.axes.x) ? config.axes.x : DEFAULT_AXIS;
  const y = isObj(config.axes) && isObj(config.axes.y) ? config.axes.y : DEFAULT_AXIS;
  const out = { ...config, type: paper };
  const plainX = x.log ? withLog(x, false) : x;
  const plainY = y.log ? withLog(y, false) : y;
  if (paper === "log") {
    out.axes = { x: { ...(x.label === "number" ? x : withLabel(x, "number")), log: !!x.log }, y: y.log ? y : withLog(y, true) };
    out.showAxes = true;
  } else if (paper === "numberline") {
    out.axes = { x: plainX, y: plainY };
    out.arrows = true;
    out.showNumbers = true;
  } else if (paper === "dots") {
    out.axes = { x: plainX, y: plainY };
    if (config.type !== "dots") {
      out.showAxes = false;
      out.showNumbers = false;
    }
  } else if (paper === "cartesian") {
    out.axes = { x: plainX, y: plainY };
    if (config.type === "dots" || config.type === "isometric") {
      out.showAxes = true;
      out.showNumbers = true;
    }
  } else if (paper === "chart") {
    if (!isObj(config.chart)) out.chart = sampleChart("bar");
    out.showAxes = true;
    out.showNumbers = true;
    out.minor = 0;
  } else if (paper === "isometric") {
    out.cols = 16;
    out.rows = 12;
  } else if (paper === "polar") {
    out.cols = 8;
  }
  return out;
}

// What's wrong with the dialog's settings (a sentence to show), or null.
export function graphProblem(config) {
  const paper = PAPER_SET.has(config.type) ? config.type : "cartesian";
  if (paper === "polar" || paper === "isometric") return null;
  // (a chart's fitted ranges are always fine)
  if (paper === "chart" && isObj(config.chart) && config.chart.fitAxes !== false) return null;
  const names = { x: paper === "numberline" ? "The number line" : "The x-axis", y: "The y-axis" };
  for (const k of paper === "numberline" ? ["x"] : ["x", "y"]) {
    const a = isObj(config.axes) && isObj(config.axes[k]) ? config.axes[k] : null;
    if (!a) return `${names[k]} needs a range.`;
    const log = paper === "log" && a.log;
    if (log && !(a.min > 0)) return `${names[k]} is a log scale, so it has to start above 0 (try 1, 0.1 or 0.01).`;
    if (!(finite(a.min) && finite(a.max) && a.max > a.min)) return `${names[k]}: the "to" number has to be bigger than the "from" number.`;
    if (!log && a.label !== "pi" && !(a.step > 0)) return `${names[k]} needs a step bigger than 0.`;
    const step = a.label === "pi" ? piStepValue(a.piStep) : a.step;
    if (!log && Math.max(Math.abs(a.min), Math.abs(a.max)) / step > 1e9) return `${names[k]}'s numbers are too big for so small a step. Use a bigger step.`;
    const cells = log ? Math.log10(a.max / a.min) * Math.max(1, Math.min(12, Math.round(num(a.perDecade, 3)))) : (a.max - a.min) / step;
    if (cells > MAX_CELLS + 1e-9) return `${names[k]} would be ${Math.round(cells)} squares long (the most is ${MAX_CELLS}). Try a bigger step.`;
    if (cells < 1 - 1e-9) return `${names[k]} would be less than one square long. Try a smaller step.`;
  }
  return null;
}

// The dialog's settings as they are saved: `cols` and `rows` worked out
// from the ranges, and the older fields kept in step with them (for a
// page still running an older version of the app).
export function finishGraph(config) {
  const paper = PAPER_SET.has(config.type) ? config.type : "cartesian";
  // (nothing is plotted on isometric paper or a chart, and a chart's grid
  // isn't snapped to)
  if (paper === "isometric" || paper === "chart") {
    config = { ...config };
    delete config.plot;
    if (paper === "chart") delete config.snap;
  }
  if (paper === "polar" || paper === "isometric") return { ...config, type: paper };
  if (paper === "chart" && isObj(config.chart) && config.chart.fitAxes !== false) {
    // the ranges fitted to the data (keeping the names given to the axes)
    const names = isObj(config.axes) ? { x: (config.axes.x || {}).name, y: (config.axes.y || {}).name } : {};
    config = { ...config, axes: chartAxes(config.chart, names) };
  }
  const A = axesOf({ ...config, type: paper });
  const { cols, rows } = boxCells(paper, A);
  return {
    ...config,
    type: paper,
    cols,
    rows,
    unitsPerCell: A.x.label === "number" && !A.x.log ? A.x.step : 1,
    trig: A.x.label === "pi" && A.y.label === "pi",
    trigStep: A.x.piStep,
  };
}
