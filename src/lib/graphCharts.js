// Statistics charts drawn on a graph: bar charts, histograms, scatter
// graphs and box plots, from data typed into the graph dialog.
//
// A chart is a graph whose type is "chart", with its data in `chart`:
//   { kind: "bar", bars: [{ label, value }], showValues }
//   { kind: "histogram", mode: "table" | "raw", classes: [{ from, to, freq }],
//     raw, start, width, yMode: "auto" | "frequency" | "density" }
//   { kind: "scatter", pts: [[x, y], …], fit, showR }
//   { kind: "box", sets: [{ label, raw }], showValues }
//   (and `color`, and `fitAxes`: false to keep the ranges set by hand)
// The values are kept as they were typed (text), so the dialog shows them
// back exactly; they're read here.
//
// The axes are fitted to the data (sensible round numbers) unless the
// teacher has set their own ranges. Pure functions apart from drawChart.

import { readNumber, formatValue, bestFitLine } from "./graphMath";

// the most classes a histogram made from a list of values can have
export const MAX_CLASSES = 200;
// the most characters of data kept for a list of values (it is sent live)
export const MAX_RAW_TEXT = 6000;

export const CHART_KINDS = [
  { id: "bar", label: "Bar chart" },
  { id: "histogram", label: "Histogram" },
  { id: "scatter", label: "Scatter graph" },
  { id: "box", label: "Box plot" },
];

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const FONT = "-apple-system, BlinkMacSystemFont, sans-serif";
const INK = "#1B1D24";

// A number typed in a box (blank → NaN).
export function num(v) {
  if (typeof v === "number") return v;
  const s = String(v == null ? "" : v).trim();
  if (!s) return NaN;
  return readNumber(s);
}

// Numbers typed as a list: "3, 5, 7.5 8 −2" (commas, spaces or new lines).
export function readList(text) {
  return String(text == null ? "" : text)
    .replace(/[−–]/g, "-")
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map(Number)
    .filter(finite)
    .slice(0, 2000);
}

// ---------- the numbers ----------

export function median(sorted) {
  const n = sorted.length;
  if (!n) return NaN;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

// The five-number summary (quartiles as the medians of the lower and upper
// halves, leaving out the median itself when there's an odd number), and
// what lies more than 1.5 × IQR beyond the quartiles.
export function fiveNumbers(data) {
  const s = [...data].filter(finite).sort((a, b) => a - b);
  const n = s.length;
  if (!n) return null;
  const med = median(s);
  const lower = s.slice(0, Math.floor(n / 2));
  const upper = s.slice(Math.ceil(n / 2));
  const q1 = n === 1 ? s[0] : median(lower);
  const q3 = n === 1 ? s[0] : median(upper);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
  const inside = s.filter((v) => v >= lo && v <= hi);
  return {
    n,
    min: s[0],
    q1,
    median: med,
    q3,
    max: s[n - 1],
    iqr,
    // whiskers to the furthest values that aren't outliers
    whiskerLow: inside.length ? inside[0] : s[0],
    whiskerHigh: inside.length ? inside[inside.length - 1] : s[n - 1],
    outliers: s.filter((v) => v < lo || v > hi),
  };
}

// The classes of a histogram: [{ from, to, freq }] with numbers, in order.
export function histogramClasses(chart) {
  if (!isObj(chart)) return [];
  if (chart.mode === "raw") {
    const data = readList(chart.raw);
    const width = num(chart.width);
    if (!data.length || !(width > 0)) return [];
    const lo = Math.min(...data), hi = Math.max(...data);
    let start = num(chart.start);
    if (!finite(start) || start > lo) start = Math.floor(lo / width) * width;
    const count = Math.floor((hi - start) / width) + 1;
    // (too many classes for that width: nothing, and the dialog says why)
    if (count > MAX_CLASSES) return [];
    const out = [];
    for (let k = 0; k < count; k++) out.push({ from: start + k * width, to: start + (k + 1) * width, freq: 0 });
    for (const v of data) {
      const k = Math.min(count - 1, Math.floor((v - start) / width + 1e-9));
      if (k >= 0) out[k].freq++;
    }
    return out;
  }
  const rows = Array.isArray(chart.classes) ? chart.classes : [];
  return rows
    .map((r) => ({ from: num(r && r.from), to: num(r && r.to), freq: num(r && r.freq) }))
    .filter((r) => finite(r.from) && finite(r.to) && r.to > r.from && finite(r.freq) && r.freq >= 0)
    .sort((a, b) => a.from - b.from)
    .slice(0, 100);
}

// Whether a histogram's bars are frequency density (unequal widths, or
// chosen) rather than frequency.
export function usesDensity(chart, classes) {
  if (chart.yMode === "density") return true;
  if (chart.yMode === "frequency") return false;
  const widths = classes.map((c) => c.to - c.from);
  return widths.some((w) => Math.abs(w - widths[0]) > 1e-9 * Math.max(1, widths[0]));
}

export function barList(chart) {
  const rows = isObj(chart) && Array.isArray(chart.bars) ? chart.bars : [];
  return rows
    .map((r) => ({ label: String((r && r.label) || "").slice(0, 30), value: num(r && r.value) }))
    .filter((r) => finite(r.value))
    .slice(0, 40);
}

export function scatterPoints(chart) {
  const rows = isObj(chart) && Array.isArray(chart.pts) ? chart.pts : [];
  return rows
    .map((p) => (Array.isArray(p) ? [num(p[0]), num(p[1])] : [NaN, NaN]))
    .filter((p) => finite(p[0]) && finite(p[1]))
    .slice(0, 500);
}

export function boxSets(chart) {
  const rows = isObj(chart) && Array.isArray(chart.sets) ? chart.sets : [];
  return rows
    .map((r) => ({ label: String((r && r.label) || "").slice(0, 30), summary: fiveNumbers(readList(r && r.raw)) }))
    .filter((r) => r.summary)
    .slice(0, 6);
}

// ---------- fitting the axes ----------

// Round-number range and step covering lo…hi in about `target` steps.
export function niceScale(lo, hi, target = 10, { fromZero = false } = {}) {
  if (!finite(lo) || !finite(hi)) return { min: 0, max: 10, step: 1 };
  if (fromZero) lo = Math.min(0, lo);
  if (hi - lo < 1e-12) {
    const pad = Math.abs(hi) > 0 ? Math.abs(hi) * 0.5 : 1;
    lo -= pad;
    hi += pad;
    if (fromZero) lo = Math.min(0, lo);
  }
  const raw = (hi - lo) / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw * 0.999) || 10 * mag;
  const min = Math.floor(lo / step + 1e-9) * step;
  let max = Math.ceil(hi / step - 1e-9) * step;
  if (max <= min) max = min + step;
  return { min: clean(min), max: clean(max), step: clean(step) };
}

