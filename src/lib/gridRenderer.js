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
// `rows` (cartesian only) is optional and defaults to `cols` — a grid with
// no `rows` is a square, exactly like before this field existed. Setting
// `rows` independently from `cols` is how the grid "stretches" into a
// rectangle: cell size is always `size / cols` (kept constant by the
// caller — see Whiteboard.js's handleApplyGridConfig) so adding more
// columns/rows always repeats the SAME-size cell outward rather than
// shrinking existing cells to fit a fixed footprint.

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

// geom: { cellPx, originXPx, originYPx (grid's top-left corner, in the
// caller's pixel space), lineScale } — lineScale lets the whiteboard keep
// its lines a constant 1 screen-pixel wide regardless of zoom (pass 1 for
// the dialog's fixed-size preview).
function renderCartesianGrid(ctx, config, geom) {
  const { cellPx, originXPx, originYPx, lineScale = 1 } = geom;
  const cols = config.cols;
  // rows defaults to cols (a plain square) so every grid saved before this
  // field existed renders exactly as before. cellPx is always the caller's
  // fixed per-cell size (see Whiteboard.js) - it never shrinks just because
  // rows/cols grew, which is what makes "add more sections" repeat the
  // same-size cell outward instead of squeezing existing cells smaller.
  const rows = config.rows || cols;
  const sizeX = cellPx * cols;
  const sizeY = cellPx * rows;
  const midIndexX = cols / 2;
  const midIndexY = rows / 2;
  const originAxisX = originXPx + midIndexX * cellPx;
  const originAxisY = originYPx + midIndexY * cellPx;

  ctx.save();
  ctx.strokeStyle = config.color || "#cfd8e3";
  ctx.lineWidth = 1 * lineScale;
  for (let i = 0; i <= cols; i++) {
    const gx = originXPx + i * cellPx;
    drawLine(ctx, gx, originYPx, gx, originYPx + sizeY);
  }
  for (let j = 0; j <= rows; j++) {
    const gy = originYPx + j * cellPx;
    drawLine(ctx, originXPx, gy, originXPx + sizeX, gy);
  }
  ctx.restore();

  if (config.showAxes) {
    ctx.save();
    ctx.strokeStyle = "#5b6b80";
    ctx.lineWidth = 1.5 * lineScale;
    drawLine(ctx, originAxisX, originYPx, originAxisX, originYPx + sizeY);
    drawLine(ctx, originXPx, originAxisY, originXPx + sizeX, originAxisY);
    ctx.restore();
  }

  if (config.showUnitCircle) {
    ctx.save();
    ctx.strokeStyle = "#E53935";
    ctx.lineWidth = 1.5 * lineScale;
    ctx.beginPath();
    ctx.arc(originAxisX, originAxisY, cellPx * (config.unitsPerCell > 0 ? 1 : 1), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (config.showNumbers) {
    ctx.save();
    ctx.fillStyle = "#5b6b80";
    // A constant ON-SCREEN size regardless of zoom (mirrors the hairline
    // gridlines above, which use the same lineScale trick) - previously
    // this was sized off cellPx directly, so it shrank right along with
    // the rest of the world when zoomed out and became unreadable.
    const fontPx = 15 * lineScale;
    ctx.font = `${fontPx}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i <= cols; i++) {
      const n = i - midIndexX;
      if (n === 0) continue;
      const label = config.trig
        ? formatPiFraction(n, config.trigStep)
        : formatPlainValue(n * config.unitsPerCell, config.unitLabel);
      const gx = originXPx + i * cellPx;
      ctx.fillText(label, gx, originAxisY + 3);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let j = 0; j <= rows; j++) {
      const n = midIndexY - j;
      if (n === 0) continue;
      const label = config.trig
        ? formatPiFraction(n, config.trigStep)
        : formatPlainValue(n * config.unitsPerCell, config.unitLabel);
      const gy = originYPx + j * cellPx;
      ctx.fillText(label, originAxisX - 5, gy);
    }
    ctx.restore();
  }
}

function renderPolarGrid(ctx, config, geom) {
  const { cellPx, originXPx, originYPx, lineScale = 1 } = geom;
  const cols = config.cols;
  const size = cellPx * cols;
  const cx = originXPx + size / 2;
  const cy = originYPx + size / 2;
  const maxRadius = size / 2;
  const spokeCount = Math.max(1, config.spokeCount || 12);

  ctx.save();
  ctx.strokeStyle = config.color || "#cfd8e3";
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
    ctx.strokeStyle = "#5b6b80";
    ctx.lineWidth = 1.5 * lineScale;
    drawLine(ctx, cx - maxRadius, cy, cx + maxRadius, cy);
    drawLine(ctx, cx, cy - maxRadius, cx, cy + maxRadius);
    ctx.restore();
  }

  if (config.showUnitCircle) {
    ctx.save();
    ctx.strokeStyle = "#E53935";
    ctx.lineWidth = 1.5 * lineScale;
    const r = (maxRadius * 1) / cols;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (config.showNumbers) {
    ctx.save();
    ctx.fillStyle = "#5b6b80";
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
        : formatPlainValue(Math.round((s / spokeCount) * 360), "°");
      const lx = cx + Math.cos(angle) * (maxRadius + 14);
      const ly = cy + Math.sin(angle) * (maxRadius + 14);
      ctx.fillText(label, lx, ly);
    }
    ctx.restore();
  }
}

export function renderGrid(ctx, rawConfig, geom) {
  const config = withDefaults(rawConfig);
  if (!config) return;
  if (config.type === "polar") renderPolarGrid(ctx, config, geom);
  else renderCartesianGrid(ctx, config, geom);
}
