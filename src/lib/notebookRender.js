// A notebook's pages as pictures: the small ones in the pages panel, and
// the full-size ones that go into an exported PDF. Plain functions: the
// same drawing as boards use (boardRender.js), cut to one page each.

import { drawInkStroke, drawTextBoxes, drawGraph, loadBoardImages } from "./boardRender";
import { graphBox, packGraphs } from "./graphList";
import { layoutPages, pageIndexAt, paintPaper, pageColorIsDark, strokeAnchorY, PAGE_SIZES } from "./notebook";
import { makePdf } from "./boardExport";
import { drawTapePiece, isTape } from "./tape";

function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function release(canvas) {
  canvas.width = 0;
  canvas.height = 0;
}

// What's on each page: [{ strokes, texts, images, graphs }] by page index.
export function contentsByPage(nb, { strokes = [], texts = [], images = [], graphs = [] }) {
  const layout = layoutPages(nb);
  const out = layout.map(() => ({ strokes: [], texts: [], images: [], graphs: [] }));
  if (!layout.length) return out;
  for (const s of strokes) out[pageIndexAt(layout, strokeAnchorY(s))].strokes.push(s);
  for (const t of texts) out[pageIndexAt(layout, t.y)].texts.push(t);
  for (const i of images) out[pageIndexAt(layout, i.y)].images.push(i);
  for (const g of graphs) out[pageIndexAt(layout, graphBox(g).minY)].graphs.push(g);
  return out;
}

// One page drawn at `scale` (canvas px per board unit). `pictures`: a Map
// from loadBoardImages (pictures on the page, and the page's own imported
// background under the key "bg"). `tape`: "cover" draws the page's tape on
// top of the writing (as it looks on screen), "hide" leaves it off (the
// answers show). Returns a canvas (the caller releases it).
// `region` (board units, optional): only that part of the page (marking
// one question across a class). `marks`: a teacher's strokes, drawn on a
// sheet of their own over the student's ink.
export function renderPage({ rect, color, contents, pictures = null, scale = 1, tape = "cover", region = null, marks = null }) {
  const box = region || rect;
  const width = Math.round(box.w * scale);
  const height = Math.round(box.h * scale);
  const ox = box.x;
  const oy = box.y;
  const dark = pageColorIsDark(color);
  const out = makeCanvas(width, height);
  const ctx = out.getContext("2d");
  // the paper (or the imported page)
  ctx.setTransform(scale, 0, 0, scale, -ox * scale, -oy * scale);
  const bg = pictures && pictures.get("bg");
  paintPaper(ctx, rect, rect.page.paper, color, scale, bg || null);
  // pictures sit on the paper, under the ink
  const tapes = [];
  for (const img of contents.images || []) {
    if (isTape(img)) {
      tapes.push(img);
      continue;
    }
    const el = pictures && pictures.get(img.id);
    if (el) {
      try {
        ctx.drawImage(el, img.x, img.y, img.width, img.height);
        continue;
      } catch (err) {
        // can't be copied: an outline instead
      }
    }
    ctx.fillStyle = "#EEF1F6";
    ctx.strokeStyle = "#C9D1DE";
    ctx.lineWidth = 1 / scale;
    ctx.fillRect(img.x, img.y, img.width, img.height);
    ctx.strokeRect(img.x, img.y, img.width, img.height);
  }
  // the ink, on a sheet of its own so rub-outs don't go through the paper
  const ink = makeCanvas(width, height);
  const ictx = ink.getContext("2d");
  ictx.setTransform(scale, 0, 0, scale, -ox * scale, -oy * scale);
  for (const s of contents.strokes || []) drawInkStroke(ictx, s, dark);
  drawTextBoxes(ictx, contents.texts || [], dark);
  if ((contents.graphs || []).length) {
    try {
      drawGraph(ictx, packGraphs(contents.graphs), scale, dark);
    } catch (err) {
      // a graph that can't be drawn is left out
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(ink, 0, 0);
  if (marks && marks.length) {
    ictx.setTransform(1, 0, 0, 1, 0, 0);
    ictx.clearRect(0, 0, width, height);
    ictx.setTransform(scale, 0, 0, scale, -ox * scale, -oy * scale);
    for (const s of marks) drawInkStroke(ictx, s, dark);
    ctx.drawImage(ink, 0, 0);
  }
  release(ink);
  // tape goes over the writing
  if (tape === "cover" && tapes.length) {
    ctx.setTransform(scale, 0, 0, scale, -ox * scale, -oy * scale);
    for (const t of tapes) drawTapePiece(ctx, t, { scale });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  return out;
}

// The pictures a page needs, loaded.
export async function loadPagePictures(rect, contents) {
  const list = (contents.images || []).filter((img) => !isTape(img));
  if (rect.page.bg && rect.page.bg.url) list.push({ id: "bg", src: rect.page.bg.url });
  return loadBoardImages(list);
}

function canvasBytes(canvas, type, quality) {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (!blob) return resolve(null);
          blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), () => resolve(null));
        },
        type,
        quality
      );
    } catch (err) {
      resolve(null);
    }
  });
}

