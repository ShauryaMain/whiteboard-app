// What the pointer looks like over the board (Settings ▸ Board ▸ Pointer):
//   "size"  a ring the size of what the tool will cover, in the ink colour
//           (also follows an Apple Pencil hovering over an iPad)
//   "icon"  a small pen / highlighter / eraser in place of the arrow
//   "arrow" the plain pointer, as before

export const POINTER_STYLES = [
  ["size", "Brush size"],
  ["icon", "Tool icon"],
  ["arrow", "Arrow"],
];

// The tools that put something on the board (or take it off).
export function isInkTool(tool) {
  return tool === "pen" || tool === "highlighter" || tool === "eraser";
}

// Small outline icons (24 × 24, like the toolbar's), drawn with a white
// halo so they show on any paper. `tip` is the point that draws.
const ICONS = {
  pen: {
    paths: ["M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z", "m15 5 4 4"],
    tip: [2.4, 21.6],
  },
  highlighter: {
    paths: ["m9 11-6 6v3h9l3-3", "m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"],
    tip: [3, 20],
  },
  eraser: {
    paths: ["m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21", "M22 21H7", "m5 11 9 9"],
    tip: [4, 18],
  },
};

const safeColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(String(c || "")) ? c : "#1a1a1a");

// A CSS cursor value for the icon style (null: use the normal one).
export function iconCursor(tool, color) {
  const icon = ICONS[tool];
  if (!icon) return tool === "text" ? "text" : null;
  const size = 28;
  const k = size / 24;
  const ink = tool === "eraser" ? "#1a1a1a" : safeColor(color);
  const halo = icon.paths.map((d) => `<path d="${d}" stroke="#fff" stroke-width="4.5"/>`).join("");
  const line = icon.paths.map((d) => `<path d="${d}" stroke="#1a1a1a" stroke-width="1.8"/>`).join("");
  // the drawing end, in the ink colour
  const dot = tool === "eraser" ? "" : `<circle cx="${icon.tip[0]}" cy="${icon.tip[1]}" r="1.9" fill="${ink}" stroke="#fff" stroke-width="0.8"/>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    halo + line + dot + "</svg>";
  const x = Math.round(icon.tip[0] * k);
  const y = Math.round(icon.tip[1] * k);
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, crosshair`;
}

// The ring for the size style: its diameter on screen, and how it looks.
// `worldWidth` is the tool's width on the board; `scale` the zoom.
export function ringLook(tool, worldWidth, scale, color) {
  const d = Math.max(6, Math.min(2000, worldWidth * scale));
  if (tool === "eraser") {
    return { d, border: "1.5px dashed #1a1a1a", background: "rgba(255,255,255,0.55)", shadow: "0 0 0 1px rgba(255,255,255,0.9)" };
  }
  const c = safeColor(color);
  if (tool === "highlighter") {
    return { d, border: `1.5px solid ${c}`, background: hexToRgba(c, 0.25), shadow: "0 0 0 1px rgba(255,255,255,0.8)" };
  }
  return { d, border: `1.5px solid ${c}`, background: "transparent", shadow: "0 0 0 1px rgba(255,255,255,0.9), inset 0 0 0 1px rgba(255,255,255,0.6)" };
}

function hexToRgba(hex, a) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((ch) => ch + ch).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