const clean = (v) => Number(v.toPrecision(12));

// Counts go up in whole numbers (no 0.5 of a person).
function wholeSteps(scale) {
  if (scale.step >= 1) return scale;
  return { min: Math.floor(scale.min), max: Math.max(Math.ceil(scale.max), Math.floor(scale.min) + 1), step: 1 };
}

// A range with a little room either side, so no point sits on the edge
// (starting from 0 when the data isn't far from it, as on paper).
function roomy(lo, hi, target) {
  const span = hi - lo || Math.abs(hi) || 1;
  let a = lo - span * 0.06;
  const b = hi + span * 0.06;
  if (lo >= 0 && a < 0) a = 0;
  if (lo >= 0 && lo <= span * 0.5) a = 0;
  return niceScale(a, b, target);
}

const plainAxis = (min, max, step, name) => ({ min, max, step, label: "number", piStep: { num: 1, den: 2 }, log: false, perDecade: 3, name: name || "" });

// The axes a chart's data needs (keeping the names given to them).
export function chartAxes(chart, names = {}) {
  const kind = isObj(chart) ? chart.kind : "bar";
  if (kind === "histogram") {
    const classes = histogramClasses(chart);
    const density = usesDensity(chart, classes);
    const heights = classes.map((c) => (density ? c.freq / (c.to - c.from) : c.freq));
    const x = classes.length ? niceScale(classes[0].from, classes[classes.length - 1].to, 10) : niceScale(0, 10);
    let y = niceScale(0, heights.length ? Math.max(...heights) : 10, 8, { fromZero: true });
    if (!density) y = wholeSteps(y);
    return { x: plainAxis(x.min, x.max, x.step, names.x), y: plainAxis(y.min, y.max, y.step, names.y || "") };
  }
  if (kind === "scatter") {
    const pts = scatterPoints(chart);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x = pts.length ? roomy(Math.min(...xs), Math.max(...xs), 10) : niceScale(0, 10);
    const y = pts.length ? roomy(Math.min(...ys), Math.max(...ys), 8) : niceScale(0, 10);
    return { x: plainAxis(x.min, x.max, x.step, names.x), y: plainAxis(y.min, y.max, y.step, names.y) };
  }
  if (kind === "box") {
    const sets = boxSets(chart);
    const lo = sets.length ? Math.min(...sets.map((s) => s.summary.min)) : 0;
    const hi = sets.length ? Math.max(...sets.map((s) => s.summary.max)) : 10;
    const span = hi - lo || 1;
    const x = niceScale(lo - span * 0.05, hi + span * 0.05, 10);
    // two squares of height for each box plot
    return { x: plainAxis(x.min, x.max, x.step, names.x), y: plainAxis(0, 2 * Math.max(1, sets.length), 1, "") };
  }
  // bar chart: a square (or more) for each bar, the values up the side
  const bars = barList(chart);
  let y = niceScale(Math.min(0, ...bars.map((b) => b.value)), bars.length ? Math.max(0, ...bars.map((b) => b.value)) : 10, 8, { fromZero: true });
  if (bars.every((b) => Number.isInteger(b.value))) y = wholeSteps(y);
  return { x: plainAxis(0, Math.max(1, bars.length) * 2, 1, names.x), y: plainAxis(y.min, y.max, y.step, names.y || "") };
}

