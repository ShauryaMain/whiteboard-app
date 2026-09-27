// Helpers for working with everything on the board as "objects" — ink
// strokes, text boxes and images — so selection, copy / cut / paste,
// duplicate and delete can treat them all the same way. Pure functions
// only (no React, no Supabase), so they're easy to reason about.

export const OBJECT_KINDS = ["strokes", "texts", "images"];

export function newId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function emptySelection() {
  return { strokes: [], texts: [], images: [] };
}

export function selectionCount(sel) {
  if (!sel) return 0;
  return sel.strokes.length + sel.texts.length + sel.images.length;
}

// ---------- bounds ----------

export function strokeBounds(stroke) {
  const pts = stroke.points || [];
  if (!pts.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let maxW = stroke.width || 1;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.w && p.w > maxW) maxW = p.w;
  }
  const pad = maxW / 2;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

export function imageBounds(img) {
  return { minX: img.x, minY: img.y, maxX: img.x + img.width, maxY: img.y + img.height };
}

// Axis-aligned box around a (possibly rotated) text box. `height` comes
// from the board's own text layout.
export function textBounds(t, height) {
  const w = t.width || 240;
  const rot = t.rotation || 0;
  if (!rot) return { minX: t.x, minY: t.y, maxX: t.x + w, maxY: t.y + height };
  const cx = t.x + w / 2;
  const cy = t.y + height / 2;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [dx, dy] of [[-w / 2, -height / 2], [w / 2, -height / 2], [w / 2, height / 2], [-w / 2, height / 2]]) {
    const x = cx + dx * cos - dy * sin;
    const y = cy + dx * sin + dy * cos;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function unionBounds(list) {
  let out = null;
  for (const b of list) {
    if (!b) continue;
    if (!out) out = { ...b };
    else {
      if (b.minX < out.minX) out.minX = b.minX;
      if (b.minY < out.minY) out.minY = b.minY;
      if (b.maxX > out.maxX) out.maxX = b.maxX;
      if (b.maxY > out.maxY) out.maxY = b.maxY;
    }
  }
  return out;
}

export function boundsIntersect(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function boundsContain(outer, inner) {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;
}

export function rectFromPoints(a, b) {
  return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
}

function pointInRect(p, r) {
  return p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;
}

// ---------- hit testing ----------

function distToSegmentSq(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  let t = len ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + t * dx - p.x;
  const y = a.y + t * dy - p.y;
  return x * x + y * y;
}

// Topmost visible (non-eraser) stroke under a world point; `tolerance` is in
// world units so it can stay a comfortable finger/pen size at any zoom.
export function hitTestStrokes(strokes, worldPos, tolerance) {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    if (!s || s.tool === "eraser" || !s.points || s.points.length === 0) continue;
    const b = strokeBounds(s);
    const reach = tolerance;
    if (worldPos.x < b.minX - reach || worldPos.x > b.maxX + reach || worldPos.y < b.minY - reach || worldPos.y > b.maxY + reach) continue;
    const r = (s.width || 1) / 2 + tolerance;
    const r2 = r * r;
    if (s.points.length === 1) {
      const dx = s.points[0].x - worldPos.x, dy = s.points[0].y - worldPos.y;
      if (dx * dx + dy * dy <= r2) return s;
      continue;
    }
    for (let j = 1; j < s.points.length; j++) {
      if (distToSegmentSq(worldPos, s.points[j - 1], s.points[j]) <= r2) return s;
    }
  }
  return null;
}

export function hitTestImages(images, worldPos) {
  for (let i = images.length - 1; i >= 0; i--) {
    const img = images[i];
    if (worldPos.x >= img.x && worldPos.x <= img.x + img.width && worldPos.y >= img.y && worldPos.y <= img.y + img.height) return img;
  }
  return null;
}

// Everything a drag-box touches. Visible strokes are picked if any of their
// points is inside the box; eraser strokes only when they're entirely inside
// (so moving a region carries its rub-outs with it without grabbing erasers
// that belong to other drawings).
export function objectsInRect(rect, { strokes, texts, images }, textHeightFn) {
  const sel = emptySelection();
  for (const s of strokes) {
    if (!s.points || !s.points.length) continue;
    if (s.tool === "eraser") {
      const b = strokeBounds(s);
      if (b && boundsContain(rect, b)) sel.strokes.push(s.id);
    } else if (boundsIntersect(rect, strokeBounds(s)) && s.points.some((p) => pointInRect(p, rect))) {
      sel.strokes.push(s.id);
    }
  }
  for (const t of texts) {
    if (boundsIntersect(rect, textBounds(t, textHeightFn(t)))) sel.texts.push(t.id);
  }
  for (const img of images) {
    if (boundsIntersect(rect, imageBounds(img))) sel.images.push(img.id);
  }
  return sel;
}

// ---------- transforms ----------

export function translateStroke(s, dx, dy) {
  return { ...s, points: s.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) };
}

export function translateText(t, dx, dy) {
  return { ...t, x: t.x + dx, y: t.y + dy };
}

export function translateImage(img, dx, dy) {
  return { ...img, x: img.x + dx, y: img.y + dy };
}

