// Working with the reference document's pages: making a smaller PDF of the
// pages someone picked (pdf-lib, loaded only when needed), drawing a page
// (or part of one) at any size, cutting a "clip" out of a page for the
// board, and finding words in the PDF.

import { loadPdfjs } from "./loadPdfjs";
import { BLANK_ASPECT, drawBlankPage, drawInkLayer, drawTopLayer, uiFontFamily } from "./refDoc";

// pdf.js takes over the bytes it is given, so it always gets a copy.
export async function openPdfBytes(bytes) {
  const pdfjsLib = await loadPdfjs();
  return pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
}

// Lets go of a PDF opened above (and its worker).
export function closePdf(doc) {
  if (!doc) return;
  try {
    if (typeof doc.destroy === "function") doc.destroy();
    else if (doc.loadingTask && typeof doc.loadingTask.destroy === "function") doc.loadingTask.destroy();
  } catch (err) {
    // already gone
  }
}

export async function openPdfUrl(url) {
  const pdfjsLib = await loadPdfjs();
  return pdfjsLib.getDocument({ url }).promise;
}

// A new PDF made of the given pages of one or more PDFs, in order:
// [{ bytes, pages: [1, 3, 4] }, ...] -> Uint8Array.
// Throws "encrypted" for a PDF that is locked against copying pages.
export async function buildPdf(sources) {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  for (const s of sources) {
    const src = await PDFDocument.load(s.bytes, { ignoreEncryption: true });
    if (src.isEncrypted) throw new Error("encrypted");
    const copied = await out.copyPages(src, s.pages.map((n) => n - 1));
    copied.forEach((p) => out.addPage(p));
  }
  return out.save();
}

