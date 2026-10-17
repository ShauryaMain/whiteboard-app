// On a dark page, black writing is shown white (and on a light page, white
// writing is shown black), so nothing ever disappears when someone changes
// the page colour. Only what's shown changes: the ink keeps its colour, so
// going back to a white page shows it black again.

function parseHex(c) {
  const m = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(c || "").trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lightnessOf(rgb) {
  const lin = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

export const LIGHT_INK = "#f4f4f1";
export const DARK_INK = "#1a1a1a";

// The colour to draw `color` with on this page.
export function inkOn(color, dark) {
  const rgb = parseHex(color);
  if (!rgb) return color;
  const l = lightnessOf(rgb);
  if (dark && l < 0.03) return LIGHT_INK;
  if (!dark && l > 0.82) return DARK_INK;
  return color;
}
