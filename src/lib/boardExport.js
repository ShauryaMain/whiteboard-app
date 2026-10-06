// Saving students' boards at the end of a class, as one PDF (a page per
// student) or as a zip of separate pictures.
//
// A student's board lives on the student's own device (students never sign
// in, so nothing of theirs is in the database). To save it, the teacher's
// page asks each board for its contents over the live connection, the same
// way it does when the teacher opens that board, and draws a picture of it
// here, in the browser. Nothing is uploaded anywhere.
//
// The PDF and the zip are written by the small functions at the bottom, so
// the app needs no extra library for them.

import { supabase } from "./supabaseClient";
import { normalizeBackground } from "./boardBackground";
import { loadBoardImages, renderBoardPicture } from "./boardRender";
import { studentBoardId } from "./localBoard";

// ---------- asking a board for its contents ----------

// Resolves with { strokes, texts, images, grid, background, teacherInk }, or
// null if the board didn't answer in time (the student has gone, or their
// connection has dropped).
//
// Nothing else on this page may be connected to the same board while this
// runs: the live-connection library keeps one connection per board, and
// closing ours would close theirs.
//
// `job`, if given, is { cancelled, abort }: collectBoard sets job.abort to a
// function that stops at once (closing the connection), for a caller that
// is giving up (see makeSaveJob).
export function collectBoard(boardId, { timeoutMs = 7000, job = null } = {}) {
  return new Promise((resolve) => {
    if (job && job.cancelled) {
      resolve(null);
      return;
    }
    const channel = supabase.channel(`board-${boardId}`, { config: { broadcast: { self: false } } });
    let settled = false;
    let board = null;
    let collecting = null; // { id, expected, received } while a big board arrives in pieces
    let askTimer = null;
    let giveUpTimer = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearInterval(askTimer);
      clearTimeout(giveUpTimer);
      if (job) job.abort = null;
      supabase.removeChannel(channel);
      resolve(result);
    };
    if (job) job.abort = () => finish(null);
    const merge = (kind, list) => {
      if (!Array.isArray(list) || !list.length) return;
      const ids = new Set(list.map((o) => o.id));
      board[kind] = [...board[kind].filter((o) => !ids.has(o.id)), ...list];
    };
    const ask = () => {
      // (v: 2 with no "watch": the board's contents are wanted once, and
      // nobody is going to be looking at it afterwards; see boardWatch.js)
      if (!board && !settled) channel.send({ type: "broadcast", event: "classroom-state-request", payload: { v: 2 } });
    };

    channel.on("broadcast", { event: "classroom-state-snapshot" }, ({ payload }) => {
      if (board || !payload) return;
      board = {
        strokes: [], texts: [], images: [], teacherInk: [],
        grid: payload.grid || null,
        background: normalizeBackground(payload.background),
      };
      if (payload.pieces) {
        collecting = { id: payload.snapshotId, expected: payload.pieces, received: 0 };
        // The pieces follow at once; if one never arrives, save what did.
        clearTimeout(giveUpTimer);
        giveUpTimer = setTimeout(() => finish(board), timeoutMs);
      } else {
        merge("strokes", payload.strokes);
        merge("texts", payload.texts);
        merge("images", payload.images);
        merge("teacherInk", payload.teacherInk);
        finish(board);
      }
    });
    channel.on("broadcast", { event: "classroom-state-piece" }, ({ payload }) => {
      if (!collecting || !payload || payload.snapshotId !== collecting.id) return;
      collecting.received += 1;
      merge("strokes", payload.strokes);
      merge("texts", payload.texts);
      merge("images", payload.images);
      merge("teacherInk", payload.teacherInk);
    });
    channel.on("broadcast", { event: "classroom-state-done" }, ({ payload }) => {
      if (!collecting || !payload || payload.snapshotId !== collecting.id) return;
      finish(board);
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") ask();
    });
    askTimer = setInterval(ask, 2500);
    giveUpTimer = setTimeout(() => finish(board && !collecting ? board : null), timeoutMs);
  });
}

// ---------- pictures ----------

function canvasBytes(canvas, type, quality) {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(null);
            return;
          }
          blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), () => resolve(null));
        },
        type,
        quality
      );
    } catch (err) {
      // a picture from another site that can't be copied: the board is
      // drawn again without pictures by the caller
      resolve(null);
    }
  });
}

// Draws one student's board and returns it both ways it can be saved:
// { name, width, height, png, jpeg } (png / jpeg are bytes).
async function boardPictures({ name, board, question, note }) {
  const content = board || {};
  const layer = { question: question || null, ink: content.teacherInk || [] };
  const wanted = [...(content.images || []), ...((question && question.images) || [])];
  let pictures = await loadBoardImages(wanted);
  let made = renderBoardPicture({ content, layer, pictures, title: name, note, empty: board ? "Nothing on this board" : "This board couldn't be reached" });
  let png = await canvasBytes(made.canvas, "image/png");
  if (!png) {
    // Something on it can't be copied out of the browser: leave pictures as outlines.
    pictures = new Map();
    made = renderBoardPicture({ content, layer, pictures, title: name, note, empty: board ? "Nothing on this board" : "This board couldn't be reached" });
    png = await canvasBytes(made.canvas, "image/png");
  }
  const jpeg = await canvasBytes(made.canvas, "image/jpeg", 0.9);
  // Hand the picture's memory straight back (tablets allow a page only so
  // much canvas at once, and a class can be thirty boards).
  made.canvas.width = 0;
  made.canvas.height = 0;
  return { name, width: made.width, height: made.height, png, jpeg };
}

