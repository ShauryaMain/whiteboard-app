"use client";

import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import d from "./Dialog.module.css";

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
      const { data, error } = await supabase
        .from("profiles")
        .select("email")
        .ilike("email", `%${query}%`)
        .limit(5);
      if (!error && data) {
        setSuggestions(
          data
            .map((row) => row.email)
            .filter((e) => e && e.toLowerCase() !== query.toLowerCase() && !peopleKey.split(",").includes(e.toLowerCase()))
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
              People you add can open this board from their own boards list and draw on it with you.
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
