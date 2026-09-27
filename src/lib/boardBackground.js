// Page backgrounds ("paper") for boards. They are painted as a CSS
// background-image on the board canvas — which is transparent wherever
// nothing is drawn — rather than into the canvas itself, so they cost
// nothing to redraw and the eraser (which punches transparent holes) never
// wipes them out. The pattern is tied to the board's pan and zoom so it
// moves with the ink, and it thins out when zoomed far out so it never
// turns into a grey smudge.
//
// Only plain linear/radial gradients are used: iPadOS 15 Safari handles
// them without trouble.

export const BOARD_BACKGROUNDS = [
  { id: "blank", label: "Blank", desc: "Plain white page" },
  { id: "lined", label: "Lined", desc: "Ruled lines, like an exercise book" },
  { id: "graph", label: "Squared", desc: "Square grid for maths and diagrams" },
  { id: "dots", label: "Dot grid", desc: "Light dots in a square grid" },
  { id: "iso", label: "Isometric", desc: "Triangular dots for 3D and isometric drawing" },
];

const IDS = new Set(BOARD_BACKGROUNDS.map((b) => b.id));

export function normalizeBackground(value) {
  return IDS.has(value) ? value : "blank";
}

const LINE = "#D9E0EB";
const DOT = "#A9B1BE";
const MIN_SCREEN_SPACING = 10;

// World-unit spacing of each pattern at 100% zoom.
const SPACING = { lined: 32, graph: 24, dots: 24, iso: 28 };

function mod(a, n) {
  return ((a % n) + n) % n;
}

// Screen spacing for a pattern at this zoom, coarsened (×5, or ×2 for the
// isometric lattice so its shape is kept) until it is comfortably visible.
function screenSpacing(type, scale) {
  let k = SPACING[type] * scale;
  const factor = type === "iso" ? 2 : 5;
  let guard = 0;
  while (k < MIN_SCREEN_SPACING && guard < 12) {
    k *= factor;
    guard += 1;
  }
  return k;
}

function px(n) {
  return n.toFixed(2) + "px";
}

// Returns the CSS background-image / -size / -position for a board
// background at the given zoom (scale) and pan (screen px offset of the
// world origin). "blank" returns backgroundImage "none".
export function backgroundCss(type, scale, pan) {
  const kind = normalizeBackground(type);
  if (kind === "blank" || !(scale > 0)) {
    return { backgroundImage: "none", backgroundSize: "auto", backgroundPosition: "0 0" };
  }
  const k = screenSpacing(kind, scale);
  const ox = mod(pan.x, k);
  const oy = mod(pan.y, k);

  if (kind === "lined") {
    return {
      backgroundImage: `linear-gradient(to bottom, ${LINE} 0px, ${LINE} 1px, transparent 1px)`,
      backgroundSize: `100% ${px(k)}`,
      backgroundPosition: `0 ${px(oy)}`,
    };
  }

  if (kind === "graph") {
    const g = `${LINE} 0px, ${LINE} 1px, transparent 1px`;
    return {
      backgroundImage: `linear-gradient(to bottom, ${g}), linear-gradient(to right, ${g})`,
      backgroundSize: `${px(k)} ${px(k)}, ${px(k)} ${px(k)}`,
      backgroundPosition: `${px(ox)} ${px(oy)}, ${px(ox)} ${px(oy)}`,
    };
  }

  const r = Math.max(1, Math.min(2.2, 1.5 * Math.sqrt(scale)));
  const dot = `radial-gradient(circle at ${px(r)} ${px(r)}, ${DOT} ${px(r)}, transparent ${px(r + 0.6)})`;

  if (kind === "dots") {
    return {
      backgroundImage: dot,
      backgroundSize: `${px(k)} ${px(k)}`,
      backgroundPosition: `${px(ox - r)} ${px(oy - r)}`,
    };
  }

  // Isometric: a triangular lattice. Rows are k·√3/2 apart and every other
  // row is shifted by half a step, so one tile (k wide, two rows tall)
  // holds two dots.
  const h = (k * Math.sqrt(3)) / 2;
  const tileH = 2 * h;
  const ix = mod(pan.x, k);
  const iy = mod(pan.y, tileH);
  return {
    backgroundImage: `${dot}, ${dot}`,
    backgroundSize: `${px(k)} ${px(tileH)}, ${px(k)} ${px(tileH)}`,
    backgroundPosition: `${px(ix - r)} ${px(iy - r)}, ${px(mod(ix + k / 2, k) - r)} ${px(mod(iy + h, tileH) - r)}`,
  };
}

// Applies the background to an element, skipping the style writes when
// nothing has changed since the last call (fullRedraw runs on every pan
// frame). `cacheRef` is any object the caller keeps between calls.
export function applyBackground(el, type, scale, pan, cacheRef) {
  if (!el) return;
  const css = backgroundCss(type, scale, pan);
  const key = css.backgroundImage + "|" + css.backgroundSize + "|" + css.backgroundPosition;
  if (cacheRef && cacheRef.current === key) return;
  if (cacheRef) cacheRef.current = key;
  el.style.backgroundImage = css.backgroundImage;
  el.style.backgroundSize = css.backgroundSize;
  el.style.backgroundPosition = css.backgroundPosition;
  el.style.backgroundRepeat = "repeat";
}

// Paints the same pattern into a 2D canvas (used for board thumbnails,
// which are saved as a single picture). `pan` is the canvas px position of
// the world origin, like the board's own pan.
export function drawBackgroundPattern(ctx, type, scale, pan, width, height) {
  const kind = normalizeBackground(type);
  ctx.save();
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);
  if (kind === "blank" || !(scale > 0)) {
    ctx.restore();
    return;
  }
  const k = screenSpacing(kind, scale);
  if (kind === "lined" || kind === "graph") {
    ctx.fillStyle = LINE;
    for (let y = mod(pan.y, k); y < height; y += k) ctx.fillRect(0, Math.round(y), width, 1);
    if (kind === "graph") {
      for (let x = mod(pan.x, k); x < width; x += k) ctx.fillRect(Math.round(x), 0, 1, height);
    }
  } else {
    ctx.fillStyle = DOT;
    const r = Math.max(0.8, Math.min(1.6, 1.2 * Math.sqrt(scale)));
    const dot = (x, y) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    if (kind === "dots") {
      for (let y = mod(pan.y, k); y < height + k; y += k) {
        for (let x = mod(pan.x, k); x < width + k; x += k) dot(x, y);
      }
    } else {
      const h = (k * Math.sqrt(3)) / 2;
      let row = Math.floor(-pan.y / h);
      for (let y = pan.y + row * h; y < height + h; y += h, row += 1) {
        const shift = mod(row, 2) === 1 ? k / 2 : 0;
        for (let x = mod(pan.x + shift, k) - k; x < width + k; x += k) dot(x, y);
      }
    }
  }
  ctx.restore();
}
