"use client";

import { useState, useEffect, useRef } from "react";
import { Copy, Link2, RefreshCw, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { boardLink, boardLinkUrl } from "@/lib/boardLink";
import { track } from "@/lib/track";
import d from "./Dialog.module.css";
import n from "./Notebook.module.css";

// Suggestions while typing an address: people this teacher already shares
// boards with (share_suggestions). Nobody else's address can be looked up.
// (Before the database had that, any account's address could be suggested.)
async function suggestPeople(query) {
  try {
    const { data, error } = await supabase.rpc("share_suggestions", { p_query: query });
    if (!error && Array.isArray(data)) return data.filter((e) => typeof e === "string");
    const old = await supabase.from("profiles").select("email").ilike("email", `%${query}%`).limit(5);
    if (!old.error && old.data) return old.data.map((row) => row.email);
  } catch (err) {
    // offline: no suggestions
  }
  return null;
}

const LINK_MODES = [
  { on: false, title: "Only people added here", desc: "Nobody else can open it, even with its address." },
  { on: true, title: "Anyone with the link can edit", desc: "Whoever opens the link and signs in is added below." },
];

// The board's link: on or off, copy it, or swap it for a new one.
function BoardLinkSection({ boardId }) {
  const [link, setLink] = useState(null); // null loading | { on, token, legacy } | { missing } | { error }
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    let live = true;
    boardLink(boardId).then((r) => {
      if (live) setLink(r);
    });
    return () => {
      live = false;
    };
  }, [boardId]);

  async function change(on, fresh = false) {
    setBusy(true);
    const r = await boardLink(boardId, on, fresh);
    setBusy(false);
    if (r && !r.error && !r.missing) {
      setLink(r);
      setCopied(false);
      track("board_link_changed", { on, fresh });
    } else {
      setLink((was) => ({ ...(was || {}), problem: true }));
    }
  }

  async function copy() {
    if (!link || !link.token) return;
    try {
      await navigator.clipboard.writeText(boardLinkUrl(link.token));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      // no clipboard here: the link is selected, ready to copy by hand
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }
  }

  if (!link) return <p className={d.note}>Loading the link…</p>;
  if (link.missing || (link.error && !("on" in link))) {
    return link.missing ? null : <p className={d.note}>Couldn&apos;t load the board&apos;s link. Check your connection.</p>;
  }
  return (
    <div className={d.label} style={{ gap: 10, marginTop: 4 }} data-board-link={link.on ? "on" : "off"}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Link2 size={16} aria-hidden="true" /> Link
      </span>
      <div role="radiogroup" aria-label="Who the link works for" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {LINK_MODES.map((m) => (
          <label key={String(m.on)} className={n.choice} style={{ alignItems: "flex-start", fontWeight: 400 }}>
            <input
              type="radio"
              name="board-link-mode"
              checked={!!link.on === m.on}
              disabled={busy}
              onChange={() => change(m.on)}
              style={{ marginTop: 3 }}
              data-board-link-mode={m.on ? "on" : "off"}
            />
            <span>
              <strong>{m.title}</strong>
              <br />
              <span className={n.note}>{m.desc}</span>
            </span>
          </label>
        ))}
      </div>
      {link.on && link.token && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              ref={inputRef}
              className={d.input}
              readOnly
              value={boardLinkUrl(link.token)}
              aria-label="The board's link"
              onFocus={(e) => e.target.select()}
              style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}
              data-board-link-url="true"
            />
            <button type="button" className={`${d.btn} ${d.btnPrimary}`} onClick={copy}>
              <Copy size={15} /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <button type="button" className={d.linkBtn} onClick={() => change(true, true)} disabled={busy} style={{ alignSelf: "flex-start" }} data-board-link-new="true">
            <RefreshCw size={13} aria-hidden="true" /> Make a new link (the old one stops working)
          </button>
        </div>
      )}
      {link.on && !link.token && (
        <button type="button" className={d.btn} onClick={() => change(true)} disabled={busy} style={{ alignSelf: "flex-start" }}>
          <Link2 size={15} /> Get the link
        </button>
      )}
      {link.on && link.legacy && (
        <p className={n.note} style={{ margin: 0 }}>
          This board was made before board links, so its address works as a link too. Making a new link (or choosing
          &ldquo;Only people added here&rdquo;) stops that.
        </p>
      )}
      {link.problem && (
        <p className={d.note} role="alert" style={{ color: "#b42318", margin: 0 }}>
          Couldn&apos;t change the link. Please try again.
        </p>
      )}
    </div>
  );
}

// Share a board with other signed-in people by email. Shows who already
// has it, and lets the owner take someone off.
export default function ShareModal({ board, onClose, onShare, onRemove }) {
  const [email, setEmail] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef(null);
  const people = (board && board.shared_with) || [];
  const peopleKey = people.join(",");

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const query = email.trim();
    if (query.length < 2) return undefined;
    debounceRef.current = setTimeout(async () => {
      const emails = await suggestPeople(query);
      if (emails) {
        setSuggestions(
          emails.filter((e) => e && e.toLowerCase() !== query.toLowerCase() && !peopleKey.split(",").includes(e.toLowerCase()))
        );
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [email, peopleKey]);

  const trimmed = email.trim();
  const visibleSuggestions = showSuggestions && trimmed.length >= 2 ? suggestions : [];

  function handleSubmit(e) {
    e.preventDefault();
    if (!trimmed) return;
    onShare(trimmed);
    setEmail("");
    setSuggestions([]);
  }

  function handlePick(suggested) {
    setSuggestions([]);
    setShowSuggestions(false);
    setEmail("");
    onShare(suggested);
  }

  return (
    <div className={d.overlay} onClick={onClose}>
      <form
        className={d.card}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
      >
        <div className={d.header}>
          <div className={d.titleBlock}>
            <h2 id="share-title" className={d.title}>Share “{(board && board.name) || "Untitled board"}”</h2>
            <p className={d.subtitle}>
              People you add can open this board from their own boards list and draw on it with you. Or turn on its link.
            </p>
          </div>
          <button type="button" className={d.close} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <label className={d.label}>
          Email address
          <input
            autoFocus
            type="email"
            className={d.input}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            placeholder="name@example.com"
            autoComplete="off"
          />
        </label>

        {visibleSuggestions.length > 0 && (
          <div className={d.suggestions} role="listbox" aria-label="Matching people">
            {visibleSuggestions.map((s) => (
              <button key={s} type="button" role="option" aria-selected="false" className={d.suggestion} onClick={() => handlePick(s)}>
                {s}
              </button>
            ))}
          </div>
        )}

        <div className={d.actions}>
          <button type="submit" className={`${d.btn} ${d.btnPrimary}`} disabled={!trimmed}>
            Share
          </button>
        </div>

        {board && board.id && <BoardLinkSection boardId={board.id} />}

        <div className={d.people}>
          <div className={d.peopleHeading}>Who has access</div>
          {people.length === 0 ? (
            <div className={d.note}>Only you so far. Students joining a live class don&apos;t need to be added here — they use the class code.</div>
          ) : (
            people.map((p) => (
              <div key={p} className={d.person}>
                <span className={d.avatar}>{p.charAt(0)}</span>
                <span className={d.personEmail}>{p}</span>
                {onRemove && (
                  <button type="button" className={d.linkBtn} onClick={() => onRemove(p)} aria-label={`Remove ${p}`}>
                    Remove
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </form>
    </div>
  );
}
