"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { call, dueBadge, dueState, dueText, problemText } from "@/lib/teaching";
import ClipSend from "@/components/ClipSend";
import { ClassDialog, ClassLinkBox } from "@/components/TeachingShelf";
import d from "@/components/Dialog.module.css";
import t from "@/components/Teaching.module.css";

const noSubscribe = () => () => {};
const hostHere = () => window.location.host;
const noHost = () => "";

// One class: its join code, the work sent to it (and how far everyone has
// got), and its students.
export default function ClassPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const [cls, setCls] = useState(null); // class_overview() | "gone" | "error"
  const [tab, setTab] = useState("work");
  const [dialog, setDialog] = useState(null); // "send" | "rename" | "delete" | { remove: student }
  const [busy, setBusy] = useState(false);
  const genRef = useRef(0);
  const host = useSyncExternalStore(noSubscribe, hostHere, noHost);

  async function reload() {
    const gen = ++genRef.current;
    const res = await call("class_overview", { p_class: id });
    if (gen !== genRef.current) return;
    setCls(res.data || (res.error || res.missing ? "error" : "gone"));
  }

  useEffect(() => {
    let live = true;
    call("class_overview", { p_class: id }).then((res) => {
      if (live) setCls(res.data || (res.error || res.missing ? "error" : "gone"));
    });
    return () => {
      live = false;
    };
  }, [id]);

  const c = cls && typeof cls === "object" ? cls : null;

  async function rename({ name, color }) {
    setBusy(true);
    const res = await call("class_update", { p_class: id, p_name: name, p_color: color, p_new_code: false });
    setBusy(false);
    if (!res.data) return alert(problemText(res));
    setDialog(null);
    reload();
  }

  async function newCode() {
    if (!window.confirm("Make a new join code? The old code and link stop working. Students already in the class stay in it.")) return;
    const res = await call("class_update", { p_class: id, p_new_code: true });
    if (!res.data) return alert(problemText(res));
    reload();
  }

  async function removeClass() {
    setBusy(true);
    const res = await call("class_delete", { p_class: id });
    setBusy(false);
    if (!res.data) return alert(problemText(res));
    router.replace("/");
  }

  async function removeStudent(s) {
    setBusy(true);
    const res = await call("class_remove", { p_class: id, p_student: s.id });
    setBusy(false);
    if (!res.data) return alert(problemText(res));
    setDialog(null);
    reload();
  }

  return (
    <div className={t.pageWrap}>
      <header className={t.pageTop}>
        <Link href="/" className={`${t.btn} ${t.btnSmall} ${t.btnQuiet}`} aria-label="Back to your notebooks">
          <ArrowLeft size={16} aria-hidden="true" /> Home
        </Link>
        <span style={{ fontWeight: 800, fontSize: 17, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {c ? c.name : "Class"}
        </span>
      </header>
      <main className={t.pageMain}>
        {!cls && <p className={t.small}>Loading…</p>}
        {cls === "gone" && (
          <div className={t.emptyCard}>
            <span className={t.emptyText}>This class doesn&apos;t exist, or it isn&apos;t yours.</span>
            <Link href="/" className={`${t.btn} ${t.btnSmall}`}>Home</Link>
          </div>
        )}
        {cls === "error" && (
          <div className={t.emptyCard}>
            <span className={t.emptyText}>Couldn&apos;t load the class. Check your connection.</span>
            <button type="button" className={`${t.btn} ${t.btnSmall}`} onClick={reload}>Try again</button>
          </div>
        )}
        {c && (
          <>
            <div className={t.headRow}>
              <div className={t.headText}>
                <h1 className={t.heading} style={{ fontSize: 32 }} data-class-name="true">
                  <span style={{ display: "inline-block", width: 14, height: 14, borderRadius: 4, background: c.color || "#7a4cd9", marginRight: 10, verticalAlign: "middle" }} aria-hidden="true" />
                  {c.name}
                </h1>
                <p className={t.sub}>
                  {c.students.length === 1 ? "1 student" : `${c.students.length} students`} · {c.clips.length === 1 ? "1 piece of work sent" : `${c.clips.length} pieces of work sent`}
                </p>
              </div>
              <div className={t.btnRow}>
                <button type="button" className={`${t.btn} ${t.btnSmall} ${t.btnQuiet}`} onClick={() => setDialog("rename")}>
                  <Pencil size={14} aria-hidden="true" /> Rename
                </button>
                <button type="button" className={`${t.btn} ${t.btnSmall} ${t.btnQuiet}`} onClick={() => setDialog("delete")}>
                  <Trash2 size={14} aria-hidden="true" /> Delete
                </button>
              </div>
            </div>

            <div className={t.joinBox} data-join-box="true">
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span className={t.small}>Students join with</span>
                <span className={t.bigCode} data-class-code="true">{c.code}</span>
              </div>
              <span className={t.small} style={{ flex: 1, minWidth: 200 }}>
                at <b>{host}/c/{c.code}</b>. They sign in, and get a notebook for this class.
              </span>
              <div className={t.btnRow}>
                <ClassLinkBox code={c.code} />
                <button type="button" className={`${t.btn} ${t.btnSmall} ${t.btnQuiet}`} onClick={newCode}>
                  <RefreshCw size={14} aria-hidden="true" /> New code
                </button>
              </div>
            </div>

            <div className={t.tabs} role="tablist">
              <button type="button" role="tab" aria-selected={tab === "work"} className={`${t.tab} ${tab === "work" ? t.tabOn : ""}`} onClick={() => setTab("work")}>
                Work
              </button>
              <button type="button" role="tab" aria-selected={tab === "students"} className={`${t.tab} ${tab === "students" ? t.tabOn : ""}`} onClick={() => setTab("students")}>
                Students ({c.students.length})
              </button>
            </div>

            {tab === "work" && (
              <>
                <div className={t.row}>
                  <span className={`${t.small} ${t.grow}`}>
                    Send a worksheet or past paper (PDF or photos). From one of your notebooks or boards: open it, then Page ▸ Send to students.
                  </span>
                  <button type="button" className={`${t.btn} ${t.btnPrimary}`} onClick={() => setDialog("send")} disabled={!c.students.length} data-class-send="true">
                    <Plus size={16} aria-hidden="true" /> Send work
                  </button>
                </div>
                {!c.students.length && <p className={t.small}>Once students have joined, you can send them work.</p>}
                {c.clips.length > 0 && (
                  <div className={t.table} data-class-clips="true">
                    {c.clips.map((k) => {
                      const st = k.kind === "homework" ? dueState(k.due_at, "assigned") : "none";
                      return (
                        <div key={k.id} className={t.tr}>
                          <div className={t.trMain}>
                            <Link href={`/mark/${k.id}`} className={t.trTitle} style={{ color: "inherit" }}>{k.title}</Link>
                            <span className={t.small}>
                              {k.kind === "homework" ? (k.due_at ? `Due ${dueText(k.due_at)}` : "Homework, no due date") : "Resource"}
                              {" · "}
                              {k.pages} page{k.pages === 1 ? "" : "s"} · sent to {k.sent}
                            </span>
                          </div>
                          {k.kind === "homework" ? (
                            <>
                              <span className={`${t.pill} ${k.handed_in ? t.pillBlue : ""}`}>{k.handed_in} to mark</span>
                              <span className={`${t.pill} ${t.pillGreen}`}>{k.returned} returned</span>
                              {st === "overdue" && <span className={`${t.pill} ${t.pillRed}`}>{dueBadge(k.due_at)}</span>}
                              <Link href={`/mark/${k.id}`} className={`${t.btn} ${t.btnSmall}`}>Mark</Link>
                            </>
                          ) : (
                            <Link href={`/mark/${k.id}`} className={`${t.btn} ${t.btnSmall} ${t.btnQuiet}`}>Details</Link>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {tab === "students" && (
              c.students.length ? (
                <div className={t.table} data-class-students="true">
                  {c.students.map((s) => (
                    <div key={s.id} className={t.tr}>
                      <div className={t.trMain}>
                        <span className={t.trTitle}>{s.name || s.email || "Student"}</span>
                        <span className={t.small}>
                          {s.email}
                          {s.joined_at ? ` · joined ${new Date(s.joined_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}
                        </span>
                      </div>
                      {s.board && s.linked ? (
                        <Link href={`/board/${s.board}`} className={`${t.btn} ${t.btnSmall}`}>
                          <BookOpen size={14} aria-hidden="true" /> Notebook
                        </Link>
                      ) : (
                        <span className={t.small}>Notebook removed</span>
                      )}
                      <button type="button" className={`${t.btn} ${t.btnSmall} ${t.btnQuiet}`} onClick={() => setDialog({ remove: s })}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={t.emptyCard}>
                  <span className={t.emptyText}>
                    Nobody yet. Give your students the code <b>{c.code}</b>, or copy the join link.
                  </span>
                </div>
              )
            )}
          </>
        )}
      </main>

      {dialog === "send" && c && user && (
        <ClipSend
          userId={user.id}
          classId={c.id}
          from="file"
          onClose={() => setDialog(null)}
          onSent={(r) => {
            setDialog(null);
            reload();
            if (r && r.skipped) alert(`Sent to ${r.sent}. ${r.skipped} notebook${r.skipped === 1 ? " was" : "s were"} full or not reachable.`);
          }}
        />
      )}
      {dialog === "rename" && c && <ClassDialog initial={c} busy={busy} onClose={() => setDialog(null)} onSave={rename} />}
      {dialog === "delete" && c && (
        <div className={d.overlay} onClick={() => setDialog(null)}>
          <div className={d.card} onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="del-class">
            <h2 id="del-class" className={d.title}>Delete {c.name}?</h2>
            <p className={d.subtitle} style={{ marginTop: 8 }}>
              Students keep their notebooks and everything in them, but you won&apos;t be able to open them or mark work any more. This can&apos;t be undone.
            </p>
            <div className={d.actions} style={{ marginTop: 16 }}>
              <button type="button" className={d.btn} onClick={() => setDialog(null)}>Cancel</button>
              <button type="button" className={`${d.btn} ${d.btnDanger}`} onClick={removeClass} disabled={busy}>Delete the class</button>
            </div>
          </div>
        </div>
      )}
      {dialog && dialog.remove && (
        <div className={d.overlay} onClick={() => setDialog(null)}>
          <div className={d.card} onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="rm-student">
            <h2 id="rm-student" className={d.title}>Remove {dialog.remove.name || "this student"}?</h2>
            <p className={d.subtitle} style={{ marginTop: 8 }}>
              They keep their notebook, but you won&apos;t be able to open it. They can join again with the code.
            </p>
            <div className={d.actions} style={{ marginTop: 16 }}>
              <button type="button" className={d.btn} onClick={() => setDialog(null)}>Cancel</button>
              <button type="button" className={`${d.btn} ${d.btnDanger}`} onClick={() => removeStudent(dialog.remove)} disabled={busy}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
