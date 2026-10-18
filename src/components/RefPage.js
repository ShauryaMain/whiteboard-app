"use client";

import { memo, useEffect, useRef, useState } from "react";
import { drawInkLayer, drawTopLayer } from "@/lib/refDoc";
import { drawPage, pageBaseSize } from "@/lib/refPdf";
import s from "./RefPane.module.css";

// How far beyond the visible part of the document a page is drawn, so
// scrolling never shows a blank page.
const NEAR_MARGIN_PX = 1200;
// A page's canvases never go past this many pixels (iPads refuse very large
// canvases, and memory runs out): deep zooms are a little softer instead.
const MAX_PAGE_PIXELS = 8e6;

export function canvasRatio(width, height) {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const want = Math.min(dpr, 2);
  const cap = Math.sqrt(MAX_PAGE_PIXELS / Math.max(1, width * height));
  return Math.max(0.25, Math.min(want, cap));
}

function sizeCanvas(canvas, width, height, ratio) {
  const w = Math.max(1, Math.round(width * ratio));
  const h = Math.max(1, Math.round(height * ratio));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}

function sameList(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameSet(a, b) {
  if (a === b) return true;
  const as = a ? a.size : 0, bs = b ? b.size : 0;
  if (as !== bs) return false;
  if (!as) return true;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// Draws the PDF page (or picture, or blank page) into the canvas at its
// current size. Returns a function that stops a drawing still under way.
function renderBase(canvas, width, height, pdfDoc, entry, image) {
  let stopped = false;
  let task = null;
  const ratio = canvasRatio(width, height);
  const w = Math.max(1, Math.round(width * ratio));
  const h = Math.max(1, Math.round(height * ratio));
  // drawn off-screen first, so a page never shows half-drawn
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const ctx = off.getContext("2d");
  const finish = () => {
    if (stopped) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    canvas.getContext("2d").drawImage(off, 0, 0);
  };
  if (entry.kind === "pdf" && pdfDoc) {
    pdfDoc
      .getPage(entry.src)
      .then((page) => {
        if (stopped) return null;
        const base = page.getViewport({ scale: 1, rotation: (page.rotate + (entry.rotate || 0)) % 360 });
        const viewport = page.getViewport({ scale: w / base.width, rotation: (page.rotate + (entry.rotate || 0)) % 360 });
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        task = page.render({ canvasContext: ctx, viewport });
        return task.promise;
      })
      .then(finish)
      .catch((err) => {
        if (!stopped && !(err && err.name === "RenderingCancelledException")) console.error("Couldn't draw page", err);
      });
  } else {
    // a picture or a blank page
    pageBaseSize(pdfDoc, entry, image)
      .then((base) => (stopped ? null : drawPage(ctx, { pdfDoc, entry, image }, w / (base.w || 1000))))
      .then(finish, () => {});
  }
  return () => {
    stopped = true;
    if (task) {
      try {
        task.cancel();
      } catch (err) {
        // already finished
      }
    }
  };
}

// One page of the reference document: the page itself, the markings on it,
// and a "live" layer for whatever is being drawn right now (registered with
// the pane through `register`). Only pages near the visible part of the
// document hold canvases; the rest are placeholders of the right size.
function RefPage({
  entry, number, left, top, width, height, scrollRoot, pdfDoc, image, marks, hidden, editingId,
  register, highlights, flash,
}) {
  const wrapRef = useRef(null);
  const baseRef = useRef(null);
  const marksRef = useRef(null);
  const liveRef = useRef(null);
  const drawnRef = useRef({ marks: null, hidden: null, editingId: null, width: 0, height: 0 });
  const [near, setNear] = useState(number <= 3);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !scrollRoot || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => setNear(entries[0].isIntersecting), {
      root: scrollRoot,
      rootMargin: `${NEAR_MARGIN_PX}px ${NEAR_MARGIN_PX}px`,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRoot]);

  // the page itself (a moment after the size settles, so a zoom doesn't
  // redraw it at every step)
  useEffect(() => {
    const canvas = baseRef.current;
    if (!near || !canvas || width < 2) return;
    let stop = null;
    const timer = setTimeout(() => {
      stop = renderBase(canvas, width, height, pdfDoc, entry, image);
    }, 60);
    return () => {
      clearTimeout(timer);
      if (stop) stop();
    };
  }, [near, width, height, pdfDoc, entry, image]);

  // the markings
  useEffect(() => {
    const canvas = marksRef.current;
    if (!near || !canvas || width < 2) return;
    const drawn = drawnRef.current;
    if (drawn.width === width && drawn.height === height && sameList(drawn.marks, marks) && sameSet(drawn.hidden, hidden) && drawn.editingId === editingId) return;
    const ctx = sizeCanvas(canvas, width, height, canvasRatio(width, height));
    ctx.clearRect(0, 0, width, height);
    drawInkLayer(ctx, marks, width, height, hidden);
    drawTopLayer(ctx, marks, width, height, hidden, editingId);
    drawnRef.current = { marks, hidden, editingId, width, height };
  }, [near, width, height, marks, hidden, editingId]);

  // the live layer: sized here, drawn on by the pane
  useEffect(() => {
    const canvas = liveRef.current;
    if (!near || !canvas) {
      register(entry.id, null);
      return;
    }
    const ratio = canvasRatio(width, height);
    sizeCanvas(canvas, width, height, ratio);
    register(entry.id, { canvas, width, height, ratio });
    return () => register(entry.id, null);
  }, [near, width, height, entry.id, register]);

  // (a page that comes back into view draws its markings again)
  useEffect(() => {
    if (!near) drawnRef.current = { marks: null, hidden: null, editingId: null, width: 0, height: 0 };
  }, [near]);

  return (
    <div
      ref={wrapRef}
      className={s.page}
      data-ref-page={number}
      style={{ left, top, width, height }}
    >
      {near ? (
        <>
          <canvas ref={baseRef} className={s.layer} />
          <canvas ref={marksRef} className={s.layer} />
          <canvas ref={liveRef} className={s.layer} />
        </>
      ) : (
        <div className={s.pagePlaceholder}>{number}</div>
      )}
      {(highlights || []).map((r, i) => (
        <span
          key={i}
          className={s.hit}
          style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
        />
      ))}
      {flash && (
        <span
          key={flash.key}
          className={s.flash}
          style={{ left: `${flash.x * 100}%`, top: `${flash.y * 100}%`, width: `${flash.w * 100}%`, height: `${flash.h * 100}%` }}
        />
      )}
    </div>
  );
}

export default memo(RefPage);
