"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BookPlus, FolderInput, MoreHorizontal, Palette, Plus, Share2, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { COVER_COLORS, PAGE_SIZES, defaultPageSize, newNotebook } from "@/lib/notebook";
import { PaperChoices } from "./NotebookBits";
import { track } from "@/lib/track";
import h from "@/app/Home.module.css";
import d from "./Dialog.module.css";
import sh from "./Shelf.module.css";

const ALL = "all";
const NONE = "none";

// Your notebooks and subjects, in one request (list_notebooks). null when
// the database hasn't got notebooks yet (then the shelf isn't shown).
// { failed: true } when it couldn't be asked just now.
async function loadShelf() {
  try {
    const { data, error } = await supabase.rpc("list_notebooks");
    if (error) {
      const code = String(error.code || "");
      const missing = code === "PGRST202" || code === "42883" || /could not find the function|does not exist/i.test(String(error.message || ""));
      return missing ? null : { failed: true };
    }
    if (!data || !Array.isArray(data.notebooks)) return null;
    return { notebooks: data.notebooks, subjects: Array.isArray(data.subjects) ? data.subjects : [] };
  } catch (err) {
    return { failed: true };
  }
}

function coverOf(nb) {
  const c = nb && nb.cover;
  return {
    color: (c && typeof c.color === "string" && /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : COVER_COLORS[0][1]),
    emoji: (c && typeof c.emoji === "string" && c.emoji) || "",
  };
}

// A notebook's cover (also the preview in the dialogs).
export function Cover({ name, cover, small = false }) {
  return (
    <span className={sh.cover} style={{ background: cover.color, display: "block", ...(small ? { width: 96 } : null) }} aria-hidden="true">
      <span className={sh.coverLabel} style={small ? { fontSize: 10.5, left: 18, right: 8, padding: "6px 6px 7px" } : undefined}>
        {name || "Untitled notebook"}
      </span>
      {cover.emoji && <span className={sh.emoji}>{cover.emoji}</span>}
    </span>
  );
}

