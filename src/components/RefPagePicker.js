"use client";

import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { closePdf, openPdfUrl, parsePageList, describePageList } from "@/lib/refPdf";
import d from "./Dialog.module.css";
import s from "./RefPane.module.css";

const THUMB_W = 150;

// Small pictures of the pages, drawn one at a time as they scroll into view
// (a long textbook has hundreds).
function createThumbQueue() {
  const waiting = [];
  let busy = false;
  async function run() {
    if (busy) return;
    busy = true;
    while (waiting.length) {
      const job = waiting.shift();
      if (job.cancelled) continue;
      await job.work().catch(() => {});
    }
    busy = false;
  }
  return {
    add(work) {
      const job = { work, cancelled: false };
      waiting.push(job);
      run();
      return () => {
        job.cancelled = true;
      };
    },
  };
}

function PickThumb({ pdf, number, queue, root }) {
  const holderRef = useRef(null);
  const canvasRef = useRef(null);
  const [visible, setVisible] = useState(number <= 12);

  useEffect(() => {
    const el = holderRef.current;
    if (!el || !root || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((list) => {
      if (list[0].isIntersecting) setVisible(true);
    }, { root, rootMargin: "300px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    if (!visible || !pdf) return;
    return queue.add(async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const page = await pdf.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale: (THUMB_W * ratio) / base.width });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
    });
  }, [visible, pdf, number, queue]);

  return (
    <div ref={holderRef} className={s.pickThumb}>
      <canvas ref={canvasRef} width={1} height={1} />
    </div>
  );
}

// "Choose pages": for any PDF, pick up to `max` pages to put beside the
// board (only those are uploaded). Tap pages, shift-click for a run of
// them, or type them in ("1-5, 8").
export default function RefPagePicker({ url, fileName, max, adding = false, onCancel, onDone }) {
  const [pdf, setPdf] = useState(null);
  const [failed, setFailed] = useState(false);
  const [count, setCount] = useState(0);
  const [picked, setPicked] = useState(() => new Set());
  const [typed, setTyped] = useState("");
  const [root, setRoot] = useState(null);
  const [queue] = useState(createThumbQueue);
  const [last, setLast] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let loaded = null;
    openPdfUrl(url).then(
      (doc) => {
        if (cancelled) {
          closePdf(doc);
          return;
        }
        loaded = doc;
        setPdf(doc);
        setCount(doc.numPages);
        // a short PDF: every page, ready to go
        if (doc.numPages <= max) {
          const all = new Set();
          for (let i = 1; i <= doc.numPages; i++) all.add(i);
          setPicked(all);
        }
      },
      () => {
        if (!cancelled) setFailed(true);
      }
    );
    return () => {
      cancelled = true;
      closePdf(loaded);
    };
  }, [url, max]);

  function toggle(n, shift) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (shift && last) {
        const a = Math.min(last, n), b = Math.max(last, n);
        for (let i = a; i <= b && next.size < max; i++) next.add(i);
      } else if (next.has(n)) {
        next.delete(n);
      } else if (next.size < max) {
        next.add(n);
      }
      return next;
    });
    setLast(n);
  }

  function applyTyped() {
    const list = parsePageList(typed, count).slice(0, max);
    if (list.length) setPicked(new Set(list));
  }

  const over = picked.size >= max && count > max;
  const sorted = [...picked].sort((a, b) => a - b);

  return (
    <div className={d.overlay} role="dialog" aria-modal="true" aria-labelledby="ref-picker-title">
      <div className={s.pickerCard}>
        <div className={d.header}>
          <div className={d.titleBlock}>
            <h2 id="ref-picker-title" className={d.title}>
              {adding ? "Add pages" : "Choose pages"}
            </h2>
            <p className={d.subtitle}>
              {fileName}
              {count ? ` · ${count} pages. ` : ". "}
              {count > max ? `Pick up to ${max}: only those go beside the board.` : "Untick any you don't need."}
            </p>
          </div>
          <button type="button" className={d.close} onClick={onCancel} aria-label="Close">
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        {failed ? (
          <p className={d.subtitle}>Couldn&apos;t read that PDF: it may be damaged or password-protected.</p>
        ) : (
          <>
            <div className={s.pickerTools}>
              <input
                className={d.input}
                style={{ flex: "1 1 180px", height: 40 }}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyTyped();
                }}
                placeholder="Type pages, e.g. 1-5, 8"
                aria-label="Pages to pick, for example 1-5, 8"
              />
              <button type="button" className={d.btn} style={{ height: 40 }} onClick={applyTyped}>
                Pick these
              </button>
              {count <= max ? (
                <button type="button" className={d.btn} style={{ height: 40 }} onClick={() => setPicked(new Set(Array.from({ length: count }, (_, i) => i + 1)))}>
                  All
                </button>
              ) : null}
              <button type="button" className={d.btn} style={{ height: 40 }} onClick={() => setPicked(new Set())}>
                None
              </button>
            </div>
            <div className={s.pickerGrid} ref={setRoot}>
              {!pdf && <p className={d.subtitle}>Opening…</p>}
              {pdf &&
                Array.from({ length: count }, (_, i) => i + 1).map((n) => {
                  const on = picked.has(n);
                  return (
                    <button
                      key={n}
                      type="button"
                      className={`${s.pickTile} ${on ? s.pickTileOn : ""}`}
                      aria-pressed={on}
                      aria-label={`Page ${n}`}
                      onClick={(e) => toggle(n, e.shiftKey)}
                    >
                      <PickThumb pdf={pdf} number={n} queue={queue} root={root} />
                      Page {n}
                      <span className={s.pickCheck} aria-hidden="true">
                        {on && <Check size={14} strokeWidth={3} />}
                      </span>
                    </button>
                  );
                })}
            </div>
          </>
        )}
        <div className={s.pickerFooter}>
          <span className={`${s.pickerCount} ${over ? s.pickerWarn : ""}`}>
            {picked.size} of {Math.min(max, count || max)} picked
            {sorted.length ? ` (${describePageList(sorted)})` : ""}
            {over ? " · that's the most" : ""}
          </span>
          <button type="button" className={d.btn} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={`${d.btn} ${d.btnPrimary}`} disabled={!picked.size || failed} onClick={() => onDone(sorted, count)}>
            {adding ? `Add ${picked.size} page${picked.size === 1 ? "" : "s"}` : `Open ${picked.size} page${picked.size === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
