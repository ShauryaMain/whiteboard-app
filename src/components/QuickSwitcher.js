"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Clock, LayoutDashboard, Search, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { recentList } from "@/lib/recentBoards";
import d from "./Dialog.module.css";
import q from "./QuickSwitcher.module.css";

// "Go to": find any notebook or board by name and open it (Ctrl/⌘+K, or
// Go to… in the Recent menu). With nothing typed, it shows the ones opened
// last on this device.

async function myNotebooks() {
  try {
    const { data, error } = await supabase.rpc("list_notebooks");
    if (error || !data) return [];
    return (data.notebooks || []).map((nb) => ({ id: nb.id, name: nb.name || "Untitled notebook", kind: "notebook" }));
  } catch (err) {
    return [];
  }
}

async function findBoards(text) {
  const one = async (kind) => {
    try {
      const { data, error } = await supabase.rpc("list_boards", { p_kind: kind, p_search: text || null, p_before: null, p_limit: 12, p_before_id: null });
      if (error || !data) return [];
      return (data.rows || []).map((b) => ({ id: b.id, name: b.name || "Untitled board", kind: b.kind === "notebook" ? "notebook" : "board", shared: kind === "shared" }));
    } catch (err) {
      return [];
    }
  };
  const [mine, shared] = await Promise.all([one("mine"), one("shared")]);
  return [...mine, ...shared];
}

function matches(name, text) {
  return !text || String(name || "").toLowerCase().includes(text.toLowerCase());
}

export default function QuickSwitcher({ currentId = null, onClose }) {
  const router = useRouter();
  const { user } = useAuth() || {};
  const [text, setText] = useState("");
  const [notebooks, setNotebooks] = useState(null);
  const [boards, setBoards] = useState({ text: null, list: [] });
  const [active, setActive] = useState(0);
  const [recent] = useState(() => (user ? recentList(user.id) : []));
  const listRef = useRef(null);

  useEffect(() => {
    let live = true;
    myNotebooks().then((list) => {
      if (live) setNotebooks(list);
    });
    return () => {
      live = false;
    };
  }, []);

  // boards are searched in the database (there can be a great many)
  useEffect(() => {
    const t = text.trim();
    if (!t) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      findBoards(t).then((list) => {
        if (live) setBoards({ text: t, list });
      });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [text]);

  const t = text.trim();
  let rows;
  if (!t) {
    rows = recent.map((r) => ({ ...r, recent: true }));
  } else {
    const seen = new Set();
    rows = [];
    for (const r of [...(notebooks || []).filter((nb) => matches(nb.name, t)), ...(boards.text === t ? boards.list : []).filter((b) => matches(b.name, t))]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      rows.push(r);
    }
    rows = rows.slice(0, 30);
  }
  const at = Math.min(active, Math.max(0, rows.length - 1));
  const searching = !!t && boards.text !== t;

  function open(row) {
    if (!row) return;
    onClose();
    if (row.id !== currentId) router.push(`/board/${row.id}`);
  }

  function onKey(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(rows.length - 1, at + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(0, at - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      open(rows[at]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  // the chosen row stays in view
  useEffect(() => {
    const el = listRef.current && listRef.current.querySelector('[data-active="true"]');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [at]);

  return (
    <div className={d.overlay} style={{ alignItems: "flex-start", paddingTop: "min(14vh, 120px)" }} onClick={onClose} data-quick-switcher="true">
      <div className={`${d.card} ${q.card}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Go to a notebook or board">
        <div className={q.searchRow}>
          <Search size={18} aria-hidden="true" />
          <input
            className={q.input}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
            placeholder="Go to a notebook or board…"
            aria-label="Go to a notebook or board"
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="quick-switcher-list"
            aria-activedescendant={rows[at] ? `qs-${rows[at].id}` : undefined}
            data-quick-input="true"
          />
          <button type="button" className={d.close} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {!t && <div className={q.heading}>{recent.length ? "Opened lately on this device" : "Type to find a notebook or board"}</div>}
        <div className={q.list} id="quick-switcher-list" role="listbox" ref={listRef}>
          {rows.map((row, i) => (
            <button
              key={row.id}
              id={`qs-${row.id}`}
              type="button"
              role="option"
              aria-selected={i === at}
              data-active={i === at ? "true" : undefined}
              className={`${q.row} ${i === at ? q.rowOn : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => open(row)}
              data-quick-row={row.id}
            >
              {row.kind === "notebook" ? <BookOpen size={16} aria-hidden="true" /> : <LayoutDashboard size={16} aria-hidden="true" />}
              <span className={q.name}>{row.name || (row.kind === "notebook" ? "Untitled notebook" : "Untitled board")}</span>
              <span className={q.meta}>
                {row.id === currentId ? "open now" : row.recent ? <Clock size={13} aria-label="opened lately" /> : row.shared ? "shared with you" : row.kind === "notebook" ? "notebook" : "board"}
              </span>
            </button>
          ))}
          {t && !rows.length && <p className={q.empty}>{searching ? "Looking…" : "Nothing called that."}</p>}
        </div>
        <div className={q.foot}>
          <span>↑↓ to choose</span>
          <span>Enter to open</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );
}
