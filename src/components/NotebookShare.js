"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Link2, RefreshCw, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { track } from "@/lib/track";
import d from "./Dialog.module.css";
import n from "./Notebook.module.css";
import NotebookTeachers from "./NotebookTeachers";

// The address of a notebook's link (src/app/n/[token]/page.js).
export function notebookLinkUrl(token) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/n/${token}`;
}

const MODES = [
  { id: "off", title: "Off", desc: "Only you, and the people you add below." },
  { id: "view", title: "Anyone with the link can look", desc: "No account needed. They can read it, peek under the tape and download it as a PDF." },
  { id: "edit", title: "Anyone with the link can write on it too", desc: "They sign in first, then it's on their shelf and you write on it together." },
];

// Sharing a notebook (the owner): by link (supabase/2026-11-notebooks-sharing.sql)
// and with people by email (as for boards). Reads what's saved now, so it's
// right however it was changed last.
export default function NotebookShare({ boardId, name, onClose }) {
  const [loaded, setLoaded] = useState(false);
  const [linkReady, setLinkReady] = useState(true); // the database has links
  const [mode, setMode] = useState("off");
  const [token, setToken] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [copied, setCopied] = useState(false);
  const [people, setPeople] = useState([]);
  const [email, setEmail] = useState("");
  const linkInputRef = useRef(null);
  const copiedTimer = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    let live = true;
    (async () => {
      const withLink = await supabase.from("boards").select("id, shared_with, share_mode, share_token").eq("id", boardId).maybeSingle();
      if (!live) return;
      if (withLink.error) {
        // (the link columns aren't in the database yet: sharing by email still works)
        const plain = await supabase.from("boards").select("id, shared_with").eq("id", boardId).maybeSingle();
        if (!live) return;
        setLinkReady(false);
        if (plain.data) setPeople(plain.data.shared_with || []);
      } else if (withLink.data) {
        setMode(withLink.data.share_mode || "off");
        setToken(withLink.data.share_token || null);
        setPeople(withLink.data.shared_with || []);
      }
      setLoaded(true);
    })();
    function onKey(e) {
      if (e.key === "Escape") closeRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      live = false;
      window.removeEventListener("keydown", onKey);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, [boardId]);

  async function changeLink(next, fresh = false) {
    if (busy) return;
    setBusy(true);
    setProblem("");
    const { data, error } = await supabase.rpc("notebook_link", { p_board: boardId, p_mode: next, p_new: fresh });
    setBusy(false);
    if (error || !data) {
      setProblem("That didn't work. Check your connection and try again.");
      return;
    }
    setMode(data.mode);
    setToken(data.token || null);
    setCopied(false);
    track("notebook_link_changed", { mode: data.mode, fresh });
  }

  async function copyLink() {
    if (!token) return;
    const url = notebookLinkUrl(token);
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch (err) {
      ok = false;
    }
    if (!ok && linkInputRef.current) {
      // no clipboard here: the link is selected, ready to copy by hand
      linkInputRef.current.focus();
      linkInputRef.current.select();
      return;
    }
    setCopied(true);
    track("notebook_link_copied", { mode });
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2500);
  }

  async function savePeople(list) {
    const before = people;
    setPeople(list);
    const { error } = await supabase.from("boards").update({ shared_with: list }).eq("id", boardId);
    if (error) {
      setPeople(before);
      setProblem("Couldn't change who it's shared with. Please try again.");
    }
  }

  function addPerson(e) {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setProblem("Type an email address, like name@example.com.");
      return;
    }
    setProblem("");
    setEmail("");
    if (!people.includes(address)) savePeople([...people, address]);
  }

  const url = token ? notebookLinkUrl(token) : "";

  return (
    <div className={d.overlay} onClick={onClose} data-notebook-share-dialog="true">
      <div className={d.card} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="nb-share-title" style={{ width: 480 }}>
        <div className={d.header}>
          <div className={d.titleBlock}>
            <h2 id="nb-share-title" className={d.title}>Share “{name || "Untitled notebook"}”</h2>
            <p className={d.subtitle}>Send it to a classmate, a study group or your teacher.</p>
          </div>
          <button type="button" className={d.close} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {!loaded ? (
          <p className={d.note}>Loading…</p>
        ) : (
          <>
            <div className={d.label} style={{ gap: 10 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Link2 size={16} aria-hidden="true" /> Share with a link
              </span>
              {linkReady ? (
                <div role="radiogroup" aria-label="Who the link works for" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {MODES.map((m) => (
                    <label key={m.id} className={n.choice} style={{ alignItems: "flex-start", fontWeight: 400 }}>
                      <input
                        type="radio"
                        name="nb-link-mode"
                        checked={mode === m.id}
                        disabled={busy}
                        onChange={() => changeLink(m.id)}
                        style={{ marginTop: 3 }}
                        data-link-mode={m.id}
                      />
                      <span>
                        <strong>{m.title}</strong>
                        <br />
                        <span className={n.note}>{m.desc}</span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className={d.note}>Sharing by link needs the November database update (supabase/2026-11-notebooks-sharing.sql).</p>
              )}
              {linkReady && mode !== "off" && token && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      ref={linkInputRef}
                      className={d.input}
                      readOnly
                      value={url}
                      aria-label="The notebook's link"
                      onFocus={(e) => e.target.select()}
                      style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}
                      data-notebook-link="true"
                    />
                    <button type="button" className={`${d.btn} ${d.btnPrimary}`} onClick={copyLink} data-copy-link="true">
                      <Copy size={15} /> {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <button type="button" className={d.linkBtn} onClick={() => changeLink(mode, true)} disabled={busy} style={{ alignSelf: "flex-start" }}>
                    <RefreshCw size={13} aria-hidden="true" /> Make a new link (the old one stops working)
                  </button>
                </div>
              )}
            </div>

            <NotebookTeachers boardId={boardId} />

            <form className={d.label} onSubmit={addPerson} style={{ gap: 8 }}>
              Add people by email
              <span style={{ display: "flex", gap: 8 }}>
                <input
                  type="email"
                  className={d.input}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  autoComplete="off"
                  style={{ flex: 1, minWidth: 0 }}
                  aria-label="Email address"
                />
                <button type="submit" className={d.btn} disabled={!email.trim()}>
                  Add
                </button>
              </span>
            </form>

            {problem && (
              <p className={d.note} role="alert" style={{ color: "#b42318" }}>
                {problem}
              </p>
            )}

            <div className={d.people}>
              <div className={d.peopleHeading}>Who can write on it</div>
              {people.length === 0 ? (
                <div className={d.note}>Only you so far.</div>
              ) : (
                people.map((p) => (
                  <div key={p} className={d.person}>
                    <span className={d.avatar}>{p.charAt(0)}</span>
                    <span className={d.personEmail}>{p}</span>
                    <button type="button" className={d.linkBtn} onClick={() => savePeople(people.filter((x) => x !== p))} aria-label={`Remove ${p}`}>
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
