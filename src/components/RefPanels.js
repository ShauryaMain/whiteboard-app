"use client";

import { useEffect, useRef, useState } from "react";
import { FilePlus2, RotateCw, Trash2, Plus, X } from "lucide-react";
import { drawPage, findInPage, pageBaseSize, pageTextIndex } from "@/lib/refPdf";
import s from "./RefPane.module.css";

const THUMB_W = 220;

// One page's small picture (drawn when it scrolls into the panel).
function Thumb({ entry, pdfDoc, image, number, active, onPress, root }) {
  const canvasRef = useRef(null);
  const [visible, setVisible] = useState(number <= 6);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el || !root || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((list) => {
      if (list[0].isIntersecting) setVisible(true);
    }, { root, rootMargin: "400px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!visible || !canvas) return;
    if (entry.kind === "pdf" && !pdfDoc) return;
    if (entry.kind === "image" && !image) return;
    let cancelled = false;
    pageBaseSize(pdfDoc, entry, image).then((base) => {
      if (cancelled) return null;
      const ratio = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
      const w = Math.round(THUMB_W * ratio);
      const scale = w / base.w;
      const off = document.createElement("canvas");
      off.width = w;
      off.height = Math.round(base.h * scale);
      return drawPage(off.getContext("2d"), { pdfDoc, entry, image }, scale).then(() => {
        if (cancelled) return;
        canvas.width = off.width;
        canvas.height = off.height;
        canvas.getContext("2d").drawImage(off, 0, 0);
      });
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [visible, entry, pdfDoc, image]);

  return (
    <button type="button" className={`${s.thumbBtn} ${active ? s.thumbOn : ""}`} onClick={onPress} aria-label={`Go to page ${number}`} aria-current={active ? "page" : undefined}>
      <canvas ref={canvasRef} width={THUMB_W} height={Math.round(THUMB_W * 1.41)} />
      <span className={s.thumbNum}>{number}</span>
    </button>
  );
}

// The pages of the document: tap one to go to it. The board's owner can
// also turn a page, take it out, add a blank / lined / graph page after
// it, or add pages from another file.
export function RefPagesPanel({ doc, pdfDoc, images, currentPage, canEdit, canAdd, onGo, onRotate, onRemove, onAddBlank, onAddFromFile, onClose }) {
  const [root, setRoot] = useState(null);
  const [adding, setAdding] = useState(null); // page id the "add a page after" choices are open for
  const pages = doc.pages;

  return (
    <div className={s.panel} role="dialog" aria-label="Pages">
      <div className={s.panelHeader}>
        <span>Pages ({pages.length})</span>
        <button type="button" className={s.toolBtn} onClick={onClose} aria-label="Close pages">
          <X size={18} strokeWidth={2} />
        </button>
      </div>
      <div className={s.panelBody} ref={setRoot}>
        {pages.map((p, i) => (
          <div key={p.id} className={s.thumbRow}>
            <Thumb
              entry={p}
              pdfDoc={pdfDoc}
              image={p.kind === "image" ? images[p.url] : null}
              number={i + 1}
              active={i === currentPage}
              onPress={() => onGo(i)}
              root={root}
            />
            {canEdit && (
              <div className={s.thumbActions}>
                <button type="button" className={s.smallBtn} onClick={() => onRotate(p.id)} aria-label={`Turn page ${i + 1}`}>
                  <RotateCw size={14} strokeWidth={2} />
                  Turn
                </button>
                {canAdd && (
                  <button type="button" className={s.smallBtn} onClick={() => setAdding(adding === p.id ? null : p.id)} aria-expanded={adding === p.id} aria-label={`Add a page after page ${i + 1}`}>
                    <Plus size={14} strokeWidth={2} />
                    Page after
                  </button>
                )}
                {pages.length > 1 && (
                  <button type="button" className={`${s.smallBtn} ${s.smallBtnDanger}`} onClick={() => onRemove(p.id)} aria-label={`Take out page ${i + 1}`}>
                    <Trash2 size={14} strokeWidth={2} />
                  </button>
                )}
              </div>
            )}
            {canEdit && adding === p.id && (
              <div className={s.addMenu}>
                {[["blank", "Blank"], ["lined", "Lined"], ["graph", "Graph"]].map(([style, label]) => (
                  <button
                    key={style}
                    type="button"
                    className={s.smallBtn}
                    onClick={() => {
                      onAddBlank(p.id, style);
                      setAdding(null);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {canEdit && canAdd && onAddFromFile && (
          <button type="button" className={s.smallBtn} style={{ height: 42, justifyContent: "center" }} onClick={onAddFromFile}>
            <FilePlus2 size={16} strokeWidth={2} />
            Add pages from a file
          </button>
        )}
      </div>
    </div>
  );
}

function Snippet({ text, query }) {
  const lower = text.toLowerCase();
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  const at = q ? lower.indexOf(q) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <b>{text.slice(at, at + q.length)}</b>
      {text.slice(at + q.length)}
    </>
  );
}

// Finding words in the PDF: every place they appear, page by page.
export function RefSearchPanel({ doc, pdfDoc, onGo, onClose }) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState(null); // { q, list }
  const [active, setActive] = useState(-1);
  const cacheRef = useRef(new Map());

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const list = [];
      for (let i = 0; i < doc.pages.length; i++) {
        const entry = doc.pages[i];
        if (entry.kind !== "pdf") continue;
        const key = `${entry.src}-${entry.rotate || 0}`;
        let index = cacheRef.current.get(key);
        if (!index) {
          index = await pageTextIndex(pdfDoc, entry).catch(() => null);
          if (index) cacheRef.current.set(key, index);
        }
        if (cancelled) return;
        for (const hit of findInPage(index, q)) {
          list.push({ pageId: entry.id, page: i + 1, rects: hit.rects, snippet: hit.snippet });
          if (list.length >= 100) break;
        }
        if (list.length >= 100) break;
      }
      if (cancelled) return;
      setFound({ q, list });
      setActive(-1);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, doc, pdfDoc]);

  const results = found && found.q === query.trim() ? found.list : null;

  return (
    <div className={`${s.panel} ${s.panelWide}`} role="dialog" aria-label="Find in the document">
      <div className={s.panelHeader}>
        <span>Find in the document</span>
        <button type="button" className={s.toolBtn} onClick={onClose} aria-label="Close find">
          <X size={18} strokeWidth={2} />
        </button>
      </div>
      <div className={s.searchBox}>
        <input
          className={s.searchInput}
          type="search"
          value={query}
          autoFocus
          placeholder="e.g. Question 7"
          aria-label="Words to find"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results && results.length) {
              const next = (active + 1) % results.length;
              setActive(next);
              onGo(results[next].pageId, results[next].rects);
            }
          }}
        />
      </div>
      <div className={s.panelBody}>
        {!results && query.trim().length >= 2 && <p className={s.muted}>Looking…</p>}
        {results && !results.length && (
          <p className={s.muted}>Not found. (Scanned pages are pictures of text, so their words can&apos;t be searched.)</p>
        )}
        {results && results.length > 0 && <p className={s.muted}>{results.length >= 100 ? "100+" : results.length} found</p>}
        {(results || []).map((r, i) => (
          <button
            key={`${r.pageId}-${i}`}
            type="button"
            className={`${s.result} ${i === active ? s.resultOn : ""}`}
            onClick={() => {
              setActive(i);
              onGo(r.pageId, r.rects);
            }}
          >
            <span className={s.muted}>Page {r.page} · </span>
            <Snippet text={r.snippet} query={query} />
          </button>
        ))}
      </div>
    </div>
  );
}
