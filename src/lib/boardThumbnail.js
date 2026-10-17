// Renders a small preview picture of a board for the boards list: the
// page pattern, the ink, text boxes, and a light placeholder where each
// picture sits (real pictures can live on another server, which would
// stop the browser from saving the preview). Saved as a small JPEG in
// `boards.thumbnail`.

import { drawBackgroundPattern, isDarkBackground } from "./boardBackground";
import { inkOn } from "./inkColor";
import { drawText, textBoxHeight } from "./richText";
import "./fonts";
import { strokeBounds, imageBounds, textBounds, unionBounds, strokeDash } from "./boardObjects";
import { renderGrid } from "./gridRenderer";
import { graphBounds, graphsOf } from "./graphList";

export const THUMB_W = 400;
export const THUMB_H = 250;
function drawStroke(ctx, s, dark) {
  const pts = s.points;
  if (!pts || pts.length < 2) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (s.tool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#000";
    for (let i = 1; i < pts.length; i++) {
      ctx.lineWidth = ((pts[i - 1].w ?? s.width) + (pts[i].w ?? s.width)) / 2;
      ctx.beginPath();
      ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
      ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
    return;
  }
  ctx.globalAlpha = s.opacity ?? 1;
  ctx.strokeStyle = inkOn(s.color || "#1a1a1a", dark);
  ctx.lineWidth = s.width || 3;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  const dash = strokeDash(s);
  if (dash) ctx.setLineDash(dash);
  ctx.stroke();
  if (dash) ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

// Returns a JPEG data URL, or null when the board is empty (the list then
// shows a plain page instead).
export function renderBoardThumbnail({ strokes = [], texts = [], images = [], grid = null, background = "blank" }) {
  if (typeof document === "undefined") return null;
  const measure = document.createElement("canvas").getContext("2d");
  const visible = strokes.filter((s) => s.tool !== "eraser" && s.points && s.points.length > 1);
  const bounds = unionBounds([
    ...visible.map(strokeBounds),
    ...texts.map((t) => textBounds(t, textBoxHeight(measure, t))),
    ...images.map(imageBounds),
    graphBounds(grid),
  ]);
  if (!bounds) return null;
  const dark = isDarkBackground(background);

  const pad = 0.08;
  const bw = Math.max(40, bounds.maxX - bounds.minX);
  const bh = Math.max(40, bounds.maxY - bounds.minY);
  const scale = Math.min(1.25, (THUMB_W * (1 - 2 * pad)) / bw, (THUMB_H * (1 - 2 * pad)) / bh);
  const pan = {
    x: THUMB_W / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
    y: THUMB_H / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
  };

  // Ink goes on its own layer so the eraser can't punch through the page.
  const ink = document.createElement("canvas");
  ink.width = THUMB_W;
  ink.height = THUMB_H;
  const ictx = ink.getContext("2d");
  ictx.setTransform(scale, 0, 0, scale, pan.x, pan.y);
  for (const img of images) {
    ictx.fillStyle = "#EEF1F6";
    ictx.strokeStyle = "#C9D1DE";
    ictx.lineWidth = 1 / scale;
    ictx.fillRect(img.x, img.y, img.width, img.height);
    ictx.strokeRect(img.x, img.y, img.width, img.height);
  }
  for (const s of strokes) drawStroke(ictx, s, dark);
  for (const t of texts) drawText(ictx, t, { dark });
  for (const g of graphsOf(grid)) {
    try {
      renderGrid(ictx, g, { cellPx: g.size / g.cols, originXPx: g.x, originYPx: g.y, lineScale: 1 / scale, dark });
    } catch (err) {
      // a graph that can't be drawn just leaves it out of the preview
    }
  }

  const out = document.createElement("canvas");
  out.width = THUMB_W;
  out.height = THUMB_H;
  const octx = out.getContext("2d");
  drawBackgroundPattern(octx, background, scale, pan, THUMB_W, THUMB_H);
  octx.drawImage(ink, 0, 0);
  try {
    return out.toDataURL("image/jpeg", 0.78);
  } catch (err) {
    return null;
  }
}