// The notebooks shelf on the home screen: subjects along the top, then
// the notebooks (most recently used first).
export default function NotebookShelf({ user, query, onOpen, onShare }) {
  const [shelf, setShelf] = useState(null); // { notebooks, subjects } | null (not set up)
  const [loaded, setLoaded] = useState(false);
  const [subject, setSubject] = useState(ALL);
  const [dialog, setDialog] = useState(null); // { kind: "new" | "cover" | "move" | "subject" | "delete" | "deleteSubject", ... }
  const [menuFor, setMenuFor] = useState(null);
  const reloadRef = useRef(0);

  async function reload() {
    const gen = ++reloadRef.current;
    const next = await loadShelf();
    if (gen !== reloadRef.current) return;
    setShelf(next);
    setLoaded(true);
  }

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    loadShelf().then((next) => {
      if (cancelled) return;
      setShelf(next);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // close the ⋯ menu on a tap elsewhere
  useEffect(() => {
    if (!menuFor) return undefined;
    function handle(e) {
      if (e.target.closest && e.target.closest("[data-shelf-menu]")) return;
      setMenuFor(null);
    }
    document.addEventListener("pointerdown", handle);
    return () => document.removeEventListener("pointerdown", handle);
  }, [menuFor]);

  if (!loaded || !shelf) return null;
  if (shelf.failed) {
    return (
      <section aria-labelledby="notebooks-heading" data-notebook-shelf="true">
        <h1 id="notebooks-heading" className={h.heading}>Your notebooks</h1>
        <div className={h.errorBox} style={{ marginTop: 14 }}>
          Couldn&apos;t load your notebooks. Check your connection, then{" "}
          <button type="button" className={sh.linkBtn} onClick={reload}>
            try again
          </button>
          .
        </div>
      </section>
    );
  }

  const subjects = shelf.subjects;
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const q = String(query || "").trim().toLowerCase();
  const shown = shelf.notebooks.filter((nb) => {
    if (q && !String(nb.name || "Untitled notebook").toLowerCase().includes(q)) return false;
    if (subject === ALL) return true;
    if (subject === NONE) return !nb.subject_id || !subjectById.has(nb.subject_id);
    return nb.subject_id === subject;
  });
  const activeSubject = subjectById.get(subject) || null;

  function patchNotebook(id, patch) {
    setShelf((prev) => (prev ? { ...prev, notebooks: prev.notebooks.map((nb) => (nb.id === id ? { ...nb, ...patch } : nb)) } : prev));
  }

  async function createNotebook({ name, subjectId, color, emoji, paper, size }) {
    setDialog(null);
    const notebook = newNotebook({ size, paper, color, emoji });
    const row = { name: name || "Untitled notebook", owner_id: user.id, kind: "notebook", notebook, background: "blank" };
    if (subjectId) row.subject_id = subjectId;
    const { data, error } = await supabase.from("boards").insert(row).select("id").single();
    if (error || !data) {
      alert("Couldn't make the notebook: " + ((error && error.message) || "please try again."));
      return;
    }
    track("notebook_created", { paper, size });
    onOpen(data.id);
  }

  // The cover and name (a whole notebook update would race the board: only
  // the cover part of it is changed, via the saved copy).
  // Only the name and cover change (the pages are left alone, even if
  // the notebook is open and being changed elsewhere).
  async function saveCover(nb, { name, color: picked, emoji }) {
    setDialog(null);
    const color = String(picked || "").toLowerCase();
    const nextName = name || "Untitled notebook";
    patchNotebook(nb.id, { name: nextName, cover: { color, emoji } });
    const { data, error } = await supabase.rpc("notebook_set_cover", { p_board: nb.id, p_name: nextName, p_cover: { color, emoji } });
    if (error || data === false) {
      alert("Couldn't change the cover just now. Please try again.");
      reload();
    }
  }

  async function moveTo(nb, subjectId) {
    setDialog(null);
    patchNotebook(nb.id, { subject_id: subjectId });
    const { error } = await supabase.from("boards").update({ subject_id: subjectId }).eq("id", nb.id);
    if (error) {
      alert("Couldn't move it: " + error.message);
      reload();
    }
  }

  async function removeNotebook(nb) {
    setDialog(null);
    const { error } = await supabase.from("boards").delete().eq("id", nb.id);
    if (error) {
      alert("Couldn't delete it: " + error.message);
      return;
    }
    setShelf((prev) => (prev ? { ...prev, notebooks: prev.notebooks.filter((x) => x.id !== nb.id) } : prev));
  }

  // (`fromDialog`: the subject's own dialog, which then closes; a subject
  // added from inside another dialog leaves that one open)
  async function saveSubject({ id, name, color }, fromDialog = false) {
    if (fromDialog) setDialog(null);
    if (id) {
      setShelf((prev) => (prev ? { ...prev, subjects: prev.subjects.map((s) => (s.id === id ? { ...s, name, color } : s)) } : prev));
      const { error } = await supabase.from("subjects").update({ name, color }).eq("id", id);
      if (error) {
        alert("Couldn't rename the subject: " + error.message);
        reload();
      }
      return null;
    }
    const position = subjects.length ? Math.max(...subjects.map((s) => s.position || 0)) + 1 : 0;
    const { data, error } = await supabase.from("subjects").insert({ name, color, owner_id: user.id, position }).select("id, name, color, position").single();
    if (error || !data) {
      alert("Couldn't add the subject: " + ((error && error.message) || "please try again."));
      return null;
    }
    setShelf((prev) => (prev ? { ...prev, subjects: [...prev.subjects, data] } : prev));
    return data;
  }

  async function removeSubject(s) {
    setDialog(null);
    const { error } = await supabase.from("subjects").delete().eq("id", s.id);
    if (error) {
      alert("Couldn't delete the subject: " + error.message);
      return;
    }
    setSubject(ALL);
    setShelf((prev) =>
      prev
        ? {
            subjects: prev.subjects.filter((x) => x.id !== s.id),
            notebooks: prev.notebooks.map((nb) => (nb.subject_id === s.id ? { ...nb, subject_id: null } : nb)),
          }
        : prev
    );
  }

  const count = shelf.notebooks.length;

  return (
    <section aria-labelledby="notebooks-heading" style={{ display: "flex", flexDirection: "column", gap: 18 }} data-notebook-shelf="true">
      <div className={h.headRow}>
        <div>
          <h1 id="notebooks-heading" className={h.heading}>Your notebooks</h1>
          <p className={h.subheading}>
            {count === 0 ? "Notes, organised by subject" : `${count} notebook${count === 1 ? "" : "s"} · most recently used first`}
          </p>
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" className={h.primaryBtn} onClick={() => setDialog({ kind: "new", subjectId: activeSubject ? activeSubject.id : null })}>
          <BookPlus size={18} strokeWidth={2.2} />
          New notebook
        </button>
      </div>

      {(subjects.length > 0 || count > 0) && (
        <div className={sh.chips} role="tablist" aria-label="Subjects">
          <button type="button" role="tab" aria-selected={subject === ALL} className={`${sh.chip} ${subject === ALL ? sh.chipOn : ""}`} onClick={() => setSubject(ALL)}>
            All
          </button>
          {subjects.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={subject === s.id}
              className={`${sh.chip} ${subject === s.id ? sh.chipOn : ""}`}
              onClick={() => setSubject(s.id)}
            >
              <span className={sh.dot} style={{ background: s.color || "#8C99AD" }} aria-hidden="true" />
              {s.name}
            </button>
          ))}
          {subjects.length > 0 && shelf.notebooks.some((nb) => !nb.subject_id) && (
            <button type="button" role="tab" aria-selected={subject === NONE} className={`${sh.chip} ${subject === NONE ? sh.chipOn : ""}`} onClick={() => setSubject(NONE)}>
              No subject
            </button>
          )}
          <button type="button" className={`${sh.chip} ${sh.chipAdd}`} onClick={() => setDialog({ kind: "subject" })}>
            <Plus size={15} /> Subject
          </button>
          {activeSubject && (
            <span className={sh.subjectTools}>
              <button type="button" className={sh.linkBtn} onClick={() => setDialog({ kind: "subject", subject: activeSubject })}>
                Rename
              </button>
              <button type="button" className={`${sh.linkBtn} ${sh.linkDanger}`} onClick={() => setDialog({ kind: "deleteSubject", subject: activeSubject })}>
                Delete subject
              </button>
            </span>
          )}
        </div>
      )}

      {q && shown.length === 0 && count > 0 ? (
        <p className={sh.emptyShelf}>No notebooks match “{String(query).trim()}”.</p>
      ) : (
        <div className={sh.grid}>
          {!q && (
            <button type="button" className={sh.newBook} onClick={() => setDialog({ kind: "new", subjectId: activeSubject ? activeSubject.id : null })}>
              <Plus size={26} strokeWidth={1.8} />
              New notebook
              <span className={sh.newHint}>{count === 0 ? "Lined, squared, dotted or Cornell pages" : activeSubject ? `In ${activeSubject.name}` : "Pick a cover and paper"}</span>
            </button>
          )}
          {shown.map((nb) => {
            const cover = coverOf(nb);
            const subj = nb.subject_id ? subjectById.get(nb.subject_id) : null;
            const open = menuFor === nb.id;
            const name = nb.name || "Untitled notebook";
            const pages = Number(nb.pages) || 1;
            return (
              <div key={nb.id} className={sh.book}>
                <Link href={`/board/${nb.id}`} className={sh.bookLink}>
                  <Cover name={name} cover={cover} />
                  <span className={sh.bookMeta}>
                    <span className={sh.bookTitle}>{name}</span>
                    <span className={sh.bookSub}>{[`${pages} page${pages === 1 ? "" : "s"}`, subj ? subj.name : ""].filter(Boolean).join(" · ")}</span>
                  </span>
                </Link>
                <div className={sh.more}>
                  <button
                    type="button"
                    data-shelf-menu="true"
                    className={`${h.moreBtn} ${open ? h.moreBtnOpen : ""}`}
                    style={{ position: "static" }}
                    aria-label={`More options for ${name}`}
                    aria-haspopup="menu"
                    aria-expanded={open}
                    onClick={() => setMenuFor(open ? null : nb.id)}
                  >
                    <MoreHorizontal size={18} />
                  </button>
                  {open && (
                    <div className={h.cardMenu} role="menu" data-shelf-menu="true">
                      <button type="button" role="menuitem" className={h.menuItem} onClick={() => { setMenuFor(null); setDialog({ kind: "cover", notebook: nb }); }}>
                        <Palette size={16} /> Name and cover
                      </button>
                      <button type="button" role="menuitem" className={h.menuItem} onClick={() => { setMenuFor(null); setDialog({ kind: "move", notebook: nb }); }}>
                        <FolderInput size={16} /> Move to a subject
                      </button>
                      {onShare && (
                        <button type="button" role="menuitem" className={h.menuItem} onClick={() => { setMenuFor(null); onShare(nb); }}>
                          <Share2 size={16} /> Share
                        </button>
                      )}
                      <button type="button" role="menuitem" className={`${h.menuItem} ${h.menuItemDanger}`} onClick={() => { setMenuFor(null); setDialog({ kind: "delete", notebook: nb }); }}>
                        <Trash2 size={16} /> Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {dialog && dialog.kind === "new" && (
        <NotebookDialog
          title="New notebook"
          submit="Make the notebook"
          subjects={subjects}
          initial={{ name: "", subjectId: dialog.subjectId || null, color: COVER_COLORS[(count + 1) % COVER_COLORS.length][1], emoji: "", paper: "lined", size: defaultPageSize() }}
          withPages
          onAddSubject={saveSubject}
          onClose={() => setDialog(null)}
          onSave={createNotebook}
        />
      )}
      {dialog && dialog.kind === "cover" && (
        <NotebookDialog
          title="Name and cover"
          submit="Save"
          subjects={subjects}
          initial={{ name: dialog.notebook.name || "", color: coverOf(dialog.notebook).color, emoji: coverOf(dialog.notebook).emoji }}
          onClose={() => setDialog(null)}
          onSave={(v) => saveCover(dialog.notebook, v)}
        />
      )}
      {dialog && dialog.kind === "move" && (
        <MoveDialog
          notebook={dialog.notebook}
          subjects={subjects}
          onAddSubject={saveSubject}
          onClose={() => setDialog(null)}
          onMove={(id) => moveTo(dialog.notebook, id)}
        />
      )}
      {dialog && dialog.kind === "subject" && (
        <SubjectDialog subject={dialog.subject || null} onClose={() => setDialog(null)} onSave={(v) => saveSubject(v, true)} />
      )}
      {dialog && dialog.kind === "delete" && (
        <ConfirmDialog
          title={`Delete “${dialog.notebook.name || "Untitled notebook"}”?`}
          text="Every page and everything written on them is deleted, for everyone it's shared with. This can't be undone."
          confirm="Delete notebook"
          onClose={() => setDialog(null)}
          onConfirm={() => removeNotebook(dialog.notebook)}
        />
      )}
      {dialog && dialog.kind === "deleteSubject" && (
        <ConfirmDialog
          title={`Delete the subject “${dialog.subject.name}”?`}
          text="Its notebooks aren't deleted: they move to No subject."
          confirm="Delete subject"
          onClose={() => setDialog(null)}
          onConfirm={() => removeSubject(dialog.subject)}
        />
      )}
    </section>
  );
}

// Making a notebook (name, subject, cover, first page's paper, page size),
// or changing its name and cover.
function NotebookDialog({ title, submit, subjects, initial, withPages = false, onAddSubject, onClose, onSave }) {
  const [name, setName] = useState(initial.name || "");
  const [subjectId, setSubjectId] = useState(initial.subjectId || "");
  const [color, setColor] = useState(initial.color);
  const [emoji, setEmoji] = useState(initial.emoji || "");
  const [paper, setPaper] = useState(initial.paper || "lined");
  const [size, setSize] = useState(initial.size || "a4");
  const [list, setList] = useState(subjects);

  async function addSubject(clean) {
    if (!onAddSubject) return false;
    const made = await onAddSubject({ name: clean, color: color });
    if (!made) return false;
    setList((prev) => [...prev, made]);
    setSubjectId(made.id);
    return true;
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSave({
      name: name.trim().slice(0, 80),
      subjectId: subjectId || null,
      color,
      emoji: Array.from(emoji.trim()).slice(0, 2).join(""),
      paper,
      size,
    });
  }

  return (
    <div className={d.overlay} onClick={onClose}>
      <form className={d.card} onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit} role="dialog" aria-modal="true" aria-labelledby="nb-dialog-title" style={{ maxWidth: 520 }}>
        <div className={d.header}>
          <div className={d.titleBlock}>
            <h2 id="nb-dialog-title" className={d.title}>{title}</h2>
            {withPages && <p className={d.subtitle}>Every page can have its own paper, and you can add, move or copy pages any time.</p>}
          </div>
          <button type="button" className={d.close} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            <label className={d.label}>
              Name
              <input autoFocus className={d.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Physics: Forces" maxLength={80} />
            </label>
            {withPages && (
              <label className={d.label}>
                Subject
                <span className={sh.twoCol}>
                  <select className={sh.select} value={subjectId} onChange={(e) => setSubjectId(e.target.value)} aria-label="Subject">
                    <option value="">No subject</option>
                    {list.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </span>
                {onAddSubject && <NewSubjectField onAdd={addSubject} />}
              </label>
            )}
          </div>
          <div style={{ width: 96, flexShrink: 0 }}>
            <Cover name={name || "Untitled notebook"} cover={{ color, emoji: Array.from(emoji.trim()).slice(0, 2).join("") }} small />
          </div>
        </div>

        <div className={d.label} style={{ marginTop: 12 }}>
          Cover
          <div className={sh.swatches} role="radiogroup" aria-label="Cover colour">
            {COVER_COLORS.map(([label, hex]) => (
              <button
                key={hex}
                type="button"
                role="radio"
                aria-checked={color === hex}
                aria-label={label}
                title={label}
                className={`${sh.swatch} ${color === hex ? sh.swatchOn : ""}`}
                style={{ background: hex }}
                onClick={() => setColor(hex)}
              />
            ))}
          </div>
        </div>
        <label className={d.label} style={{ marginTop: 12 }}>
          A sticker for the cover (optional)
          <input className={d.input} value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="e.g. 🧪" style={{ maxWidth: 140 }} aria-label="Cover sticker (an emoji)" />
        </label>

        {withPages && (
          <>
            <div className={d.label} style={{ marginTop: 12 }}>
              First page
              <PaperChoices value={paper} color="#ffffff" onPick={setPaper} />
            </div>
            <div className={d.label} style={{ marginTop: 12 }}>
              Page size
              <span className={sh.segment} role="radiogroup" aria-label="Page size">
                {Object.entries(PAGE_SIZES).map(([id, info]) => (
                  <button key={id} type="button" role="radio" aria-checked={size === id} onClick={() => setSize(id)}>
                    {info.label}
                  </button>
                ))}
              </span>
            </div>
          </>
        )}

        <div className={d.actions} style={{ marginTop: 16 }}>
          <button type="button" className={d.btn} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${d.btn} ${d.btnPrimary}`}>
            {submit}
          </button>
        </div>
      </form>
    </div>
  );
}

function MoveDialog({ notebook, subjects, onAddSubject, onClose, onMove }) {
  const [list, setList] = useState(subjects);
  const [pick, setPick] = useState(notebook.subject_id || "");

  async function addSubject(clean) {
    const made = await onAddSubject({ name: clean, color: null });
    if (!made) return false;
    setList((prev) => [...prev, made]);
    setPick(made.id);
    return true;
  }

  return (
    <div className={d.overlay} onClick={onClose}>
      <div className={d.card} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="nb-move-title">
        <div className={d.header}>
          <div className={d.titleBlock}>
            <h2 id="nb-move-title" className={d.title}>Move “{notebook.name || "Untitled notebook"}”</h2>
          </div>
          <button type="button" className={d.close} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div role="radiogroup" aria-label="Subject" style={{ display: "flex", flexDirection: "column", gap: 10, margin: "4px 0 12px" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="radio" name="nb-move" checked={!pick} onChange={() => setPick("")} /> No subject
          </label>
          {list.map((s) => (
            <label key={s.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="radio" name="nb-move" checked={pick === s.id} onChange={() => setPick(s.id)} />
              <span className={sh.dot} style={{ background: s.color || "#8C99AD" }} aria-hidden="true" />
              {s.name}
            </label>
          ))}
          <NewSubjectField onAdd={addSubject} />
        </div>
        <div className={d.actions}>
          <button type="button" className={d.btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={`${d.btn} ${d.btnPrimary}`} onClick={() => onMove(pick || null)}>
            Move
          </button>
        </div>
      </div>
    </div>
  );
}

// "+ New subject" inside another dialog: opens a small name field in
// place (no browser pop-up: some browsers and app windows don't allow
// them). Enter adds it without sending the dialog it sits in.
function NewSubjectField({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    const clean = name.trim().slice(0, 60);
    if (!clean || busy) return;
    setBusy(true);
    const ok = await onAdd(clean);
    setBusy(false);
    if (ok) {
      setName("");
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className={d.btn} onClick={() => setOpen(true)} style={{ alignSelf: "flex-start" }} data-new-subject="true">
        <Plus size={15} /> New subject
      </button>
    );
  }
  return (
    <span className={sh.twoCol} style={{ alignItems: "center" }}>
      <input
        autoFocus
        className={d.input}
        style={{ flex: 1, minWidth: 140 }}
        value={name}
        maxLength={60}
        placeholder="Like Maths or Physics"
        aria-label="Name of the new subject"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            setName("");
          }
        }}
      />
      <button type="button" className={`${d.btn} ${d.btnPrimary}`} onClick={add} disabled={!name.trim() || busy}>
        {busy ? "Adding…" : "Add"}
      </button>
      <button type="button" className={d.btn} onClick={() => { setOpen(false); setName(""); }}>
        Cancel
      </button>
    </span>
  );
}

function SubjectDialog({ subject, onClose, onSave }) {
  const [name, setName] = useState(subject ? subject.name : "");
  const [color, setColor] = useState((subject && subject.color) || COVER_COLORS[0][1]);
  return (
    <div className={d.overlay} onClick={onClose}>
      <form
        className={d.card}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          const clean = name.trim().slice(0, 60);
          if (clean) onSave({ id: subject ? subject.id : null, name: clean, color });
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nb-subject-title"
      >
        <div className={d.header}>
          <div className={d.titleBlock}>
            <h2 id="nb-subject-title" className={d.title}>{subject ? "Rename subject" : "New subject"}</h2>
            {!subject && <p className={d.subtitle}>Like Maths, Physics or English. Notebooks can be moved into it.</p>}
          </div>
          <button type="button" className={d.close} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <label className={d.label}>
          Name
          <input autoFocus className={d.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chemistry" maxLength={60} />
        </label>
        <div className={d.label} style={{ marginTop: 12 }}>
          Colour
          <div className={sh.swatches} role="radiogroup" aria-label="Subject colour">
            {COVER_COLORS.map(([label, hex]) => (
              <button
                key={hex}
                type="button"
                role="radio"
                aria-checked={color === hex}
                aria-label={label}
                className={`${sh.swatch} ${color === hex ? sh.swatchOn : ""}`}
                style={{ background: hex }}
                onClick={() => setColor(hex)}
              />
            ))}
          </div>
        </div>
        <div className={d.actions} style={{ marginTop: 16 }}>
          <button type="button" className={d.btn} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${d.btn} ${d.btnPrimary}`} disabled={!name.trim()}>
            {subject ? "Save" : "Add subject"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ConfirmDialog({ title, text, confirm, onClose, onConfirm }) {
  return (
    <div className={d.overlay} onClick={onClose}>
      <div className={d.card} onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="nb-confirm-title">
        <div className={d.header}>
          <div className={d.titleBlock}>
            <h2 id="nb-confirm-title" className={d.title}>{title}</h2>
            <p className={d.subtitle}>{text}</p>
          </div>
        </div>
        <div className={d.actions}>
          <button type="button" className={d.btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={`${d.btn} ${d.btnDanger}`} onClick={onConfirm}>
            {confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