// Fresh copies with new ids, shifted by (dx, dy) — used by paste and
// duplicate.
export function cloneObjects(data, dx, dy) {
  return {
    strokes: (data.strokes || []).map((s) => ({ ...translateStroke(s, dx, dy), id: newId() })),
    texts: (data.texts || []).map((t) => ({ ...translateText(t, dx, dy), id: newId() })),
    images: (data.images || []).map((img) => ({ ...translateImage(img, dx, dy), id: newId() })),
  };
}

export function selectionFromData(data) {
  return {
    strokes: (data.strokes || []).map((s) => s.id),
    texts: (data.texts || []).map((t) => t.id),
    images: (data.images || []).map((i) => i.id),
  };
}

// Splits a set of objects into broadcast-sized pieces (Supabase realtime
// caps a message at ~256KB; stay far below it).
export function chunkObjects(data, maxChars = 60000) {
  const chunks = [];
  let current = emptySelection();
  let size = 0;
  for (const kind of OBJECT_KINDS) {
    for (const obj of data[kind] || []) {
      const len = JSON.stringify(obj).length;
      if (size > 0 && size + len > maxChars) {
        chunks.push(current);
        current = emptySelection();
        size = 0;
      }
      current[kind].push(obj);
      size += len;
    }
  }
  if (size > 0) chunks.push(current);
  return chunks;
}

// ---------- internal clipboard ----------
// Board objects are copied into this page's memory and (so you can paste
// into another board on the same device) localStorage. The system
// clipboard just gets a short marker text, so a later copy from another
// app is recognised and wins.

export const CLIPBOARD_MARKER = "[Whiteboard selection]";
const CLIPBOARD_KEY = "whiteboard_clipboard";
let memoryClipboard = null;

export function writeInternalClipboard(data) {
  const payload = { v: 1, copiedAt: Date.now(), ...data };
  memoryClipboard = payload;
  try {
    window.localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(payload));
  } catch (err) {
    // too big for storage (e.g. an inline image) — memory copy still works here
  }
  return payload;
}

export function readInternalClipboard() {
  let stored = null;
  try {
    const raw = window.localStorage.getItem(CLIPBOARD_KEY);
    if (raw) stored = JSON.parse(raw);
  } catch (err) {
    stored = null;
  }
  if (memoryClipboard && (!stored || memoryClipboard.copiedAt >= stored.copiedAt)) return memoryClipboard;
  return stored;
}

// Puts the marker on the system clipboard. Resolves true if that worked.
export function writeClipboardMarker() {
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return Promise.resolve(false);
    return navigator.clipboard.writeText(CLIPBOARD_MARKER).then(() => true, () => false);
  } catch (err) {
    return Promise.resolve(false);
  }
}

// For the on-screen Paste button (no keyboard): asks the browser for the
// clipboard contents. Safari shows its own small "Paste" bubble first.
export async function readSystemClipboard() {
  const files = [];
  let text = "";
  let gotItems = false;
  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      gotItems = true;
      for (const item of items) {
        const imageType = item.types.find((t) => t.indexOf("image/") === 0);
        if (imageType) {
          const blob = await item.getType(imageType);
          files.push(new File([blob], "pasted-image", { type: imageType }));
        } else if (!text && item.types.indexOf("text/plain") !== -1) {
          text = await (await item.getType("text/plain")).text();
        }
      }
    }
  } catch (err) {
    gotItems = false;
  }
  if (!gotItems) {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) text = await navigator.clipboard.readText();
    } catch (err) {
      text = "";
    }
  }
  return { files, text };
}

// ---------- images ----------

export const IMAGE_MAX_SIDE = 1600;
export const INLINE_IMAGE_MAX_BYTES = 150 * 1024;

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't read that image."));
    img.src = src;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    if (canvas.toBlob) canvas.toBlob((b) => resolve(b), type, quality);
    else resolve(null);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function encode(img, maxSide, preferJpeg) {
  const ratio = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * ratio));
  const h = Math.max(1, Math.round(img.naturalHeight * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (preferJpeg) {
    // JPEG has no transparency: put transparent areas on white paper.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  const type = preferJpeg ? "image/jpeg" : "image/png";
  const blob = await canvasToBlob(canvas, type, preferJpeg ? 0.85 : undefined);
  return { blob, type, width: w, height: h };
}

// Shrinks a picked / pasted / dropped image to at most 1600px on its long
// side. Photos become JPEG; diagrams and screenshots stay PNG unless that
// ends up huge.
export async function prepareImageFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(url);
    const isJpeg = file.type === "image/jpeg";
    let out = await encode(img, IMAGE_MAX_SIDE, isJpeg);
    if (!out.blob) throw new Error("This browser couldn't process that image.");
    if (!isJpeg && out.blob.size > 1.5 * 1024 * 1024) out = await encode(img, IMAGE_MAX_SIDE, true);
    return { ...out, source: img };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Fallback when an upload isn't possible: a small inline copy (data URL)
// that fits in a realtime message and a database row.
export async function makeInlineImage(prepared) {
  if (prepared.blob.size <= INLINE_IMAGE_MAX_BYTES) return blobToDataUrl(prepared.blob);
  for (const side of [1000, 700]) {
    const out = await encode(prepared.source, side, true);
    if (out.blob && out.blob.size <= INLINE_IMAGE_MAX_BYTES) return blobToDataUrl(out.blob);
  }
  return null;
}

export function imageFilesFrom(list) {
  const files = [];
  for (const f of Array.from(list || [])) {
    if (f && f.type && f.type.indexOf("image/") === 0) files.push(f);
  }
  return files;
}
