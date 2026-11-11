"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Download, FileUp, Pencil, Plus, RectangleHorizontal, RectangleVertical, Star, Trash2, X } from "lucide-react";
import { NOTEBOOK_PAPERS, PAGE_SIZES, paintPaper, pageSize } from "@/lib/notebook";
import { parsePageRange } from "@/lib/notebookRender";
import d from "./Dialog.module.css";
import n from "./Notebook.module.css";

// A small picture of a paper (for choosing one).
export function PaperPreview({ paper, color = "#ffffff", width = 72 }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ratio = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
    const pageW = PAGE_SIZES.a4.w;
    const pageH = PAGE_SIZES.a4.h;
    const scale = (width * ratio) / pageW;
    canvas.width = Math.round(pageW * scale);
    canvas.height = Math.round(pageH * 0.55 * scale);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    paintPaper(ctx, { x: 0, y: 0, w: pageW, h: pageH }, paper, color, Math.max(scale, 0.35), null);
  }, [paper, color, width]);
  return <canvas ref={ref} aria-hidden="true" />;
}

// The choice of paper for a page. `compact`: smaller, four to a row (in
// the toolbar's Page menu, which has to fit on a phone).
export function PaperChoices({ value, color, onPick, compact = false }) {
  return (
    <div className={`${n.papers} ${compact ? n.papersCompact : ""}`} role="radiogroup" aria-label="Paper">
      {NOTEBOOK_PAPERS.map((p) => (
        <button
          key={p.id}
          type="button"
          role="radio"
          aria-checked={value === p.id}
          title={p.desc}
          className={`${n.paperTile} ${value === p.id ? n.paperOn : ""}`}
          onClick={() => onPick(p.id)}
        >
          <PaperPreview paper={p.id} color={color} width={compact ? 56 : 72} />
          <span>{p.label}</span>
        </button>
      ))}
    </div>
  );
}

// The pages of a notebook, down the left: tap one to go to it. Three views:
//   Pages     a picture of each page. The owner can also move, add, copy,
//             turn, star and take out pages, export the notebook and bring
//             in pages from a PDF.
//   Contents  every page's title (pageTitles.js), which the owner can
//             change.
//   Starred   only the starred pages.
// The view chosen is remembered on this device.
const VIEW_KEY = "cleanslate_pages_view";
function savedView() {
  try {
    const v = window.localStorage.getItem(VIEW_KEY);
    return v === "contents" || v === "starred" ? v : "pages";
  } catch (err) {
    return "pages";
  }
}

