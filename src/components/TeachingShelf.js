"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy, GraduationCap, Inbox, Plus, UserPlus, X } from "lucide-react";
import { COVER_COLORS, defaultPageSize } from "@/lib/notebook";
import { call, classLink, copyText, inviteLink, problemText, dueText } from "@/lib/teaching";
import { track } from "@/lib/track";
import d from "./Dialog.module.css";
import sh from "./Shelf.module.css";
import t from "./Teaching.module.css";

// The Teaching section on the home screen: your classes, notebooks you
// keep for one student, and students asking you to look at their notebooks.
// Not shown until the database has classes (supabase/2026-11-clipping.sql).
// `hideEmpty`: someone with homework of their own (a student) isn't shown
// the empty "Teach with notebooks" card.
export default function TeachingShelf({ user, onOpen, hideEmpty = false }) {
  const [home, setHome] = useState(null); // teacher_home() | null
  const [dialog, setDialog] = useState(null); // { kind: "class" | "student" | "made", ... }
  const [busy, setBusy] = useState(false);
  const genRef = useRef(0);

  async function reload() {
    const gen = ++genRef.current;
    const res = await call("teacher_home");
    if (gen !== genRef.current) return;
    setHome(res.data || (res.missing ? null : { failed: true }));
  }

  useEffect(() => {
    if (!user) return undefined;
    let live = true;
    call("teacher_home").then((res) => {
      if (live) setHome(res.data || (res.missing ? null : { failed: true }));
    });
    return () => {
      live = false;
    };
  }, [user]);

  if (!home) return null;
  if (home.failed) {
    return (
      <section className={t.section} aria-labelledby="teaching-heading" data-teaching="true">
        <h2 id="teaching-heading" className={t.heading}>Teaching</h2>
        <div className={t.emptyCard}>
          <span className={t.emptyText}>Couldn&apos;t load your classes. Check your connection.</span>
          <button type="button" className={`${t.btn} ${t.btnSmall}`} onClick={reload}>
            Try again
          </button>
        </div>
      </section>
    );
  }

  const classes = home.classes || [];
  const students = home.students || [];
  const requests = home.requests || [];
  const nothingYet = !classes.length && !students.length && !requests.length;
  if (nothingYet && hideEmpty) return null;

  async function makeClass({ name, color }) {
    setBusy(true);
    const res = await call("class_create", { p_name: name, p_color: color });
    setBusy(false);
    if (!res.data) {
      alert(problemText(res, "The class couldn't be made. Check your connection and try again."));
      return;
    }
    track("class_created", {});
    setDialog(null);
    window.location.assign(`/class/${res.data.id}`);
  }

  async function makeStudentNotebook({ label, color }) {
    setBusy(true);
    const res = await call("student_notebook_create", { p_label: label, p_size: defaultPageSize(), p_color: color });
    setBusy(false);
    if (!res.data) {
      alert(problemText(res, "The notebook couldn't be made. Check your connection and try again."));
      return;
    }
    track("student_notebook_created", {});
    setDialog({ kind: "made", label, token: res.data.token, board: res.data.board });
    reload();
  }

  async function answer(req, accept) {
    const res = await call("teacher_answer", { p_link: req.link, p_accept: accept });
    if (!res.data && !res.missing && res.error) {
      alert(problemText(res));
      return;
    }
    reload();
  }

  return (
    <section className={t.section} aria-labelledby="teaching-heading" data-teaching="true">
      <div className={t.headRow}>
        <div className={t.headText}>
          <h2 id="teaching-heading" className={t.heading}>Teaching</h2>
          {!nothingYet && (
            <p className={t.sub}>
              {home.to_mark > 0 ? `${home.to_mark} handed in, waiting to be marked.` : "Send work into your students' notebooks, and mark it there."}
            </p>
          )}
        </div>
        {!nothingYet && (
          <div className={t.btnRow}>
            <button type="button" className={t.btn} onClick={() => setDialog({ kind: "student" })}>
              <UserPlus size={16} aria-hidden="true" /> One student
            </button>
            <button type="button" className={`${t.btn} ${t.btnPrimary}`} onClick={() => setDialog({ kind: "class" })}>
              <Plus size={16} aria-hidden="true" /> New class
            </button>
          </div>
        )}
      </div>

      {requests.length > 0 && (
        <div className={t.requests} data-teacher-requests="true">
          {requests.map((r) => (
            <div key={r.link} className={t.request}>
              <Inbox size={18} aria-hidden="true" />
              <span className={t.requestText}>
                <strong>{r.student || "A student"}</strong> wants you to {r.permission === "view" ? "look at" : "look at and set work in"} their notebook{" "}
                <strong>{r.notebook || "Untitled notebook"}</strong>.
              </span>
              <button type="button" className={`${t.btn} ${t.btnSmall} ${t.btnQuiet}`} onClick={() => answer(r, false)}>
                No thanks
              </button>
              <button type="button" className={`${t.btn} ${t.btnSmall} ${t.btnPrimary}`} onClick={() => answer(r, true)}>
                <Check size={15} aria-hidden="true" /> Accept
              </button>
            </div>
          ))}
        </div>
      )}

      {nothingYet ? (
        <div className={t.emptyCard}>
          <GraduationCap size={26} aria-hidden="true" />
          <span className={t.emptyText}>
            <strong>Teach with notebooks.</strong> Make a class and your students join with a code. Each gets a notebook you can send homework
            into, then mark it right there.
          </span>
          <div className={t.btnRow}>
            <button type="button" className={`${t.btn} ${t.btnSmall}`} onClick={() => setDialog({ kind: "student" })}>
              One student
            </button>
            <button type="button" className={`${t.btn} ${t.btnSmall} ${t.btnPrimary}`} onClick={() => setDialog({ kind: "class" })}>
              <Plus size={15} aria-hidden="true" /> New class
            </button>
          </div>
        </div>
      ) : (
        <div className={t.cards}>
          {classes.map((c) => (
            <Link key={c.id} href={`/class/${c.id}`} className={t.card} data-class-card={c.id}>
              <span className={t.cardStripe} style={{ background: c.color || COVER_COLORS[0][1] }} aria-hidden="true" />
              <span className={t.cardTitle}>{c.name}</span>
              <span className={t.cardMeta}>
                {c.students === 1 ? "1 student" : `${c.students} students`}
                {c.next_due ? ` · next due ${dueText(c.next_due)}` : ""}
              </span>
              <span className={t.cardFoot}>
                <span className={t.code} title="Join code">{c.code}</span>
                {c.to_mark > 0 && <span className={`${t.pill} ${t.pillBlue}`}>{c.to_mark} to mark</span>}
              </span>
            </Link>
          ))}
          {students.map((s) => (
            <button
              key={s.board}
              type="button"
              className={t.card}
              style={{ textAlign: "left", cursor: "pointer", font: "inherit" }}
              onClick={() => (s.pending ? setDialog({ kind: "made", label: s.name, token: s.token, board: s.board }) : onOpen(s.board))}
              data-student-card={s.board}
            >
              <span className={t.cardStripe} style={{ background: "#13897d" }} aria-hidden="true" />
              <span className={t.cardTitle}>{s.name}</span>
              <span className={t.cardMeta}>{s.pending ? "Waiting for them to open the invite" : s.notebook}</span>
              <span className={t.cardFoot}>
                {s.pending ? (
                  <span className={`${t.pill} ${t.pillAmber}`}>Invite not opened</span>
                ) : (
                  <span className={t.pill}>{s.permission === "view" ? "Look only" : "1:1 notebook"}</span>
                )}
                {s.to_mark > 0 && <span className={`${t.pill} ${t.pillBlue}`}>{s.to_mark} to mark</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      {dialog && dialog.kind === "class" && <ClassDialog busy={busy} onClose={() => setDialog(null)} onSave={makeClass} />}
      {dialog && dialog.kind === "student" && <StudentDialog busy={busy} onClose={() => setDialog(null)} onSave={makeStudentNotebook} />}
      {dialog && dialog.kind === "made" && (
        <InviteDialog label={dialog.label} token={dialog.token} onOpen={() => onOpen(dialog.board)} onClose={() => setDialog(null)} />
      )}
    </section>
  );
}

function Swatches({ value, onChange, label }) {
  return (
    <div className={sh.swatches} role="radiogroup" aria-label={label}>
      {COVER_COLORS.map(([name, hex]) => (
        <button
          key={hex}
          type="button"
          role="radio"
          aria-checked={value === hex}
          aria-label={name}
          className={`${sh.swatch} ${value === hex ? sh.swatchOn : ""}`}
          style={{ background: hex }}
          onClick={() => onChange(hex)}
        />
      ))}
    </div>
  );
}

export function ClassDialog({ initial = null, busy, onClose, onSave }) {
  const [name, setName] = useState(initial ? initial.name : "");
  const [color, setColor] = useState((initial && initial.color) || COVER_COLORS[6][1]);
  return (
    <div className={d.overlay} onClick={onClose}>
      <form
        className={d.card}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          const clean = name.trim().slice(0, 60);
          if (clean && !busy) onSave({ name: clean, color });
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="class-dialog-title"
        data-class-dialog="true"
      >
        <div className={d.header}>
          <div className={d.titleBlock}>
            <h2 id="class-dialog-title" className={d.title}>{initial ? "Rename class" : "New class"}</h2>
            {!initial && (
              <p className={d.subtitle}>Students join with a code and get a notebook for this class. You can send work into it and mark it.</p>
            )}
          </div>
          <button type="button" className={d.close} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <label className={d.label}>
          Name
          <input autoFocus className={d.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 10B Maths" maxLength={60} />
        </label>
        <div className={d.label} style={{ marginTop: 12 }}>
          Colour
          <Swatches value={color} onChange={setColor} label="Class colour" />
        </div>
        <div className={d.actions} style={{ marginTop: 16 }}>
          <button type="button" className={d.btn} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${d.btn} ${d.btnPrimary}`} disabled={!name.trim() || busy}>
            {initial ? "Save" : busy ? "Making it…" : "Make the class"}
          </button>
        </div>
      </form>
    </div>
  );
}

function StudentDialog({ busy, onClose, onSave }) {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState(COVER_COLORS[5][1]);
  return (
    <div className={d.overlay} onClick={onClose}>
      <form
        className={d.card}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          const clean = label.trim().slice(0, 60);
          if (clean && !busy) onSave({ label: clean, color });
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-dialog-title"
        data-student-dialog="true"
      >
        <div className={d.header}>
          <div className={d.titleBlock}>
            <h2 id="student-dialog-title" className={d.title}>A notebook for one student</h2>
            <p className={d.subtitle}>
              For tutoring: you get a link to send them. When they open it, the notebook becomes theirs, and you can still send work into it
              and mark it.
            </p>
          </div>
          <button type="button" className={d.close} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <label className={d.label}>
          Name it
          <input autoFocus className={d.input} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Omar – IGCSE Maths" maxLength={60} />
        </label>
        <div className={d.label} style={{ marginTop: 12 }}>
          Cover
          <Swatches value={color} onChange={setColor} label="Cover colour" />
        </div>
        <div className={d.actions} style={{ marginTop: 16 }}>
          <button type="button" className={d.btn} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${d.btn} ${d.btnPrimary}`} disabled={!label.trim() || busy}>
            {busy ? "Making it…" : "Make it"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function InviteDialog({ label, token, onOpen, onClose }) {
  const [copied, setCopied] = useState(false);
  const link = inviteLink(token);
  return (
    <div className={d.overlay} onClick={onClose}>
      <div className={d.card} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="invite-title" data-invite-dialog="true">
        <div className={d.header}>
          <div className={d.titleBlock}>
            <h2 id="invite-title" className={d.title}>Send this link to {label}</h2>
            <p className={d.subtitle}>
              When they open it and sign in, the notebook becomes theirs. Until then you can already add pages and send work into it.
            </p>
          </div>
          <button type="button" className={d.close} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className={t.row}>
          <input className={`${t.input} ${t.grow}`} readOnly value={link} onFocus={(e) => e.target.select()} data-invite-link="true" aria-label="Invite link" />
          <button
            type="button"
            className={`${t.btn} ${t.btnPrimary}`}
            onClick={async () => {
              if (await copyText(link)) setCopied(true);
            }}
          >
            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className={t.small} style={{ marginTop: 10 }}>Only the first person to open it gets the notebook. Send it to your student only.</p>
        <div className={d.actions} style={{ marginTop: 14 }}>
          <button type="button" className={d.btn} onClick={onClose}>
            Done
          </button>
          <button type="button" className={`${d.btn} ${d.btnPrimary}`} onClick={onOpen}>
            Open the notebook
          </button>
        </div>
      </div>
    </div>
  );
}

export function ClassLinkBox({ code }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`${t.btn} ${t.btnSmall}`}
      onClick={async () => {
        if (await copyText(classLink(code))) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }
      }}
    >
      {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />} {copied ? "Copied" : "Copy join link"}
    </button>
  );
}