// "1-5, 8, 10-12" -> [1, 2, 3, 4, 5, 8, 10, 11, 12] (within 1..max).
export function parsePageList(text, max) {
  const out = [];
  const seen = new Set();
  for (const part of String(text || "").split(/[,;\s]+/)) {
    if (!part) continue;
    const m = part.match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
    if (!m) continue;
    let a = Number(m[1]);
    let b = m[2] ? Number(m[2]) : a;
    if (a > b) [a, b] = [b, a];
    for (let n = Math.max(1, a); n <= Math.min(max, b); n++) {
      if (!seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
  }
  return out;
}

// [1, 2, 3, 5, 8, 9] -> "1-3, 5, 8-9"
export function describePageList(list) {
  const sorted = [...list].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`);
    i = j;
  }
  return parts.join(", ");
}

// ---------- page sizes and drawing ----------

const rotationOf = (entry) => (((entry && entry.rotate) || 0) % 360 + 360) % 360;

// The page's size as shown (after turning), in its own units.
export async function pageBaseSize(pdfDoc, entry, image) {
  const r = rotationOf(entry);
  if (entry.kind === "pdf" && pdfDoc) {
    const page = await pdfDoc.getPage(entry.src);
    const vp = page.getViewport({ scale: 1, rotation: (page.rotate + r) % 360 });
    return { w: vp.width, h: vp.height };
  }
  let w = 1000, h = 1000 * BLANK_ASPECT;
  if (entry.kind === "image") {
    w = (image && image.naturalWidth) || 1000;
    h = (image && image.naturalHeight) || 1000;
  }
  return r === 90 || r === 270 ? { w: h, h: w } : { w, h };
}

// Draws the page (scaled by `scale` from its own units) into ctx, shifted
// so that (offX, offY) of the scaled page lands at the canvas' top-left.
// `isCurrent()` lets a slow PDF page give up when it's no longer wanted.
export async function drawPage(ctx, { pdfDoc, entry, image }, scale, offX = 0, offY = 0) {
  const r = rotationOf(entry);
  if (entry.kind === "pdf" && pdfDoc) {
    const page = await pdfDoc.getPage(entry.src);
    const viewport = page.getViewport({ scale, rotation: (page.rotate + r) % 360, offsetX: -offX, offsetY: -offY });
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
    const task = page.render({ canvasContext: ctx, viewport });
    await task.promise;
    return;
  }
  const base = await pageBaseSize(pdfDoc, entry, image);
  const W = base.w * scale, H = base.h * scale;
  ctx.save();
  ctx.translate(-offX, -offY);
  if (entry.kind === "image" && image) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    const iw = r === 90 || r === 270 ? H : W;
    const ih = r === 90 || r === 270 ? W : H;
    if (r === 90) {
      ctx.translate(W, 0);
      ctx.rotate(Math.PI / 2);
    } else if (r === 180) {
      ctx.translate(W, H);
      ctx.rotate(Math.PI);
    } else if (r === 270) {
      ctx.translate(0, H);
      ctx.rotate(-Math.PI / 2);
    }
    ctx.drawImage(image, 0, 0, iw, ih);
  } else {
    drawBlankPage(ctx, entry.style, W, H);
  }
  ctx.restore();
}

// ---------- clips ----------

function canvasOf(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function blobOf(canvas, type, quality) {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), type, quality);
    } catch (err) {
      resolve(null);
    }
  });
}

// Cuts the box { x, y, w, h } (fractions of the page) out of a page, sharp
// (drawn afresh from the PDF, not a screenshot), with the markings on that
// part of the page when `marks` is given, and a small caption underneath.
// -> { blob, type, width, height } or null.
export async function renderClip({ pdfDoc, entry, image, box, marks, caption }) {
  const base = await pageBaseSize(pdfDoc, entry, image);
  const boxW = box.w * base.w;
  const boxH = box.h * base.h;
  if (boxW < 2 || boxH < 2) return null;
  // ~2.5 px per unit (sharp on a tablet), between 700 and 1800 px wide,
  // and never more than ~4.5 million pixels
  let outW = Math.min(1800, Math.max(700, boxW * 2.5));
  let scale = outW / boxW;
  if (outW * boxH * scale > 4.5e6) scale = Math.sqrt(4.5e6 / (boxW * boxH));
  outW = Math.round(boxW * scale);
  const outH = Math.round(boxH * scale);
  const pageW = base.w * scale, pageH = base.h * scale;
  const offX = box.x * pageW, offY = box.y * pageH;

  const content = canvasOf(outW, outH);
  await drawPage(content.getContext("2d"), { pdfDoc, entry, image }, scale, offX, offY);

  if (marks && marks.length) {
    const ink = canvasOf(outW, outH);
    const ictx = ink.getContext("2d");
    ictx.translate(-offX, -offY);
    drawInkLayer(ictx, marks, pageW, pageH);
    drawTopLayer(ictx, marks, pageW, pageH);
    content.getContext("2d").drawImage(ink, 0, 0);
  }

  // the card: a thin frame and the caption ("p. 4 · Worksheet.pdf")
  const border = Math.max(2, Math.round(outW / 500));
  const capH = caption ? Math.max(28, Math.round(Math.min(outW, 1400) * 0.04)) : 0;
  const card = canvasOf(outW + border * 2, outH + border * 2 + capH);
  const c = card.getContext("2d");
  c.fillStyle = "#D6D2C8";
  c.fillRect(0, 0, card.width, card.height);
  c.drawImage(content, border, border);
  if (caption) {
    c.fillStyle = "#F8F7F4";
    c.fillRect(border, border + outH, outW, capH);
    c.fillStyle = "#E4E2DC";
    c.fillRect(border, border + outH, outW, Math.max(1, Math.round(border / 2)));
    c.fillStyle = "#5F5E5A";
    c.font = `${Math.round(capH * 0.5)}px ${uiFontFamily()}`;
    c.textBaseline = "middle";
    let text = caption;
    const room = outW - capH * 0.8;
    while (text.length > 4 && c.measureText(text).width > room) text = text.slice(0, -2);
    if (text !== caption) text = text.replace(/\s*$/, "") + "…";
    c.fillText(text, border + capH * 0.4, border + outH + capH / 2);
  }
  let type = "image/png";
  let blob = await blobOf(card, type);
  if (blob && blob.size > 1.6 * 1024 * 1024) {
    type = "image/jpeg";
    blob = await blobOf(card, type, 0.9);
  }
  if (!blob) return null;
  return { blob, type, width: card.width, height: card.height };
}

// ---------- finding words ----------

// The words on a PDF page and where each piece of text sits (fractions of
// the page as shown).
export async function pageTextIndex(pdfDoc, entry) {
  const page = await pdfDoc.getPage(entry.src);
  const viewport = page.getViewport({ scale: 1, rotation: (page.rotate + rotationOf(entry)) % 360 });
  const content = await page.getTextContent();
  let text = "";
  const items = [];
  for (const it of content.items) {
    if (typeof it.str !== "string") continue;
    const t = it.transform;
    const h = it.height || Math.hypot(t[2], t[3]) || 10;
    const [ax, ay] = viewport.convertToViewportPoint(t[4], t[5]);
    const [bx, by] = viewport.convertToViewportPoint(t[4] + (it.width || 0), t[5] + h);
    const rect = {
      x: Math.min(ax, bx) / viewport.width,
      y: Math.min(ay, by) / viewport.height,
      w: Math.abs(bx - ax) / viewport.width,
      h: Math.abs(by - ay) / viewport.height,
      across: Math.abs(bx - ax) >= Math.abs(by - ay),
    };
    const start = text.length;
    text += it.str;
    items.push({ start, end: text.length, rect });
    text += it.hasEOL ? "\n" : it.str.endsWith(" ") ? "" : " ";
  }
  return { text, lower: text.toLowerCase(), items };
}

// Where `query` appears in a page's text: [{ at, rects }]
export function findInPage(index, query) {
  const q = String(query || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!q || !index) return [];
  const hay = index.lower.replace(/\s/g, " ");
  const out = [];
  let from = 0;
  for (let guard = 0; guard < 200; guard++) {
    const at = hay.indexOf(q, from);
    if (at < 0) break;
    const end = at + q.length;
    const rects = [];
    for (const it of index.items) {
      if (it.end <= at || it.start >= end) continue;
      const len = Math.max(1, it.end - it.start);
      const a = Math.max(0, at - it.start) / len;
      const b = Math.min(len, end - it.start) / len;
      const r = it.rect;
      rects.push(r.across ? { x: r.x + r.w * a, y: r.y, w: r.w * (b - a), h: r.h } : { x: r.x, y: r.y + r.h * a, w: r.w, h: r.h * (b - a) });
    }
    out.push({ at, rects, snippet: index.text.slice(Math.max(0, at - 30), Math.min(index.text.length, end + 40)).replace(/\s+/g, " ") });
    from = end;
  }
  return out;
}