// What the graph paper leaves out for each kind of chart (bars stand on
// categories, not numbers; box plots are stacked rows).
export function chartPaperOptions(chart) {
  const kind = isObj(chart) ? chart.kind : "bar";
  if (kind === "bar") return { xLines: false, xNumbers: false, minor: false };
  if (kind === "box") return { yLines: false, yNumbers: false, minor: false };
  return {};
}

// ---------- drawing ----------

function text(ctx, t, x, y, ls, { align = "center", baseline = "top", size = 13, weight = 600, color = INK, halo = false } = {}) {
  ctx.save();
  ctx.font = `${weight} ${size * ls}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (halo) {
    ctx.lineJoin = "round";
    ctx.lineWidth = 3.5 * ls;
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.strokeText(t, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(t, x, y);
  ctx.restore();
}

function fill(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return `rgba(30,136,229,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// Draws a chart's data on its graph (the paper and axes are already drawn).
// `frame` is the graph's gridFrame.
export function drawChart(ctx, config, frame) {
  const chart = isObj(config.chart) ? config.chart : null;
  if (!chart) return;
  const ls = frame.lineScale;
  const { box } = frame;
  const color = /^#[0-9a-f]{6}$/i.test(chart.color || "") ? chart.color : "#1E88E5";
  const at = (x, y) => frame.toWorld(x, y);
  ctx.save();
  try {
    if (chart.kind === "histogram") {
      const classes = histogramClasses(chart);
      const density = usesDensity(chart, classes);
      ctx.lineWidth = 1.6 * ls;
      for (const c of classes) {
        const h = density ? c.freq / (c.to - c.from) : c.freq;
        const [x0, y0] = at(c.from, h);
        const [x1, y1] = at(c.to, 0);
        if (![x0, y0, x1, y1].every(finite)) continue;
        ctx.fillStyle = fill(color, 0.35);
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        ctx.strokeStyle = color;
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      }
    } else if (chart.kind === "scatter") {
      const pts = scatterPoints(chart);
      if (chart.fit && pts.length >= 2) {
        const fit = bestFitLine(pts);
        if (fit) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
          ctx.clip();
          ctx.strokeStyle = INK;
          ctx.lineWidth = 2 * ls;
          ctx.setLineDash([10 * ls, 6 * ls]);
          ctx.beginPath();
          const [a, b] = frame.xRange;
          const [ax, ay] = at(a, fit.m * a + fit.c);
          const [bx, by] = at(b, fit.m * b + fit.c);
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
          ctx.restore();
          if (chart.showR !== false && Number.isFinite(fit.r)) {
            text(ctx, `r = ${formatValue(fit.r, 3)}`, box.x1 - 8 * ls, box.y0 + 8 * ls, ls, { align: "right", halo: true });
          }
        }
      }
      ctx.fillStyle = color;
      for (const [x, y] of pts) {
        const [wx, wy] = at(x, y);
        if (!finite(wx) || !finite(wy)) continue;
        ctx.beginPath();
        // a cross, as on paper
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.2 * ls;
        const r = 5 * ls;
        ctx.moveTo(wx - r, wy - r);
        ctx.lineTo(wx + r, wy + r);
        ctx.moveTo(wx - r, wy + r);
        ctx.lineTo(wx + r, wy - r);
        ctx.stroke();
      }
    } else if (chart.kind === "box") {
      const sets = boxSets(chart);
      sets.forEach((set, k) => {
        const s = set.summary;
        // each box plot in its own two squares, the first at the top
        const mid = 2 * (sets.length - k) - 1;
        const half = 0.42;
        const [xq1, yTop] = at(s.q1, mid + half);
        const [xq3, yBottom] = at(s.q3, mid - half);
        const [xMed] = at(s.median, mid);
        const [xLo, yMid] = at(s.whiskerLow, mid);
        const [xHi] = at(s.whiskerHigh, mid);
        const [, capTop] = at(0, mid + half * 0.6);
        const [, capBottom] = at(0, mid - half * 0.6);
        if (![xq1, xq3, xMed, xLo, xHi, yTop, yBottom, yMid].every(finite)) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 * ls;
        ctx.fillStyle = fill(color, 0.18);
        ctx.fillRect(xq1, yTop, xq3 - xq1, yBottom - yTop);
        ctx.strokeRect(xq1, yTop, xq3 - xq1, yBottom - yTop);
        ctx.beginPath();
        ctx.moveTo(xMed, yTop);
        ctx.lineTo(xMed, yBottom);
        ctx.moveTo(xLo, yMid);
        ctx.lineTo(xq1, yMid);
        ctx.moveTo(xq3, yMid);
        ctx.lineTo(xHi, yMid);
        ctx.moveTo(xLo, capTop);
        ctx.lineTo(xLo, capBottom);
        ctx.moveTo(xHi, capTop);
        ctx.lineTo(xHi, capBottom);
        ctx.stroke();
        for (const o of s.outliers) {
          const [ox] = at(o, mid);
          ctx.beginPath();
          ctx.arc(ox, yMid, 3.5 * ls, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (set.label) text(ctx, set.label, box.x0 + 6 * ls, at(0, mid + 0.95)[1], ls, { align: "left", size: 13, halo: true });
        if (chart.showValues) {
          const vals = [s.whiskerLow, s.q1, s.median, s.q3, s.whiskerHigh];
          vals.forEach((v) => {
            const [vx] = at(v, mid);
            text(ctx, formatValue(v, 2), vx, yBottom + 3 * ls, ls, { size: 11, weight: 600, color: "#3b4757", halo: true });
          });
        }
      });
    } else {
      const bars = barList(chart);
      bars.forEach((b, k) => {
        const [x0, y0] = at(2 * k + 0.3, b.value);
        const [x1, yz] = at(2 * k + 1.7, 0);
        if (![x0, y0, x1, yz].every(finite)) return;
        ctx.fillStyle = fill(color, 0.55);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6 * ls;
        ctx.fillRect(x0, Math.min(y0, yz), x1 - x0, Math.abs(yz - y0));
        ctx.strokeRect(x0, Math.min(y0, yz), x1 - x0, Math.abs(yz - y0));
        // the category under its bar
        text(ctx, b.label, (x0 + x1) / 2, frame.axisY + 5 * ls, ls, { size: 13, weight: 600, color: "#3b4757" });
        if (chart.showValues) text(ctx, formatValue(b.value, 2), (x0 + x1) / 2, Math.min(y0, yz) - 3 * ls, ls, { baseline: "bottom", size: 12, halo: true });
      });
    }
  } finally {
    ctx.restore();
  }
}

// ---------- starting data, for a new chart ----------

export function sampleChart(kind) {
  if (kind === "histogram") {
    return {
      kind,
      mode: "table",
      classes: [
        { from: "0", to: "10", freq: "4" },
        { from: "10", to: "20", freq: "9" },
        { from: "20", to: "30", freq: "12" },
        { from: "30", to: "50", freq: "10" },
      ],
      raw: "",
      start: "",
      width: "10",
      yMode: "auto",
      color: "#1E88E5",
    };
  }
  if (kind === "scatter") {
    return { kind, pts: [["1", "2.1"], ["2", "3.9"], ["3", "6.2"], ["4", "7.8"], ["5", "10.1"], ["6", "11.7"]], fit: true, showR: true, color: "#E53935" };
  }
  if (kind === "box") {
    return { kind, sets: [{ label: "Class A", raw: "12, 15, 17, 18, 20, 21, 22, 25, 27, 30, 41" }], showValues: true, color: "#8E24AA" };
  }
  return {
    kind: "bar",
    bars: [{ label: "Red", value: "8" }, { label: "Blue", value: "12" }, { label: "Green", value: "5" }, { label: "Yellow", value: "7" }],
    showValues: false,
    color: "#1E88E5",
  };
}
