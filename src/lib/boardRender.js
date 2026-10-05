// Drawing a board's contents onto a canvas, for everything that shows a
// board without being the board itself: the live viewer (a student watching
// the teacher's board, the teacher looking at a student's), the small
// previews in the class overview, and the pictures saved at the end of a
// class. Plain functions only: no React, nothing sent anywhere.
//
// (The board itself, Whiteboard.js, has its own drawing code, which also
// handles the pen as it moves. The two draw the same things the same way.)

import { renderGrid } from "./gridRenderer";
import { drawBackgroundPattern } from "./boardBackground";
import { strokeDash, strokeBounds, textBounds, imageBounds, unionBounds } from "./boardObjects";

const FONT = "-apple-system, BlinkMacSystemFont, sans-serif";

function smoothPath(ctx, pts, startIdx, endIdx) {
  if (endIdx - startIdx < 1) return;
  ctx.beginPath();
  ctx.moveTo(pts[startIdx].x, pts[startIdx].y);
  if (endIdx - startIdx === 1) {
    ctx.lineTo(pts[endIdx].x, pts[endIdx].y);
  } else {
    for (let i = startIdx + 1; i < endIdx; i++) {
      const xc = (pts[i].x + pts[i + 1].x) / 2;
      const yc = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
    }
    ctx.lineTo(pts[endIdx].x, pts[endIdx].y);
  }
  ctx.stroke();
}

function strokeSegment(ctx, p0, p1, width) {
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.stroke();
}

function drawVariableWidthPath(ctx, pts, startIdx, endIdx, fallbackWidth) {
  for (let i = startIdx; i < endIdx; i++) {
    const w0 = pts[i].w ?? fallbackWidth;
    const w1 = pts[i + 1].w ?? fallbackWidth;
    strokeSegment(ctx, pts[i], pts[i + 1], (w0 + w1) / 2);
  }
}

