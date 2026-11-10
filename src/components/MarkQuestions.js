"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Trash2, X } from "lucide-react";
import { call, problemText, scoreText } from "@/lib/teaching";
import { contentsFromRows } from "@/lib/boardSync";
import { loadPagePictures, renderPage } from "@/lib/notebookRender";
import { track } from "@/lib/track";
import { fileUrlNow, useFileUrls } from "@/lib/fileUrls";
import d from "./Dialog.module.css";
import t from "./Teaching.module.css";

const newQid = () => "q" + Math.random().toString(36).slice(2, 8);

// ---------- marking out the questions ----------

// Boxes over a piece of homework's pages: Q1, Q2…, each worth some marks.
//   clip   clip_overview() (pages, questions, max_score)
export function QuestionEditor({ clip, onClose, onSaved }) {
  // (the homework page opens through a short-lived link: fileUrls.js)
  const filesVersion = useFileUrls();
  const [qs, setQs] = useState(() => (clip.questions || []).map((q) => ({ ...q, id: q.id || newQid() })));
  const [pageAt, setPageAt] = useState(0);
  const [draft, setDraft] = useState(null); // a box being drawn: { x0, y0, x1, y1 } (fractions)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const areaRef = useRef(null);
  const page = clip.pages[pageAt] || clip.pages[0];

  function frac(e) {
    const r = areaRef.current.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  }

  function down(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest && e.target.closest("[data-q-box]")) return;
    const p = frac(e);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {
      // fine without
    }
    setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  }

  function move(e) {
    if (!draft) return;
    const p = frac(e);
    setDraft({ ...draft, x1: p.x, y1: p.y });
  }

  function up() {
    if (!draft) return;
    const x = Math.min(draft.x0, draft.x1), y = Math.min(draft.y0, draft.y1);
    const w = Math.abs(draft.x1 - draft.x0), h = Math.abs(draft.y1 - draft.y0);
    setDraft(null);
    if (w < 0.03 || h < 0.02) return;
    setQs((prev) => [...prev, { id: newQid(), label: `Q${prev.length + 1}`, page: pageAt, x, y, w, h, marks: null }]);
  }

  const edit = (id, patch) => setQs((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  const total = qs.reduce((n, q) => n + (Number(q.marks) || 0), 0);
  const allMarked = qs.length > 0 && qs.every((q) => q.marks !== null && q.marks !== "" && Number.isFinite(Number(q.marks)));

  async function save() {
    setBusy(true);
    setError("");
    const clean = qs.map((q) => ({
      id: q.id, label: String(q.label || "").slice(0, 20), page: q.page,
      x: q.x, y: q.y, w: q.w, h: q.h,
      marks: q.marks === null || q.marks === "" ? null : Number(q.marks),
    }));
    const res = await call("clip_set_questions", { p_clip: clip.id, p_questions: clean, p_max: null });
    setBusy(false);
    if (!res.data) {
      setError(problemText(res, "The questions couldn't be saved. Check your connection and try again."));
      return;
    }
    onSaved(res.data);
  }

  const box = draft && { x: Math.min(draft.x0, draft.x1), y: Math.min(draft.y0, draft.y1), w: Math.abs(draft.x1 - draft.x0), h: Math.abs(draft.y1 - draft.y0) };
  return (
    <div className={d.overlay} data-board-shortcuts="off">
      <div
        className={d.card}
        style={{ width: "min(980px, calc(100vw - 24px))", maxHeight: "calc(100dvh - 24px)", overflowY: "auto" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="q-editor-title"
        data-question-editor="true"
      >
        <div className={d.header}>
          <div className={d.titleBlock}>
            <h2 id="q-editor-title" className={d.title}>Mark out the questions</h2>
            <p className={d.subtitle}>Drag a box around each question. Then you can mark one question across the whole class, side by side.</p>
          </div>
          <button type="button" className={d.close} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {clip.pages.length > 1 && (
          <div className={t.tabs} role="tablist" style={{ marginBottom: 10 }}>
            {clip.pages.map((_, i) => (
              <button key={i} type="button" role="tab" aria-selected={pageAt === i} className={`${t.tab} ${pageAt === i ? t.tabOn : ""}`} onClick={() => setPageAt(i)}>
                Page {i + 1}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div
            ref={areaRef}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={() => setDraft(null)}
            data-question-page="true"
            style={{
              position: "relative", flex: "1 1 420px", maxWidth: 560, aspectRatio: `${page.pw} / ${page.ph}`, cursor: "crosshair",
              border: "1.5px solid var(--border-strong)", borderRadius: 6,
              touchAction: "none", userSelect: "none", background: `#fff url("${fileUrlNow(page.url, filesVersion) || ""}") 0 0 / 100% 100%`,
            }}
          >
            {qs.filter((q) => q.page === pageAt).map((q) => (
              <div
                key={q.id}
                data-q-box={q.id}
                style={{
                  position: "absolute", left: `${q.x * 100}%`, top: `${q.y * 100}%`, width: `${q.w * 100}%`, height: `${q.h * 100}%`,
                  border: "2px solid #2451d6", background: "rgba(36,81,214,0.08)", borderRadius: 4,
                }}
              >
                <span style={{ position: "absolute", left: -2, top: -22, background: "#2451d6", color: "#fff", fontSize: 12, fontWeight: 800, padding: "2px 6px", borderRadius: 5 }}>
                  {q.label}
                </span>
              </div>
            ))}
            {box && (
              <div style={{ position: "absolute", left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`, border: "2px dashed #2451d6" }} />
            )}
          </div>
          <div style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: 8 }}>
            {!qs.length && <p className={t.small}>No questions yet. Drag on the page to draw the first box.</p>}
            {qs.map((q) => (
              <div key={q.id} className={t.row} data-q-row={q.id}>
                <input className={t.input} style={{ width: 70 }} value={q.label} maxLength={20} onChange={(e) => edit(q.id, { label: e.target.value })} aria-label="Question name" />
                <input
                  type="number"
                  min="0"
                  max="1000"
                  inputMode="decimal"
                  className={t.input}
                  style={{ width: 90 }}
                  value={q.marks === null ? "" : q.marks}
                  onChange={(e) => edit(q.id, { marks: e.target.value === "" ? null : e.target.value })}
                  placeholder="marks"
                  aria-label={`Marks for ${q.label}`}
                  data-q-marks={q.id}
                />
                <span className={t.small}>p{q.page + 1}</span>
                <button type="button" className={t.stripIcon} onClick={() => setQs((prev) => prev.filter((x) => x.id !== q.id))} aria-label={`Remove ${q.label}`}>
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            ))}
            {qs.length > 0 && (
              <p className={t.small}>{allMarked ? `Out of ${total} in all.` : "Give each question its marks to add them up."}</p>
            )}
          </div>
        </div>
        {error && <p className={t.warn} role="alert" style={{ marginTop: 10 }}>{error}</p>}
        <div className={d.actions} style={{ marginTop: 16 }}>
          <button type="button" className={d.btn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={`${d.btn} ${d.btnPrimary}`} onClick={save} disabled={busy} data-q-save="true">
            Save questions
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- one question across everyone ----------

// A student's answer to one question: that part of their page, with their
// writing and any marks of yours on top.
function AnswerPicture({ clip, q, ink, sub, me }) {
  const boxRef = useRef(null);
  useEffect(() => {
    let live = true;
    const el = boxRef.current;
    const pageId = sub.page_ids && sub.page_ids[q.page];
    const where = ink && pageId && ink.pages ? ink.pages[pageId] : null;
    const pic = clip.pages[q.page];
    if (!el || !where || !pic) return undefined;
    const rect = { x: -where.w / 2, y: where.top, w: where.w, h: where.h, page: { id: pageId, paper: "blank", w: where.w, h: where.h, bg: { url: pic.url, w: pic.w, h: pic.h } } };
    const all = contentsFromRows(ink);
    const marks = all.strokes.filter((s) => s.au === me);
    const contents = { strokes: all.strokes.filter((s) => s.au !== me), texts: all.texts, images: all.images };
    const region = { x: rect.x + q.x * rect.w, y: rect.y + q.y * rect.h, w: q.w * rect.w, h: q.h * rect.h };
    const scale = Math.min(2.4, 640 / Math.max(1, region.w));
    loadPagePictures(rect, contents).then((pictures) => {
      if (!live) return;
      const canvas = renderPage({ rect, color: "#ffffff", contents, pictures, scale, region, marks });
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      canvas.style.display = "block";
      el.replaceChildren(canvas);
    });
    return () => {
      live = false;
    };
  }, [clip, q, ink, sub, me]);
  return <div ref={boxRef} style={{ minHeight: 60, background: "#fff", borderRadius: 8, overflow: "hidden", border: "1.5px solid var(--border)" }} data-answer={sub.id} />;
}

// Marking one question across every student. `me`: the teacher's id.
export function MarkByQuestion({ clip, me, onChanged }) {
  const questions = clip.questions || [];
  const [qid, setQid] = useState(questions[0] ? questions[0].id : null);
  const [ink, setInk] = useState(null); // clip_question_ink(), by submission
  const [scores, setScores] = useState(() => Object.fromEntries((clip.subs || []).map((s) => [s.id, { ...(s.question_scores || {}) }])));
  const [saving, setSaving] = useState({});
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    call("clip_question_ink", { p_clip: clip.id }).then((res) => {
      if (!live) return;
      if (Array.isArray(res.data)) setInk(Object.fromEntries(res.data.map((x) => [x.sub, x])));
      else setInk({});
    });
    return () => {
      live = false;
    };
  }, [clip.id]);

  const q = questions.find((x) => x.id === qid) || questions[0];
  if (!q) return null;
  const subs = (clip.subs || []).filter((s) => s.reachable && s.board);
  const shown = [...subs.filter((s) => s.status === "handed_in"), ...subs.filter((s) => s.status === "returned"), ...subs.filter((s) => s.status === "assigned")];
  const marked = (sid) => questions.every((x) => scores[sid] && scores[sid][x.id] !== undefined && scores[sid][x.id] !== null && scores[sid][x.id] !== "");
  const totalOf = (sid) => questions.reduce((n, x) => n + (Number(scores[sid] && scores[sid][x.id]) || 0), 0);

  async function give(sub, value, giveBack = false) {
    const v = value === "" || value === null ? null : Number(value);
    if (v !== null && (!Number.isFinite(v) || v < 0 || (q.marks !== null && q.marks !== undefined && v > Number(q.marks)))) {
      setError(q.marks ? `${q.label}: from 0 to ${Number(q.marks)}.` : `${q.label}: 0 or more.`);
      return;
    }
    setError("");
    const next = { ...(scores[sub.id] || {}) };
    if (v === null) delete next[q.id];
    else next[q.id] = v;
    setScores((prev) => ({ ...prev, [sub.id]: next }));
    await save(sub, next, giveBack);
  }

  async function save(sub, qscores, giveBack) {
    setSaving((prev) => ({ ...prev, [sub.id]: true }));
    const total = questions.reduce((n, x) => n + (Number(qscores[x.id]) || 0), 0);
    const any = questions.some((x) => qscores[x.id] !== undefined);
    const res = await call("submission_mark", {
      p_sub: sub.id,
      p_score: any ? (clip.max_score ? Math.min(total, Number(clip.max_score)) : total) : (sub.score ?? null),
      p_comment: sub.comment || "",
      p_qscores: qscores,
      p_return: giveBack,
    });
    setSaving((prev) => ({ ...prev, [sub.id]: false }));
    if (!res.data) {
      setError(problemText(res, "That mark couldn't be saved. Check your connection and try again."));
      return false;
    }
    return true;
  }

  const ready = subs.filter((s) => s.status === "handed_in" && marked(s.id));
  async function returnAll() {
    for (const s of ready) await save(s, scores[s.id] || {}, true);
    track("submission_returned", { many: ready.length });
    onChanged();
  }

  return (
    <div className={t.section} data-mark-by-question="true">
      <div className={t.row}>
        <div className={t.btnRow} role="tablist" aria-label="Question">
          {questions.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={x.id === q.id}
              className={`${t.btn} ${t.btnSmall} ${x.id === q.id ? t.btnPrimary : t.btnQuiet}`}
              onClick={() => setQid(x.id)}
              data-q-tab={x.label}
            >
              {x.label}
              {x.marks !== null && x.marks !== undefined ? ` (${Number(x.marks)})` : ""}
            </button>
          ))}
        </div>
        <span className={t.grow} />
        <button type="button" className={`${t.btn} ${t.btnSmall} ${t.btnPrimary}`} disabled={!ready.length} onClick={returnAll} data-return-all="true">
          Return {ready.length || ""} fully marked
        </button>
      </div>
      {error && <p className={t.warn} role="alert">{error}</p>}
      {!ink && <p className={t.small}>Loading everyone&apos;s answers…</p>}
      <div className={t.cards} style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
        {ink &&
          shown.map((s) => {
            const v = scores[s.id] ? scores[s.id][q.id] : undefined;
            const full = q.marks !== null && q.marks !== undefined ? Number(q.marks) : null;
            return (
              <div key={s.id} className={t.card} style={{ minHeight: 0, gap: 8, padding: 12, opacity: s.status === "assigned" ? 0.7 : 1 }} data-answer-card={s.id}>
                <div className={t.row} style={{ justifyContent: "space-between" }}>
                  <span className={t.cardTitle} style={{ fontSize: 15 }}>{s.student || "Student"}</span>
                  <span className={`${t.pill} ${s.status === "returned" ? t.pillGreen : s.status === "handed_in" ? t.pillBlue : ""}`}>
                    {s.status === "returned" ? "Returned" : s.status === "handed_in" ? (s.late ? "Late" : "Handed in") : "Not handed in"}
                  </span>
                </div>
                {ink[s.id] ? <AnswerPicture clip={clip} q={q} ink={ink[s.id]} sub={s} me={me} /> : <p className={t.small}>Can&apos;t show this one.</p>}
                <div className={t.row}>
                  {full !== null && (
                    <>
                      <button type="button" className={`${t.btn} ${t.btnSmall} ${v === full ? t.btnPrimary : ""}`} onClick={() => give(s, full)} aria-label={`Full marks for ${s.student}`} data-give-full={s.id}>
                        <Check size={14} aria-hidden="true" /> {full}
                      </button>
                      <button type="button" className={`${t.btn} ${t.btnSmall} ${v === 0 ? t.btnPrimary : ""}`} onClick={() => give(s, 0)} aria-label={`No marks for ${s.student}`}>
                        <X size={14} aria-hidden="true" /> 0
                      </button>
                    </>
                  )}
                  <input
                    type="number"
                    min="0"
                    max={full ?? undefined}
                    step="any"
                    inputMode="decimal"
                    className={t.input}
                    style={{ width: 76, height: 32 }}
                    defaultValue={v ?? ""}
                    key={`${q.id}-${v ?? ""}`}
                    onBlur={(e) => {
                      if (String(e.target.value) !== String(v ?? "")) give(s, e.target.value);
                    }}
                    aria-label={`${q.label} marks for ${s.student}`}
                    data-give={s.id}
                  />
                  <span className={t.small} style={{ marginLeft: "auto" }}>
                    {saving[s.id] ? "Saving…" : `Total ${scoreText(totalOf(s.id), clip.max_score) || "0"}`}
                  </span>
                </div>
                <Link href={`/board/${s.board}?page=${encodeURIComponent((s.page_ids && s.page_ids[q.page]) || "")}&mark=${s.id}`} className={t.small}>
                  Open in their notebook to write on it
                </Link>
              </div>
            );
          })}
      </div>
      <p className={t.small}>Marks save as you give them. For comments, or to write on the work, open it in their notebook.</p>
    </div>
  );
}
