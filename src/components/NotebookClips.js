"use client";

import { useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Info, MessageSquare, Send, Undo2, X } from "lucide-react";
import { call, clipSections, dueState, dueText, problemText, scoreText } from "@/lib/teaching";
import { parsePageRange } from "@/lib/notebookRender";
import { track } from "@/lib/track";
import d from "./Dialog.module.css";
import t from "./Teaching.module.css";

// The strip above pages a teacher clipped into a notebook: what it is,
// who it's from, when it's due, and the one thing to do next.
//
//   clip    one of notebook_clips().clips (with .sub, this notebook's copy)
//   role    "owner" (the student) | "teacher" | "shared"
export function ClipStrip({ clip, role, onOpen, onHandIn }) {
  const sub = clip.sub || {};
  const homework = clip.kind === "homework" && !clip.deleted;
  const state = homework ? dueState(clip.due_at, sub.status) : "none";
  let meta = "";
  if (role === "teacher") {
    meta = homework
      ? sub.status === "returned"
        ? `Returned${sub.score !== null && sub.score !== undefined ? ` · ${scoreText(sub.score, clip.max_score)}` : ""}`
        : sub.status === "handed_in"
          ? `Handed in ${dueText(sub.handed_in_at)}${sub.edited_after ? " · changed since" : ""}`
          : clip.due_at
            ? `Not handed in · due ${dueText(clip.due_at)}`
            : "Not handed in"
      : "Resource you sent";
  } else {
    const from = clip.teacher ? `From ${clip.teacher}` : "From your teacher";
    meta = homework
      ? sub.status === "returned"
        ? `${from} · marked${sub.score !== null && sub.score !== undefined ? ` ${scoreText(sub.score, clip.max_score)}` : ""}`
        : sub.status === "handed_in"
          ? `${from} · handed in`
          : clip.due_at
            ? `${from} · due ${dueText(clip.due_at)}`
            : from
      : from;
  }
  return (
    <div
      className={`${t.strip} ${homework ? "" : t.stripResource}`}
      data-clip-strip={clip.id}
      data-clip-status={homework ? sub.status : "resource"}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className={t.stripKind}>{homework ? "Homework" : "Resource"}</span>
      <span className={t.stripMain}>
        <span className={t.stripTitle}>{clip.title}</span>
        <span className={t.stripMeta} style={state === "overdue" ? { color: "#a1251b", fontWeight: 700 } : undefined}>
          {state === "overdue" && role !== "teacher" ? `Overdue · ${meta}` : meta}
        </span>
      </span>
      <span className={t.stripBtns}>
        {homework && role === "owner" && sub.status === "assigned" && (
          <button type="button" className={`${t.btn} ${t.btnSmall} ${t.btnPrimary}`} onClick={() => onHandIn(clip)} data-clip-handin="true">
            <Send size={14} aria-hidden="true" /> Hand in
          </button>
        )}
        {homework && role === "owner" && sub.status === "returned" && (
          <button type="button" className={`${t.btn} ${t.btnSmall}`} onClick={() => onOpen(clip.id)} data-clip-feedback="true">
            <MessageSquare size={14} aria-hidden="true" /> Feedback
          </button>
        )}
        {homework && role === "teacher" && sub.status !== "assigned" && (
          <button type="button" className={`${t.btn} ${t.btnSmall} ${sub.status === "handed_in" ? t.btnPrimary : ""}`} onClick={() => onOpen(clip.id)} data-clip-mark="true">
            {sub.status === "handed_in" ? "Mark" : "Marks"}
          </button>
        )}
        <button type="button" className={t.stripIcon} onClick={() => onOpen(clip.id)} aria-label={`About ${clip.title}`} title="Details">
          <Info size={16} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

// The card with a clip's details: for the student (the note, handing in,
// the feedback) or the teacher (marking it and handing it back).
export function ClipPanel({ clip, role, boardId, onClose, onChanged, onGoTo }) {
  const sub = clip.sub || {};
  const homework = clip.kind === "homework" && !clip.deleted;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [score, setScore] = useState(sub.score === null || sub.score === undefined ? "" : String(sub.score));
  const [comment, setComment] = useState(sub.comment || "");
  const questions = clip.questions || [];
  const [qscores, setQscores] = useState(() => ({ ...(sub.question_scores || {}) }));
  const [others, setOthers] = useState(null); // everyone this clip went to (teacher)

  useEffect(() => {
    if (role !== "teacher" || !clip.mine) return undefined;
    let live = true;
    call("clip_overview", { p_clip: clip.id }).then((res) => {
      if (live && res.data) setOthers((res.data.subs || []).filter((s) => s.reachable && s.board));
    });
    return () => {
      live = false;
    };
  }, [role, clip.id, clip.mine]);

  async function handIn(undo = false) {
    setBusy(true);
    setError("");
    const res = await call("submission_hand_in", { p_sub: sub.id, p_undo: undo });
    setBusy(false);
    if (!res.data) {
      setError(problemText(res));
      return;
    }
    onChanged();
  }

  async function mark(giveBack) {
    setError("");
    const n = score === "" ? null : Number(score);
    if (n !== null && (!Number.isFinite(n) || n < 0 || (clip.max_score && n > Number(clip.max_score)))) {
      setError(clip.max_score ? `A score from 0 to ${Number(clip.max_score)}.` : "A score of 0 or more.");
      return;
    }
    setBusy(true);
    const res = await call("submission_mark", { p_sub: sub.id, p_score: n, p_comment: comment, p_qscores: qscores, p_return: giveBack });
    setBusy(false);
    if (!res.data) {
      setError(problemText(res));
      return;
    }
    if (giveBack) track("submission_returned", {});
    onChanged();
  }

  const at = others ? others.findIndex((s) => s.board === boardId) : -1;
  const prev = at > 0 ? others[at - 1] : null;
  const next = others && at >= 0 && at < others.length - 1 ? others[at + 1] : null;
  const state = homework ? dueState(clip.due_at, sub.status) : "none";

  return (
    <div className={t.panel} role="dialog" aria-label={clip.title} data-clip-panel={clip.id} onPointerDown={(e) => e.stopPropagation()}>
      <div className={t.panelHead}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className={`${t.pill} ${homework ? t.pillBlue : t.pillGreen}`}>{homework ? "Homework" : "Resource"}</span>
          <h2 className={t.panelTitle} style={{ marginTop: 6 }}>{clip.title}</h2>
        </div>
        <button type="button" className={t.stripIcon} onClick={onClose} aria-label="Close">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <p className={t.small} style={{ margin: 0 }}>
        {role === "teacher" ? (clip.mine ? "Sent by you" : `Sent by ${clip.teacher || "another teacher"}`) : `From ${clip.teacher || "your teacher"}`}
        {homework && clip.due_at ? ` · due ${dueText(clip.due_at)}` : ""}
        {homework && clip.max_score ? ` · out of ${Number(clip.max_score)}` : ""}
      </p>
      {clip.note && <div className={t.note}>{clip.note}</div>}

      {homework && role !== "teacher" && (
        <>
          {sub.status === "assigned" && (
            <>
              <p className={state === "overdue" ? t.warn : t.panelText}>
                {state === "overdue" ? "This is overdue. Hand it in as soon as you can." : "Write your answers on these pages, then hand it in."}
              </p>
              {role === "owner" && (
                <button type="button" className={`${t.btn} ${t.btnPrimary}`} onClick={() => handIn(false)} disabled={busy} data-panel-handin="true">
                  <Send size={15} aria-hidden="true" /> Hand it in
                </button>
              )}
            </>
          )}
          {sub.status === "handed_in" && (
            <>
              <p className={t.panelText}>
                <Check size={15} aria-hidden="true" style={{ verticalAlign: "-2px" }} /> Handed in {dueText(sub.handed_in_at)}. Your teacher will mark it.
              </p>
              {role === "owner" && (
                <button type="button" className={`${t.btn} ${t.btnSmall}`} onClick={() => handIn(true)} disabled={busy} data-panel-undo="true">
                  <Undo2 size={14} aria-hidden="true" /> Take it back to change it
                </button>
              )}
            </>
          )}
          {sub.status === "returned" && (
            <>
              {sub.score !== null && sub.score !== undefined && <span className={t.bigScore} data-panel-score="true">{scoreText(sub.score, clip.max_score)}</span>}
              {questions.length > 0 && Object.keys(sub.question_scores || {}).length > 0 && (
                <div className={t.row} data-feedback-questions="true">
                  {questions.map((q) =>
                    sub.question_scores[q.id] !== undefined ? (
                      <span key={q.id} className={t.pill}>
                        {q.label}: {scoreText(sub.question_scores[q.id], q.marks)}
                      </span>
                    ) : null
                  )}
                </div>
              )}
              {sub.comment ? <div className={t.feedback}>{sub.comment}</div> : <p className={t.panelText}>Marked and returned.</p>}
              <p className={t.small} style={{ margin: 0 }}>Your teacher&apos;s marks are on the pages in this section.</p>
            </>
          )}
        </>
      )}

      {homework && role === "teacher" && (
        <>
          <p className={t.panelText}>
            {sub.status === "assigned"
              ? "Not handed in yet. You can still write on it."
              : sub.status === "handed_in"
                ? `Handed in ${dueText(sub.handed_in_at)}.`
                : `Returned ${dueText(sub.returned_at)}. You can change the mark.`}
            {sub.edited_after ? " They changed it after handing it in." : ""}
          </p>
          {clip.mine && sub.status !== "assigned" && (
            <>
              <p className={t.small} style={{ margin: 0 }}>Write on the pages: your ink is red by default, and only you can change it.</p>
              {questions.length > 0 && (
                <div className={t.field} data-mark-questions="true">
                  By question
                  <div className={t.row}>
                    {questions.map((q) => (
                      <label key={q.id} className={t.small} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {q.label}
                        <input
                          type="number"
                          min="0"
                          max={q.marks ?? undefined}
                          step="any"
                          inputMode="decimal"
                          className={t.input}
                          style={{ width: 58, height: 32 }}
                          value={qscores[q.id] ?? ""}
                          onChange={(e) => {
                            const next = { ...qscores };
                            if (e.target.value === "") delete next[q.id];
                            else next[q.id] = Number(e.target.value);
                            setQscores(next);
                            const sum = questions.reduce((n, x) => n + (Number(next[x.id]) || 0), 0);
                            setScore(String(clip.max_score ? Math.min(sum, Number(clip.max_score)) : sum));
                          }}
                          aria-label={`${q.label} marks`}
                        />
                        {q.marks !== null && q.marks !== undefined ? `/${Number(q.marks)}` : ""}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <label className={t.field}>
                Score{clip.max_score ? ` (out of ${Number(clip.max_score)})` : ""}
                <input
                  type="number"
                  min="0"
                  max={clip.max_score || undefined}
                  step="any"
                  inputMode="decimal"
                  className={t.input}
                  value={score}
                  onChange={(e) => setScore(e.target.value)}
                  data-mark-score="true"
                />
              </label>
              <label className={t.field}>
                Comment
                <textarea className={t.textarea} value={comment} maxLength={2000} onChange={(e) => setComment(e.target.value)} placeholder="What went well, what to work on" data-mark-comment="true" />
              </label>
              <div className={t.row}>
                <button type="button" className={`${t.btn} ${t.btnSmall}`} onClick={() => mark(false)} disabled={busy}>
                  Save
                </button>
                <button type="button" className={`${t.btn} ${t.btnSmall} ${t.btnPrimary}`} onClick={() => mark(true)} disabled={busy} data-mark-return="true">
                  {sub.status === "returned" ? "Update" : "Return to student"}
                </button>
              </div>
            </>
          )}
          {others && others.length > 1 && (
            <div className={t.row} style={{ justifyContent: "space-between" }}>
              <button type="button" className={`${t.btn} ${t.btnSmall} ${t.btnQuiet}`} disabled={!prev} onClick={() => onGoTo(prev)}>
                <ChevronLeft size={14} aria-hidden="true" /> {prev ? prev.student : "Previous"}
              </button>
              <span className={t.small}>{at + 1} of {others.length}</span>
              <button type="button" className={`${t.btn} ${t.btnSmall} ${t.btnQuiet}`} disabled={!next} onClick={() => onGoTo(next)} data-mark-next="true">
                {next ? next.student : "Next"} <ChevronRight size={14} aria-hidden="true" />
              </button>
            </div>
          )}
          {clip.mine && (
            <a href={`/mark/${clip.id}`} className={t.small}>
              Everyone&apos;s progress on this
            </a>
          )}
        </>
      )}
      {!homework && <p className={t.small} style={{ margin: 0 }}>{clip.deleted ? "Your teacher took this back. The pages are yours to keep or delete." : "To keep: nothing to hand in."}</p>}
      {error && <p className={t.warn} role="alert" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}

// Which of a notebook's pages to send to students: this page, all of them,
// or some.
export function ClipPagesDialog({ count, current, busy, onClose, onPick }) {
  const [which, setWhich] = useState("this");
  const [range, setRange] = useState("");
  const parsed = which === "some" ? parsePageRange(range, count) : null;
  const indices = which === "this" ? [current] : which === "all" ? Array.from({ length: count }, (_, i) => i) : parsed || [];
  return (
    <div className={d.overlay} onClick={busy ? undefined : onClose} data-board-shortcuts="off">
      <div className={d.card} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="clip-pages-title" data-clip-pages="true">
        <div className={d.header}>
          <div className={d.titleBlock}>
            <h2 id="clip-pages-title" className={d.title}>Send pages to students</h2>
            <p className={d.subtitle}>Copies of these pages go into your students&apos; notebooks, as homework or to keep. Tape stays on, covering answers.</p>
          </div>
          <button type="button" className={d.close} onClick={onClose} aria-label="Close" disabled={busy}>
            <X size={18} />
          </button>
        </div>
        <div className={t.targets} role="radiogroup" aria-label="Which pages" style={{ maxHeight: "none", border: "none", padding: 0 }}>
          <label className={t.check}>
            <input type="radio" name="clip-pages" checked={which === "this"} onChange={() => setWhich("this")} /> This page (page {current + 1})
          </label>
          <label className={t.check}>
            <input type="radio" name="clip-pages" checked={which === "all"} onChange={() => setWhich("all")} /> All {count} pages
          </label>
          <label className={t.check}>
            <input type="radio" name="clip-pages" checked={which === "some"} onChange={() => setWhich("some")} /> Pages:
            <input
              className={t.input}
              style={{ height: 32, width: 140 }}
              value={range}
              placeholder="e.g. 1-3, 5"
              onFocus={() => setWhich("some")}
              onChange={(e) => setRange(e.target.value)}
            />
          </label>
        </div>
        {which === "some" && range && !parsed && <p className={t.warn}>Page numbers like 1-3, 5.</p>}
        <div className={d.actions} style={{ marginTop: 16 }}>
          <span className={t.small} style={{ marginRight: "auto" }} role="status">{busy ? "Preparing the pages…" : ""}</span>
          <button type="button" className={d.btn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={`${d.btn} ${d.btnPrimary}`} disabled={busy || !indices.length || indices.length > 60} onClick={() => onPick(indices)} data-clip-pages-go="true">
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

// Everything about clipped-in work over a notebook: a strip above each
// piece, and the card of the one that's open.
export function ClipsLayer({ info, notebook, open, boardId, onOpen, onHandIn, onChanged }) {
  const clips = info.clips || [];
  const openClip = open ? clips.find((c) => c.id === open) : null;
  return (
    <>
      {clipSections(notebook).map((sec) => {
        const k = clips.find((c) => c.id === sec.clip);
        if (!k) return null;
        return <ClipStrip key={sec.clip} clip={k} role={info.role} onOpen={onOpen} onHandIn={onHandIn} />;
      })}
      {openClip && (
        <ClipPanel
          key={openClip.id}
          clip={openClip}
          role={info.role}
          boardId={boardId}
          onClose={() => onOpen(null)}
          onChanged={onChanged}
          onGoTo={(sub) => {
            const pid = (sub.page_ids && sub.page_ids[0]) || "";
            window.location.assign(`/board/${sub.board}?page=${encodeURIComponent(pid)}&mark=${sub.id}`);
          }}
        />
      )}
    </>
  );
}