// Something a caller holds on to so it can stop saveClassBoards part way:
// job.cancel() stops after (and closes the connection of) whatever board is
// being fetched at that moment.
export function makeSaveJob() {
  return {
    cancelled: false,
    abort: null,
    cancel() {
      this.cancelled = true;
      if (this.abort) this.abort();
    },
  };
}

// A file name that every computer accepts, keeping letters of any alphabet.
export function safeFileName(text, fallback = "board") {
  const cleaned = Array.from(String(text || ""))
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join("")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[ .]+|[ .]+$/g, "")
    .slice(0, 60);
  return cleaned || fallback;
}

// Two students called Sam become "Sam" and "Sam (2)".
export function uniqueNames(names) {
  const seen = new Map();
  return names.map((raw) => {
    const base = safeFileName(raw, "Student");
    const key = base.toLowerCase();
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

// Collects every student's board, one after another, and builds both files.
//   students   [{ studentId, name }]
//   onProgress ({ done, total, name }) as each board comes in
// Resolves with { pdf, zip, saved: [names], missed: [names] } where pdf and
// zip are Blobs (null if there was nothing to put in them).
export async function saveClassBoards({ code, students, question = null, boardName = "", onProgress, job = null }) {
  const isCancelled = () => !!(job && job.cancelled);
  const day = new Date();
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const note = [boardName, date].filter(Boolean).join(" · ");
  const names = uniqueNames(students.map((s) => s.name));
  const pages = [];
  const saved = [];
  const missed = [];
  for (let i = 0; i < students.length; i++) {
    if (isCancelled()) return null;
    const student = students[i];
    if (onProgress) onProgress({ done: i, total: students.length, name: student.name });
    const board = await collectBoard(studentBoardId(code, student.studentId), { job });
    if (isCancelled()) return null;
    if (!board) {
      missed.push(student.name);
      continue;
    }
    const made = await boardPictures({ name: student.name, board, question, note });
    if (isCancelled()) return null;
    if (!made.png && !made.jpeg) {
      missed.push(student.name);
      continue;
    }
    saved.push(student.name);
    pages.push({ ...made, fileName: names[i] });
  }
  if (onProgress) onProgress({ done: students.length, total: students.length, name: "" });
  const pdfPages = pages.filter((p) => p.jpeg);
  const zipFiles = pages.filter((p) => p.png).map((p) => ({ name: `${p.fileName}.png`, bytes: p.png }));
  return {
    pdf: pdfPages.length ? new Blob([makePdf(pdfPages)], { type: "application/pdf" }) : null,
    zip: zipFiles.length ? new Blob([makeZip(zipFiles)], { type: "application/zip" }) : null,
    saved,
    missed,
    date,
  };
}

// ---------- a PDF with one picture per page ----------

const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

function ascii(text) {
  return encoder.encode(text);
}

function joinBytes(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// pages: [{ jpeg (bytes), width, height }] with the picture's size in
// pixels. Each page is A4, turned whichever way suits the picture, with the
// picture as large as fits inside a small margin.
export function makePdf(pages) {
  const A4 = { short: 595.28, long: 841.89 };
  const MARGIN = 24;
  const parts = [];
  const offsets = [0]; // object number -> where it starts
  let length = 0;
  const push = (bytes) => {
    parts.push(bytes);
    length += bytes.length;
  };
  const startObject = (n) => {
    offsets[n] = length;
    push(ascii(`${n} 0 obj\n`));
  };
  const endObject = () => push(ascii("\nendobj\n"));

  // %PDF header, then a line of high bytes so tools treat the file as binary
  push(ascii("%PDF-1.4\n"));
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  // objects: 1 catalog, 2 page list, then three per page (page, drawing, picture)
  const pageObject = (i) => 3 + i * 3;
  startObject(1);
  push(ascii("<< /Type /Catalog /Pages 2 0 R >>"));
  endObject();
  startObject(2);
  push(ascii(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObject(i)} 0 R`).join(" ")}] >>`));
  endObject();

  pages.forEach((page, i) => {
    const landscape = page.width >= page.height;
    const pw = landscape ? A4.long : A4.short;
    const ph = landscape ? A4.short : A4.long;
    const fit = Math.min((pw - MARGIN * 2) / page.width, (ph - MARGIN * 2) / page.height);
    const w = page.width * fit;
    const h = page.height * fit;
    const x = (pw - w) / 2;
    const y = ph - MARGIN - h; // from the top
    const n = pageObject(i);
    const draw = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`;

    startObject(n);
    push(ascii(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] ` +
      `/Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`
    ));
    endObject();

    startObject(n + 1);
    push(ascii(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`));
    endObject();

    startObject(n + 2);
    push(ascii(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`
    ));
    push(page.jpeg);
    push(ascii("\nendstream"));
    endObject();
  });

  const count = 3 + pages.length * 3;
  const xrefAt = length;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) xref += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  push(ascii(xref));
  push(ascii(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`));
  return joinBytes(parts);
}

// ---------- a zip (files stored as they are; pictures are already compressed) ----------

let crcTable = null;

function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// files: [{ name, bytes }]
export function makeZip(files, when = new Date()) {
  const dosTime = (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2);
  const dosDate = ((Math.max(1980, when.getFullYear()) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.bytes);
    const size = file.bytes.length;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // names are UTF-8
    local.setUint16(8, 0, true); // stored, not compressed
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, file.bytes);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true); // made by
    entry.setUint16(6, 20, true); // version needed
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, dosTime, true);
    entry.setUint16(14, dosDate, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, size, true);
    entry.setUint32(24, size, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true); // (extra, comment, disk, attributes: all zero)
    central.push(new Uint8Array(entry.buffer), name);

    offset += 30 + name.length + size;
  }
  let centralSize = 0;
  for (const c of central) centralSize += c.length;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return joinBytes([...parts, ...central, new Uint8Array(end.buffer)]);
}
