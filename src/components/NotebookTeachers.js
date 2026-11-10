"use client";

import { useEffect, useState } from "react";
import { GraduationCap } from "lucide-react";
import { call, problemText } from "@/lib/teaching";
import d from "./Dialog.module.css";
import t from "./Teaching.module.css";

// In a notebook's Share window (its owner): the teachers who can open it,
// and asking a teacher to look at it (by their email or a class code).
// Not shown until the database has teachers (supabase/2026-11-clipping.sql).
export default function NotebookTeachers({ boardId }) {
  const [info, setInfo] = useState(null); // notebook_clips()
  const [who, setWho] = useState("");
  const [perm, setPerm] = useState("assign");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function reload() {
    const res = await call("notebook_clips", { p_board: boardId });
    if (res.data) setInfo(res.data);
  }

  useEffect(() => {
    let live = true;
    call("notebook_clips", { p_board: boardId }).then((res) => {
      if (live && res.data) setInfo(res.data);
    });
    return () => {
      live = false;
    };
  }, [boardId]);

  if (!info || info.role !== "owner") return null;
  const teachers = info.teachers || [];

  async function ask(e) {
    e.preventDefault();
    const v = who.trim();
    if (!v) return;
    setBusy(true);
    setMsg("");
    const res = await call("teacher_request", { p_board: boardId, p_who: v, p_permission: perm });
    setBusy(false);
    const out = res.data;
    if (out && out.ok) {
      setWho("");
      setMsg(out.already ? "Updated." : "Sent. Once your teacher accepts, they can open this notebook.");
      reload();
      return;
    }
    const why = out && out.reason;
    setMsg(
      why === "code"
        ? "That class code doesn't work. Check it with your teacher."
        : why === "self"
          ? "That's you."
          : why === "many"
            ? "This notebook already has the most teachers it can."
            : problemText(res, "It couldn't be sent. Check your connection and try again.")
    );
  }

  async function remove(link) {
    const res = await call("notebook_teacher_remove", { p_link: link.id });
    if (!res.data && res.error) setMsg(problemText(res));
    reload();
  }

  async function setPermission(link, p) {
    const res = await call("notebook_teacher_permission", { p_link: link.id, p_permission: p });
    if (!res.data && res.error) setMsg(problemText(res));
    reload();
  }

  return (
    <div className={d.label} style={{ gap: 8 }} data-notebook-teachers="true">
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <GraduationCap size={16} aria-hidden="true" /> Share with a teacher
      </span>
      <span className={t.small} style={{ fontWeight: 400 }}>
        They can look at it{perm === "assign" ? ", send you work in it and mark it" : ""}. Their marks stay in red; your own writing is never changed.
      </span>
      <form onSubmit={ask} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          className={d.input}
          value={who}
          onChange={(e) => setWho(e.target.value)}
          placeholder="Teacher's email, or a class code"
          autoComplete="off"
          style={{ flex: 1, minWidth: 180 }}
          aria-label="Teacher's email or class code"
          data-teacher-who="true"
        />
        <select className={d.input} value={perm} onChange={(e) => setPerm(e.target.value)} style={{ width: "auto" }} aria-label="What they can do">
          <option value="assign">Look, add work, mark</option>
          <option value="view">Only look</option>
        </select>
        <button type="submit" className={d.btn} disabled={!who.trim() || busy} data-teacher-ask="true">
          Ask
        </button>
      </form>
      {msg && <p className={d.note} role="status">{msg}</p>}
      {teachers.length > 0 && (
        <div className={d.people}>
          {teachers.map((l) => (
            <div key={l.id} className={d.person} data-teacher-link={l.status}>
              <span className={d.avatar}>{String(l.name || "T").charAt(0).toUpperCase()}</span>
              <span className={d.personEmail}>
                {l.name || "Teacher"}
                {l.class ? ` · ${l.class}` : ""}
                {l.status === "requested" ? " · waiting for them" : ""}
              </span>
              {l.status === "active" && !l.class && (
                <select
                  className={d.input}
                  style={{ width: "auto", height: 30, fontSize: 12.5 }}
                  value={l.permission}
                  onChange={(e) => setPermission(l, e.target.value)}
                  aria-label={`What ${l.name || "the teacher"} can do`}
                >
                  <option value="assign">Add work, mark</option>
                  <option value="view">Only look</option>
                </select>
              )}
              <button type="button" className={d.linkBtn} onClick={() => remove(l)} aria-label={`Remove ${l.name || "teacher"}`}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
