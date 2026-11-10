"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Download, ListChecks, Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { MarkByQuestion, QuestionEditor } from "@/components/MarkQuestions";
import { call, dueText, fromLocalInput, problemText, scoreText, toLocalInput } from "@/lib/teaching";
import d from "@/components/Dialog.module.css";
import t from "@/components/Teaching.module.css";

// The marks, as a spreadsheet (CSV) to download.
function exportMarks(c, subs) {
  const rows = [["Student", "Status", "Handed in", "Late", "Score", "Out of", "Comment"]];
  for (const s of subs) {
    rows.push([
      s.student || "",
      s.status === "returned" ? "Returned" : s.status === "handed_in" ? "Handed in" : "Not handed in",
      s.handed_in_at ? new Date(s.handed_in_at).toLocaleString() : "",
      s.late ? "yes" : "",
      s.score ?? "",
      c.max_score ?? "",
      s.comment || "",
    ]);
  }
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(c.title || "marks").replace(/[^\w\- ]+/g, "").slice(0, 60) || "marks"}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// One piece of work a teacher sent: who it went to, who's handed it in,
// and marking (each student's pages open in their notebook, with the
// marking card).
export default function MarkPage() {
  const { clip } = useParams();
  const router = useRouter();
  const [k, setK] = useState(null); // clip_overview() | "gone" | "error"
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [view, setView] = useState("students"); // "students" | "questions"
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const { user } = useAuth() || {};
  const genRef = useRef(0);

  async function reload() {
    const gen = ++genRef.current;
    const res = await call("clip_overview", { p_clip: clip });
    if (gen !== genRef.current) return;
    setK(res.data || (res.error || res.missing ? "error" : "gone"));
  }

  useEffect(() => {
    let live = true;
    call("clip_overview", { p_clip: clip }).then((res) => {
      if (live) setK(res.data || (res.error || res.missing ? "error" : "gone"));
    });
    return () => {
      live = false;
    };
  }, [clip]);

  const c = k && typeof k === "object" ? k : null;
  const subs = c ? c.subs || [] : [];
  const handed = subs.filter((s) => s.status === "handed_in");
  const back = c && c.class ? `/class/${c.class}` : "/";

  function open(s) {
    const page = (s.page_ids && s.page_ids[0]) || "";
    router.push(`/board/${s.board}?page=${encodeURIComponent(page)}&mark=${s.id}`);
  }

  return (
    <div className={t.pageWrap}>
      <header className={t.pageTop}>
        <Link href={back} className={`${t.btn} ${t.btnSmall} ${t.btnQuiet}`}>
          <ArrowLeft size={16} aria-hidden="true" /> {c && c.class_name ? c.class_name : "Back"}
        </Link>
      </header>
      <main className={t.pageMain}>
        {!k && <p className={t.small}>Loading…</p>}
        {k === "gone" && (
          <div className={t.emptyCard}>
            <span className={t.emptyText}>This work doesn&apos;t exist, or you didn&apos;t send it.</span>
          </div>
        )}
        {k === "error" && (
          <div className={t.emptyCard}>
            <span className={t.emptyText}>Couldn&apos;t load it. Check your connection.</span>
            <button type="button" className={`${t.btn} ${t.btnSmall}`} onClick={reload}>Try again</button>
          </div>
        )}
        {c && (
          <>
            <div className={t.headRow}>
              <div className={t.headText}>
                <span className={`${t.pill} ${c.kind === "homework" ? t.pillBlue : t.pillGreen}`}>{c.kind === "homework" ? "Homework" : "Resource"}</span>
                <h1 className={t.heading} style={{ fontSize: 30, marginTop: 6 }} data-clip-title="true">{c.title}</h1>
                <p className={t.sub}>
                  {c.kind === "homework" ? (c.due_at ? `Due ${dueText(c.due_at)}` : "No due date") : "Nothing to hand in"}
                  {c.max_score ? ` · marks out of ${Number(c.max_score)}` : ""} · {c.pages.length} page{c.pages.length === 1 ? "" : "s"}
                </p>
                {c.note && <p className={t.note} style={{ marginTop: 8, maxWidth: 640 }}>{c.note}</p>}
              </div>
              <div className={t.btnRow}>
                <button type="button" className={`${t.btn} ${t.btnSmall} ${t.btnQuiet}`} onClick={() => setEditing(true)}>
                  <Pencil size={14} aria-hidden="true" /> Edit
                </button>
                {c.kind === "homework" && (
                  <button type="button" className={`${t.btn} ${t.btnSmall} ${t.btnQuiet}`} onClick={() => setQuestionsOpen(true)} data-open-questions="true">
                    <ListChecks size={14} aria-hidden="true" /> {(c.questions || []).length ? `Questions (${c.questions.length})` : "Mark out questions"}
                  </button>
                )}
                {c.kind === "homework" && (
                  <button type="button" className={`${t.btn} ${t.btnSmall} ${t.btnQuiet}`} onClick={() => exportMarks(c, subs)}>
                    <Download size={14} aria-hidden="true" /> Marks (CSV)
                  </button>
                )}
                <button type="button" className={`${t.btn} ${t.btnSmall} ${t.btnQuiet}`} onClick={() => setRemoving(true)}>
                  <Trash2 size={14} aria-hidden="true" /> Take back
                </button>
              </div>
            </div>

            {c.kind === "homework" && (
              <div className={t.row}>
                <span className={`${t.pill} ${t.pillBlue}`}>{handed.length} to mark</span>
                <span className={`${t.pill} ${t.pillGreen}`}>{subs.filter((s) => s.status === "returned").length} returned</span>
                <span className={t.pill}>{subs.filter((s) => s.status === "assigned").length} not handed in</span>
                {handed.length > 0 && (
                  <button type="button" className={`${t.btn} ${t.btnSmall} ${t.btnPrimary}`} onClick={() => open(handed[0])} data-mark-first="true">
                    Start marking
                  </button>
                )}
              </div>
            )}

            {c.kind === "homework" && (
              <div className={t.tabs} role="tablist">
                <button type="button" role="tab" aria-selected={view === "students"} className={`${t.tab} ${view === "students" ? t.tabOn : ""}`} onClick={() => setView("students")}>
                  By student
                </button>
                <button type="button" role="tab" aria-selected={view === "questions"} className={`${t.tab} ${view === "questions" ? t.tabOn : ""}`} onClick={() => setView("questions")} data-view-questions="true">
                  By question
                </button>
              </div>
            )}

            {view === "questions" && c.kind === "homework" && (
              (c.questions || []).length ? (
                <MarkByQuestion key={`${c.id}-${(c.questions || []).length}`} clip={c} me={user ? user.id : null} onChanged={reload} />
              ) : (
                <div className={t.emptyCard}>
                  <span className={t.emptyText}>
                    Mark out the questions first: draw a box around each one on the worksheet. Then you see one question from every student, side by side.
                  </span>
                  <button type="button" className={`${t.btn} ${t.btnSmall} ${t.btnPrimary}`} onClick={() => setQuestionsOpen(true)}>
                    Mark out questions
                  </button>
                </div>
              )
            )}

            {view === "students" && <div className={t.table} data-mark-list="true">
              {subs.map((s) => (
                <div key={s.id} className={t.tr} data-sub={s.id}>
                  <div className={t.trMain}>
                    <span className={t.trTitle}>{s.student || "Student"}</span>
                    <span className={t.small}>
                      {s.status === "assigned"
                        ? "Not handed in"
                        : `Handed in ${s.handed_in_at ? dueText(s.handed_in_at) : ""}${s.late ? " (late)" : ""}`}
                      {s.edited_after ? " · changed after handing in" : ""}
                    </span>
                  </div>
                  {c.kind === "homework" && s.status === "returned" && (
                    <span className={`${t.pill} ${t.pillGreen}`}>{scoreText(s.score, c.max_score) || "Returned"}</span>
                  )}
                  {c.kind === "homework" && s.status === "handed_in" && <span className={`${t.pill} ${t.pillBlue}`}>To mark</span>}
                  {s.reachable && s.board ? (
                    <button type="button" className={`${t.btn} ${t.btnSmall} ${s.status === "handed_in" ? t.btnPrimary : ""}`} onClick={() => open(s)}>
                      {c.kind === "homework" ? (s.status === "handed_in" ? "Mark" : "Open") : "Open"}
                    </button>
                  ) : (
                    <span className={t.small}>Can&apos;t open (left, or removed you)</span>
                  )}
                </div>
              ))}
            </div>}
          </>
        )}
      </main>
      {questionsOpen && c && (
        <QuestionEditor
          clip={c}
          onClose={() => setQuestionsOpen(false)}
          onSaved={() => {
            setQuestionsOpen(false);
            setView("questions");
            reload();
          }}
        />
      )}
      {editing && c && <EditClip clip={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
      {removing && c && (
        <div className={d.overlay} onClick={() => setRemoving(false)}>
          <div className={d.card} onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="takeback-title">
            <h2 id="takeback-title" className={d.title}>Take back “{c.title}”?</h2>
            <p className={d.subtitle} style={{ marginTop: 8 }}>
              It stops being {c.kind === "homework" ? "homework (no due date, nothing to hand in)" : "listed here"}. The pages stay in your students&apos;
              notebooks, which are theirs: they can delete them.
            </p>
            <div className={d.actions} style={{ marginTop: 16 }}>
              <button type="button" className={d.btn} onClick={() => setRemoving(false)}>Cancel</button>
              <button
                type="button"
                className={`${d.btn} ${d.btnDanger}`}
                onClick={async () => {
                  const res = await call("clip_update", { p_clip: c.id, p_delete: true });
                  if (!res.data) return alert(problemText(res));
                  router.replace(back);
                }}
              >
                Take it back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EditClip({ clip, onClose, onSaved }) {
  const [title, setTitle] = useState(clip.title);
  const [note, setNote] = useState(clip.note || "");
  const [due, setDue] = useState(toLocalInput(clip.due_at));
  const [max, setMax] = useState(clip.max_score ? String(clip.max_score) : "");
  const [busy, setBusy] = useState(false);
  return (
    <div className={d.overlay} onClick={onClose}>
      <form
        className={d.card}
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const res = await call("clip_update", {
            p_clip: clip.id,
            p_title: title.trim(),
            p_note: note,
            p_due: clip.kind === "homework" ? fromLocalInput(due) : null,
            p_clear_due: clip.kind === "homework" && !due,
            p_max: max !== "" && Number(max) > 0 ? Number(max) : null,
          });
          setBusy(false);
          if (!res.data) return alert(problemText(res));
          onSaved();
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-clip-title"
      >
        <div className={d.header}>
          <div className={d.titleBlock}>
            <h2 id="edit-clip-title" className={d.title}>Edit</h2>
          </div>
        </div>
        <label className={t.field}>
          Title
          <input className={t.input} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </label>
        {clip.kind === "homework" && (
          <div className={t.row} style={{ marginTop: 10, alignItems: "flex-end" }}>
            <label className={`${t.field} ${t.grow}`}>
              Due
              <input type="datetime-local" className={t.input} value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
            <label className={t.field} style={{ width: 120 }}>
              Marks out of
              <input type="number" min="1" max="1000" className={t.input} value={max} onChange={(e) => setMax(e.target.value)} />
            </label>
          </div>
        )}
        <label className={t.field} style={{ marginTop: 10 }}>
          Note for students
          <textarea className={t.textarea} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className={d.actions} style={{ marginTop: 16 }}>
          <button type="button" className={d.btn} onClick={onClose}>Cancel</button>
          <button type="submit" className={`${d.btn} ${d.btnPrimary}`} disabled={busy || !title.trim()}>Save</button>
        </div>
      </form>
    </div>
  );
}