// One line of ink (or one pass of the eraser).
export function drawInkStroke(ctx, stroke) {
  if (!stroke || !stroke.points || stroke.points.length < 2) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (stroke.tool === "eraser") {
    // Punch a transparent hole (like the board itself does) so the page
    // background shows through instead of a white smear.
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "#000000";
    drawVariableWidthPath(ctx, stroke.points, 0, stroke.points.length - 1, stroke.width);
    ctx.globalCompositeOperation = "source-over";
  } else {
    ctx.globalAlpha = stroke.opacity ?? 1;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    const dash = strokeDash(stroke);
    if (dash) ctx.setLineDash(dash);
    smoothPath(ctx, stroke.points, 0, stroke.points.length - 1);
    if (dash) ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;
}

export function wrapTextLines(ctx, textContent, fontSize, maxWidth) {
  ctx.font = `${fontSize}px ${FONT}`;
  const paragraphs = String(textContent).split("\n");
  const lines = [];
  for (const para of paragraphs) {
    if (para === "") {
      lines.push("");
      continue;
    }
    const words = para.split(" ");
    let currentLine = "";
    for (const word of words) {
      const testLine = currentLine ? currentLine + " " + word : word;
      const testWidth = ctx.measureText(testLine).width;
      if (testWidth > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    lines.push(currentLine);
  }
  return lines;
}

export function drawTextBoxes(ctx, textsArr) {
  for (const t of textsArr) {
    const lines = wrapTextLines(ctx, t.text, t.fontSize, t.width || 240);
    const lineHeight = t.fontSize * 1.3;
    const boxHeight = lines.length * lineHeight;
    const center = { x: t.x + (t.width || 240) / 2, y: t.y + boxHeight / 2 };
    const rotation = t.rotation || 0;

    ctx.save();
    if (rotation) {
      ctx.translate(center.x, center.y);
      ctx.rotate(rotation);
      ctx.translate(-center.x, -center.y);
    }
    ctx.fillStyle = t.color;
    ctx.font = `${t.fontSize}px ${FONT}`;
    ctx.textBaseline = "top";
    lines.forEach((line, i) => ctx.fillText(line, t.x, t.y + i * lineHeight));
    ctx.restore();
  }
}

// The same graph renderer as the board (and the graph dialog's preview).
export function drawGraph(ctx, grid, scale) {
  if (!grid) return;
  const { x, y, size, cols } = grid;
  renderGrid(ctx, grid, { cellPx: size / cols, originXPx: x, originYPx: y, lineScale: 1 / scale });
}

function graphBounds(grid) {
  if (!grid || !grid.size || !grid.cols) return null;
  const rows = grid.type === "polar" ? grid.cols : grid.rows || grid.cols;
  return { minX: grid.x, minY: grid.y, maxX: grid.x + grid.size, maxY: grid.y + (grid.size / grid.cols) * rows };
}

// ---------- what the teacher has put on a student's board ----------
//
// Two things, both of which the student can see but not rub out:
//   question  what the teacher sent to the whole class from their own board
//             ({ id, strokes, texts, images, grid }), and
//   ink       what the teacher has written on this one student's board.
// They are drawn on a canvas of their own, on top of the student's ink, so
// the student's eraser never touches them (and the rub-outs that are part
// of the teacher's question never touch the student's work). `live` holds
// lines that are still being drawn, by key.
//
// Pictures in the question aren't drawn here: like every picture on a
// board they are shown as elements underneath the ink.
export function drawTeacherLayer(ctx, layer, scale) {
  const question = layer && layer.question;
  if (question) {
    for (const s of question.strokes || []) drawInkStroke(ctx, s);
    drawTextBoxes(ctx, question.texts || []);
    if (question.grid) {
      try {
        drawGraph(ctx, question.grid, scale);
      } catch (err) {
        // a graph that can't be drawn is left out rather than breaking the board
      }
    }
  }
  for (const s of (layer && layer.ink) || []) drawInkStroke(ctx, s);
  const live = (layer && layer.live) || {};
  for (const key in live) drawInkStroke(ctx, live[key]);
}

export function hasTeacherLayer(layer) {
  if (!layer) return false;
  const q = layer.question;
  if (q && ((q.strokes || []).length || (q.texts || []).length || (q.images || []).length || q.grid)) return true;
  if ((layer.ink || []).length) return true;
  for (const key in layer.live || {}) return true;
  return false;
}

// ---------- how big is it all ----------

function textHeight(ctx, t) {
  const lines = ctx ? wrapTextLines(ctx, t.text, t.fontSize, t.width || 240).length : 1;
  return lines * t.fontSize * 1.3;
}

// The box around a set of board contents (null when there is nothing).
// `ctx` is any 2D context, used to measure text.
export function contentBoxes(ctx, { strokes = [], texts = [], images = [], grid = null } = {}) {
  const boxes = [];
  for (const stroke of strokes) {
    if (stroke && stroke.tool !== "eraser" && stroke.points && stroke.points.length) boxes.push(strokeBounds(stroke));
  }
  for (const t of texts) boxes.push(textBounds(t, textHeight(ctx, t)));
  for (const img of images) boxes.push(imageBounds(img));
  boxes.push(graphBounds(grid));
  return boxes;
}

export function boardBounds(ctx, content, layer) {
  const boxes = contentBoxes(ctx, content);
  if (layer) {
    if (layer.question) boxes.push(...contentBoxes(ctx, layer.question));
    boxes.push(...contentBoxes(ctx, { strokes: layer.ink || [] }));
  }
  return unionBounds(boxes);
}

// ---------- a whole board as one picture ----------

// Loads the pictures on a board so they can be drawn into a saved picture.
// Returns a Map of id -> image (pictures that can't be loaded, or that their
// server won't allow to be copied, are simply left out).
export function loadBoardImages(images, timeoutMs = 6000) {
  const out = new Map();
  const list = (images || []).filter((img) => img && img.id && img.src);
  if (!list.length || typeof Image === "undefined") return Promise.resolve(out);
  return Promise.all(
    list.map(
      (img) =>
        new Promise((resolve) => {
          const el = new Image();
          let settled = false;
          const finish = (ok) => {
            if (settled) return;
            settled = true;
            if (ok) out.set(img.id, el);
            resolve();
          };
          if (!/^data:/i.test(img.src)) el.crossOrigin = "anonymous";
          el.onload = () => finish(true);
          el.onerror = () => finish(false);
          setTimeout(() => finish(false), timeoutMs);
          el.src = img.src;
        })
    )
  ).then(() => out);
}

function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

// Gives a working canvas's memory back straight away (tablets only allow a
// page so much canvas at once).
function release(canvas) {
  canvas.width = 0;
  canvas.height = 0;
}

const PICTURE_MAX_SIDE = 2000; // px
const PICTURE_MIN_WORLD = { width: 900, height: 560 }; // a nearly empty board still gets a sensible page
const PICTURE_PAD = 44; // board units of margin around the work

// Draws a board, cropped to what is on it, with a title strip across the
// top. Returns { canvas, width, height }.
//   content  { strokes, texts, images, grid, background }
//   layer    { question, ink } (see drawTeacherLayer), optional
//   pictures Map from loadBoardImages, optional
//   title    e.g. the student's name; note: smaller words on the right
export function renderBoardPicture({ content = {}, layer = null, pictures = null, title = "", note = "", empty = "Nothing on this board" }) {
  const measure = makeCanvas(4, 4).getContext("2d");
  const box = boardBounds(measure, content, layer);
  const nothing = !box;
  const b = box || { minX: 0, minY: 0, maxX: PICTURE_MIN_WORLD.width - PICTURE_PAD * 2, maxY: PICTURE_MIN_WORLD.height - PICTURE_PAD * 2 };
  const worldW = Math.max(PICTURE_MIN_WORLD.width, b.maxX - b.minX + PICTURE_PAD * 2);
  const worldH = Math.max(PICTURE_MIN_WORLD.height, b.maxY - b.minY + PICTURE_PAD * 2);
  const scale = Math.min(2, PICTURE_MAX_SIDE / Math.max(worldW, worldH));
  const width = Math.round(worldW * scale);
  const boardH = Math.round(worldH * scale);
  const headH = Math.round(Math.max(56, width * 0.045));
  const height = boardH + headH;
  const pan = { x: (PICTURE_PAD - b.minX) * scale, y: (PICTURE_PAD - b.minY) * scale };

  const out = makeCanvas(width, height);
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);

  // the page
  const page = makeCanvas(width, boardH);
  const pctx = page.getContext("2d");
  drawBackgroundPattern(pctx, content.background, scale, pan, width, boardH);
  const drawPictures = (list) => {
    for (const img of list || []) {
      const el = pictures && pictures.get(img.id);
      pctx.setTransform(scale, 0, 0, scale, pan.x, pan.y);
      if (el) {
        try {
          pctx.drawImage(el, img.x, img.y, img.width, img.height);
          continue;
        } catch (err) {
          // fall through to the placeholder
        }
      }
      pctx.fillStyle = "#EEF1F6";
      pctx.strokeStyle = "#C9D1DE";
      pctx.lineWidth = 1 / scale;
      pctx.fillRect(img.x, img.y, img.width, img.height);
      pctx.strokeRect(img.x, img.y, img.width, img.height);
    }
    pctx.setTransform(1, 0, 0, 1, 0, 0);
  };
  drawPictures(layer && layer.question ? layer.question.images : []);
  drawPictures(content.images);

  // the student's ink, on a sheet of its own so rub-outs don't go through the page
  const ink = makeCanvas(width, boardH);
  const ictx = ink.getContext("2d");
  ictx.setTransform(scale, 0, 0, scale, pan.x, pan.y);
  for (const s of content.strokes || []) drawInkStroke(ictx, s);
  drawTextBoxes(ictx, content.texts || []);
  if (content.grid) {
    try {
      drawGraph(ictx, content.grid, scale);
    } catch (err) {
      // as above
    }
  }
  pctx.drawImage(ink, 0, 0);
  release(ink);

  // then whatever the teacher put on it
  if (hasTeacherLayer(layer)) {
    const top = makeCanvas(width, boardH);
    const tctx = top.getContext("2d");
    tctx.setTransform(scale, 0, 0, scale, pan.x, pan.y);
    drawTeacherLayer(tctx, layer, scale);
    pctx.drawImage(top, 0, 0);
    release(top);
  }
  ctx.drawImage(page, 0, headH);
  release(page);

  if (nothing && empty) {
    ctx.fillStyle = "#9C9B97";
    ctx.font = `${Math.round(headH * 0.42)}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(empty, width / 2, headH + boardH / 2);
  }

  // the title strip
  ctx.fillStyle = "#FDFCF7";
  ctx.fillRect(0, 0, width, headH);
  ctx.fillStyle = "#1B1D24";
  ctx.fillRect(0, headH - 2, width, 2);
  const padX = Math.round(headH * 0.4);
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.font = `${Math.round(headH * 0.3)}px ${FONT}`;
  ctx.fillStyle = "#5F5E5A";
  const noteW = note ? ctx.measureText(note).width : 0;
  if (note) ctx.fillText(note, width - padX, headH / 2);
  ctx.textAlign = "left";
  ctx.font = `bold ${Math.round(headH * 0.44)}px ${FONT}`;
  ctx.fillStyle = "#18191C";
  let shown = String(title || "");
  const room = width - padX * 3 - noteW;
  while (shown.length > 1 && ctx.measureText(shown).width > room) shown = shown.slice(0, -2) + "…";
  ctx.fillText(shown, padX, headH / 2);

  return { canvas: out, width, height };
}