export function NotebookPagesPanel({
  notebook, current, canEdit, thumbs, titles = [], onJump, onAddAfter, onDuplicate, onDelete, onMove, onTurn, onExport, onImport,
  onClose, onRename, onStar, busy,
}) {
  const bodyRef = useRef(null);
  const count = notebook.pages.length;
  const [view, setView] = useState(savedView);
  const [editing, setEditing] = useState(null); // { id, value }
  const starredCount = notebook.pages.filter((p) => p.star).length;

  function choose(v) {
    setView(v);
    setEditing(null);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch (err) {
      // storage switched off: it just isn't remembered
    }
  }

  // the page that's on screen, in view in the panel when it opens (or the
  // view changes)
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const el = body.querySelector('[data-current="true"]');
    // (only the panel scrolls: scrollIntoView would also move the board
    // underneath, and the panel's own heading off the top)
    if (el) body.scrollTop = Math.max(0, el.offsetTop - body.offsetTop - (body.clientHeight - el.offsetHeight) / 2);
  }, [view]);

  const titleOf = (i) => (titles[i] && titles[i].title) || `Page ${i + 1}`;

  function saveTitle() {
    if (!editing) return;
    const i = notebook.pages.findIndex((p) => p.id === editing.id);
    const value = editing.value;
    setEditing(null);
    if (i >= 0 && onRename) onRename(i, value);
  }

  function starButton(page, i, small = false) {
    if (!canEdit && !page.star) return null;
    const label = page.star ? `Unstar page ${i + 1}` : `Star page ${i + 1}`;
    return (
      <button
        type="button"
        className={`${n.btn} ${n.btnIcon} ${page.star ? n.starOn : ""} ${small ? n.btnSmall : ""}`}
        onClick={canEdit ? () => onStar(i, !page.star) : undefined}
        disabled={busy || !canEdit}
        aria-label={label}
        aria-pressed={!!page.star}
        title={canEdit ? (page.star ? "Starred: tap to unstar" : "Star this page") : "Starred"}
        data-page-star={page.id}
      >
        <Star size={small ? 14 : 15} fill={page.star ? "currentColor" : "none"} />
      </button>
    );
  }

  function titleRow(page, i) {
    const on = i === current;
    const t = titles[i];
    if (editing && editing.id === page.id) {
      return (
        <form
          key={page.id}
          className={`${n.contentRow} ${on ? n.contentRowOn : ""}`}
          data-current={on ? "true" : undefined}
          onSubmit={(e) => {
            e.preventDefault();
            saveTitle();
          }}
        >
          <span className={n.contentNum}>{i + 1}</span>
          <input
            className={n.titleInput}
            value={editing.value}
            maxLength={80}
            autoFocus
            placeholder={t && t.from !== "typed" ? t.title : `Page ${i + 1}`}
            aria-label={`Title of page ${i + 1}`}
            onChange={(e) => setEditing({ id: page.id, value: e.target.value })}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setEditing(null);
              }
            }}
            data-title-input="true"
          />
        </form>
      );
    }
    return (
      <div key={page.id} className={`${n.contentRow} ${on ? n.contentRowOn : ""}`} data-current={on ? "true" : undefined} data-content-row={page.id}>
        <button type="button" className={n.contentJump} onClick={() => onJump(i)} aria-current={on ? "page" : undefined}>
          <span className={n.contentNum}>{i + 1}</span>
          <span className={`${n.contentTitle} ${t && t.from === "number" ? n.contentTitleQuiet : ""}`}>{titleOf(i)}</span>
        </button>
        {canEdit && onRename && (
          <button
            type="button"
            className={`${n.btn} ${n.btnIcon} ${n.btnSmall}`}
            onClick={() => setEditing({ id: page.id, value: page.title || "" })}
            aria-label={`Rename page ${i + 1}`}
            title="Give this page a title"
            data-page-rename={page.id}
          >
            <Pencil size={14} />
          </button>
        )}
        {starButton(page, i, true)}
      </div>
    );
  }

  return (
    <aside className={n.panel} role="dialog" aria-label="Pages" data-notebook-panel="true">
      <div className={n.head}>
        <span>
          Pages <small style={{ fontWeight: 600, color: "var(--ink-2)" }}>({count})</small>
        </span>
        <button type="button" className={n.close} onClick={onClose} aria-label="Close pages">
          <X size={18} />
        </button>
      </div>
      <div className={n.viewTabs} role="tablist" aria-label="Show">
        {[
          ["pages", "Pages"],
          ["contents", "Contents"],
          ["starred", starredCount ? `Starred (${starredCount})` : "Starred"],
        ].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} className={`${n.viewTab} ${view === id ? n.viewTabOn : ""}`} onClick={() => choose(id)} data-pages-view={id}>
            {label}
          </button>
        ))}
      </div>
      {view === "pages" && (
        <div className={n.headActions}>
          <button type="button" className={n.btn} onClick={onExport}>
            <Download size={15} /> Export PDF
          </button>
          {canEdit && (
            <button type="button" className={n.btn} onClick={onImport} disabled={busy}>
              <FileUp size={15} /> Add pages from a PDF
            </button>
          )}
        </div>
      )}
      <div className={`${n.body} ${view !== "pages" ? n.bodyList : ""}`} ref={bodyRef}>
        {view === "contents" && notebook.pages.map((page, i) => titleRow(page, i))}
        {view === "starred" &&
          (starredCount ? (
            notebook.pages.map((page, i) => (page.star ? titleRow(page, i) : null))
          ) : (
            <p className={n.note} style={{ margin: 4 }}>
              {canEdit ? "Star a page (☆ in Pages or Contents) to find it here quickly." : "No pages are starred."}
            </p>
          ))}
        {view === "pages" &&
          notebook.pages.map((page, i) => {
            const { w, h } = pageSize(notebook, page);
            const on = i === current;
            return (
              <div key={page.id} className={n.row} data-current={on ? "true" : undefined}>
                <button
                  type="button"
                  className={`${n.thumb} ${on ? n.thumbOn : ""}`}
                  onClick={() => onJump(i)}
                  aria-label={`Go to page ${i + 1}: ${titleOf(i)}`}
                  aria-current={on ? "page" : undefined}
                >
                  {thumbs && thumbs[page.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbs[page.id]} alt="" />
                  ) : (
                    <span className={n.thumbBlank} style={{ aspectRatio: `${w} / ${h}` }} />
                  )}
                  <span className={n.num}>{i + 1}</span>
                  {page.star && (
                    <span className={n.thumbStar} aria-hidden="true">
                      <Star size={14} fill="currentColor" />
                    </span>
                  )}
                </button>
                {titles[i] && titles[i].from !== "number" && <span className={n.thumbTitle}>{titleOf(i)}</span>}
                {canEdit && (
                  <div className={n.actions}>
                    <button type="button" className={`${n.btn} ${n.btnIcon}`} onClick={() => onMove(i, i - 1)} disabled={busy || i === 0} aria-label={`Move page ${i + 1} up`} title="Move up">
                      <ArrowUp size={15} />
                    </button>
                    <button type="button" className={`${n.btn} ${n.btnIcon}`} onClick={() => onMove(i, i + 1)} disabled={busy || i === count - 1} aria-label={`Move page ${i + 1} down`} title="Move down">
                      <ArrowDown size={15} />
                    </button>
                    <button type="button" className={`${n.btn} ${n.btnIcon}`} onClick={() => onAddAfter(i)} disabled={busy} aria-label={`Add a page after page ${i + 1}`} title="Add a page after this one">
                      <Plus size={15} />
                    </button>
                    <button type="button" className={`${n.btn} ${n.btnIcon}`} onClick={() => onDuplicate(i)} disabled={busy} aria-label={`Copy page ${i + 1}`} title="Copy this page">
                      <Copy size={15} />
                    </button>
                    {!page.bg && (
                      <button
                        type="button"
                        className={`${n.btn} ${n.btnIcon}`}
                        onClick={() => onTurn(i)}
                        disabled={busy}
                        aria-label={page.landscape ? `Turn page ${i + 1} upright` : `Turn page ${i + 1} sideways`}
                        title={page.landscape ? "Turn upright" : "Turn sideways"}
                      >
                        {page.landscape ? <RectangleVertical size={15} /> : <RectangleHorizontal size={15} />}
                      </button>
                    )}
                    {onStar && starButton(page, i)}
                    <button
                      type="button"
                      className={`${n.btn} ${n.btnIcon} ${n.btnDanger}`}
                      onClick={() => onDelete(i)}
                      disabled={busy || count <= 1}
                      aria-label={`Delete page ${i + 1}`}
                      title={count <= 1 ? "A notebook keeps at least one page" : "Delete this page"}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </aside>
  );
}

// Picking a page (for a link): the pages by title.
export function PagePickDialog({ notebook, titles = [], current, onPick, onClose }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const list = notebook.pages
    .map((page, i) => ({ page, i, title: (titles[i] && titles[i].title) || `Page ${i + 1}` }))
    .filter((r) => !needle || r.title.toLowerCase().includes(needle) || String(r.i + 1) === needle);
  return (
    <div className={d.overlay} onClick={onClose} data-page-pick="true">
      <div className={d.card} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="page-pick-title" style={{ width: 420 }}>
        <div className={d.header}>
          <div className={d.titleBlock}>
            <h2 id="page-pick-title" className={d.title}>Link to a page</h2>
            <p className={d.subtitle}>A small ↗ tag goes beside what you selected. Tap it to jump to the page.</p>
          </div>
          <button type="button" className={d.close} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <input
          className={d.input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a page by title or number"
          aria-label="Find a page"
          autoFocus
        />
        <div className={n.pickList}>
          {list.map((r) => (
            <button
              key={r.page.id}
              type="button"
              className={`${n.contentJump} ${n.pickRow}`}
              onClick={() => onPick(r.page.id)}
              disabled={r.i === current}
              title={r.i === current ? "This is the page you're on" : undefined}
              data-pick-page={r.page.id}
            >
              <span className={n.contentNum}>{r.i + 1}</span>
              <span className={n.contentTitle}>{r.title}</span>
              {r.page.star && <Star size={13} fill="currentColor" className={n.pickStar} />}
            </button>
          ))}
          {!list.length && <p className={n.note}>No page matches that.</p>}
        </div>
      </div>
    </div>
  );
}

// Exporting: every page, this page, or some pages, as one PDF.
export function NotebookExportDialog({ name, count, current, hasTape = false, onExport, onClose }) {
  const [which, setWhich] = useState("all");
  const [withTape, setWithTape] = useState(false);
  const [range, setRange] = useState("");
  const [phase, setPhase] = useState("ready"); // ready | working | done | failed
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null); // { url, file }
  const jobRef = useRef(null);
  const urlRef = useRef(null);

  useEffect(() => () => {
    if (jobRef.current) jobRef.current.cancelled = true;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const picked = which === "all" ? null : which === "this" ? [current] : parsePageRange(range, count);
  const rangeBad = which === "some" && (!picked || !picked.length);

  function start() {
    if (rangeBad) return;
    const job = { cancelled: false };
    jobRef.current = job;
    setPhase("working");
    setProgress({ done: 0, total: picked ? picked.length : count });
    onExport({
      indices: picked,
      job,
      tape: hasTape && withTape ? "cover" : "hide",
      onProgress: (done, total) => {
        if (!job.cancelled) setProgress({ done, total });
      },
    }).then(
      (blob) => {
        if (job.cancelled) return;
        if (!blob) {
          setPhase("failed");
          return;
        }
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        const base = String(name || "Notebook").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 80) || "Notebook";
        const suffix = which === "this" ? ` - page ${current + 1}` : which === "some" ? ` - pages ${range.replace(/\s+/g, "")}` : "";
        setResult({ url, file: `${base}${suffix}.pdf` });
        setPhase("done");
      },
      () => {
        if (!job.cancelled) setPhase("failed");
      }
    );
  }

  return (
    <div className={d.overlay} onClick={phase === "working" ? undefined : onClose}>
      <div
        className={d.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nb-export-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && phase !== "working") onClose();
        }}
      >
        <div className={d.header}>
          <div className={d.titleBlock}>
            <h2 id="nb-export-title" className={d.title}>Export as a PDF</h2>
            <p className={d.subtitle}>Your pages exactly as they look, ready to print, share or hand in.</p>
          </div>
          <button type="button" className={d.close} onClick={onClose} aria-label="Close" disabled={phase === "working"}>
            <X size={18} />
          </button>
        </div>

        {(phase === "ready" || phase === "failed") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "4px 0 14px" }} role="radiogroup" aria-label="Which pages">
            <label className={n.choice}>
              <input type="radio" name="nb-which" checked={which === "all"} onChange={() => setWhich("all")} /> Every page ({count})
            </label>
            <label className={n.choice}>
              <input type="radio" name="nb-which" checked={which === "this"} onChange={() => setWhich("this")} /> This page (page {current + 1})
            </label>
            <label className={n.choice}>
              <input type="radio" name="nb-which" checked={which === "some"} onChange={() => setWhich("some")} /> Some pages
            </label>
            {which === "some" && (
              <label className={n.field}>
                Pages, like 1-3, 5
                <input type="text" inputMode="numeric" value={range} onChange={(e) => setRange(e.target.value)} placeholder="1-3, 5" autoFocus />
              </label>
            )}
            {which === "some" && range && rangeBad && <p className={n.note}>Type page numbers from 1 to {count}, like 1-3, 5.</p>}
            {hasTape && (
              <label className={n.choice} style={{ marginTop: 4 }}>
                <input type="checkbox" checked={withTape} onChange={(e) => setWithTape(e.target.checked)} data-export-tape="true" /> Keep the tape on (answers
                covered, for testing yourself on paper)
              </label>
            )}
            {phase === "failed" && (
              <p className={n.note} role="alert">
                The PDF couldn&apos;t be made. Nothing in your notebook has changed: please try again.
              </p>
            )}
          </div>
        )}

        {(phase === "ready" || phase === "failed") && (
          <div className={d.actions}>
            <button type="button" className={d.btn} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={`${d.btn} ${d.btnPrimary}`} onClick={start} disabled={rangeBad}>
              <Download size={16} /> Make the PDF
            </button>
          </div>
        )}

        {phase === "working" && (
          <div role="status" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 8, margin: "6px 0 14px" }}>
            <div className={n.progress}>
              <span style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
            </div>
            <div className={n.note}>
              Page {Math.min(progress.done + 1, progress.total)} of {progress.total}…
            </div>
          </div>
        )}

        {phase === "done" && result && (
          <>
            <p className={n.note} style={{ margin: "4px 0 14px" }}>
              Your PDF is ready.
            </p>
            <div className={d.actions}>
              <button type="button" className={d.btn} onClick={onClose}>
                Done
              </button>
              <a className={`${d.btn} ${d.btnPrimary}`} href={result.url} download={result.file} data-nb-download="true">
                <Download size={16} /> Download {result.file}
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