// "1-3, 5, 8" -> [0, 1, 2, 4, 7] (page numbers counted from 1; anything
// outside 1..count is left out). null when it can't be read.
export function parsePageRange(text, count) {
  const out = new Set();
  const parts = String(text || "").split(/[,\s]+/).filter(Boolean);
  if (!parts.length) return null;
  for (const part of parts) {
    const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part);
    if (!m) return null;
    let a = parseInt(m[1], 10);
    let b = m[2] ? parseInt(m[2], 10) : a;
    if (a > b) [a, b] = [b, a];
    for (let n = Math.max(1, a); n <= Math.min(count, b); n++) out.add(n - 1);
  }
  return [...out].sort((x, y) => x - y);
}

// The notebook (or some of its pages) as one PDF, each page the size of the
// paper. Resolves to a Blob. onProgress(done, total) after each page.
// `titles` (optional): each page's title (pageTitles.js), for the PDF's
// contents list.
export async function exportNotebookPdf({ nb, indices, contents, color, onProgress, job = null, tape = "hide", titles = null }) {
  const layout = layoutPages(nb);
  const byPage = contentsByPage(nb, contents);
  const pick = (indices && indices.length ? indices : layout.map((_, i) => i)).filter((i) => i >= 0 && i < layout.length);
  const pages = [];
  const outline = [];
  const paper = PAGE_SIZES[nb.size] || PAGE_SIZES.a4;
  for (let n = 0; n < pick.length; n++) {
    if (job && job.cancelled) return null;
    const rect = layout[pick[n]];
    const own = byPage[pick[n]];
    // about 200 dots per inch on A4, so handwriting stays sharp when printed
    const scale = Math.min(2.2, 2200 / Math.max(rect.w, rect.h));
    let pictures = await loadPagePictures(rect, own);
    let canvas = renderPage({ rect, color, contents: own, pictures, scale, tape });
    let jpeg = await canvasBytes(canvas, "image/jpeg", 0.88);
    if (!jpeg) {
      // a picture that can't be copied out of the browser: left as an outline
      release(canvas);
      pictures = new Map();
      canvas = renderPage({ rect, color, contents: own, pictures, scale, tape });
      jpeg = await canvasBytes(canvas, "image/jpeg", 0.88);
    }
    const width = canvas.width;
    const height = canvas.height;
    release(canvas);
    if (!jpeg) continue;
    // the PDF page: the paper size, turned to match the page
    const landscape = rect.w > rect.h;
    const base = landscape ? { w: paper.pdf.h, h: paper.pdf.w } : { w: paper.pdf.w, h: paper.pdf.h };
    // an imported page keeps its own shape, as wide as the paper
    const media = rect.page.w && rect.page.h ? { w: base.w, h: (base.w * rect.h) / rect.w } : base;
    pages.push({ jpeg, width, height, media });
    if (titles && titles[pick[n]]) outline.push({ title: titles[pick[n]], page: pages.length - 1 });
    if (onProgress) onProgress(n + 1, pick.length);
  }
  if (!pages.length) return null;
  return new Blob([makePdf(pages, outline)], { type: "application/pdf" });
}

// A small picture of one page for the pages panel (a data URL), at
// `width` px wide.
export function pageThumbnail({ rect, color, contents, pictures = null, width = 120 }) {
  const scale = width / rect.w;
  const canvas = renderPage({ rect, color, contents, pictures, scale });
  let url = null;
  try {
    url = canvas.toDataURL("image/jpeg", 0.7);
  } catch (err) {
    url = null;
  }
  release(canvas);
  return url;
}

// Pages of a notebook as pictures to send into students' notebooks
// (src/lib/teaching.js): [{ blob, w, h, pw, ph }], each page as it looks
// (paper, ink, pictures), with any tape covering its answers.
export async function notebookPagesForClip({ nb, indices, contents, color, onProgress }) {
  const layout = layoutPages(nb);
  const byPage = contentsByPage(nb, contents);
  const out = [];
  for (let n = 0; n < indices.length; n++) {
    const i = indices[n];
    const rect = layout[i];
    if (!rect) continue;
    if (onProgress) onProgress(n, indices.length);
    const own = byPage[i];
    const scale = Math.min(2, 1600 / Math.max(rect.w, rect.h));
    let pictures = await loadPagePictures(rect, own);
    let canvas = renderPage({ rect, color, contents: own, pictures, scale, tape: "cover" });
    let blob = await canvasBytes(canvas, "image/jpeg", 0.86);
    if (!blob) {
      release(canvas);
      pictures = new Map();
      canvas = renderPage({ rect, color, contents: own, pictures, scale, tape: "cover" });
      blob = await canvasBytes(canvas, "image/jpeg", 0.86);
    }
    const w = canvas.width;
    const h = canvas.height;
    release(canvas);
    if (blob) out.push({ blob: blob instanceof Blob ? blob : new Blob([blob], { type: "image/jpeg" }), w, h, pw: Math.round(rect.w), ph: Math.round(rect.h) });
  }
  return out;
}
