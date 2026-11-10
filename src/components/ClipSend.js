"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FilePlus2, Send, X } from "lucide-react";
import RefPagePicker from "./RefPagePicker";
import { browserCanOpenPdfs, PDF_UNSUPPORTED_MESSAGE } from "@/lib/loadPdfjs";
import {
  call, defaultDue, fromLocalInput, imageFilePage, nudgeNotebooks, pdfFilePages, problemText, toLocalInput, uploadClipPages,
} from "@/lib/teaching";
import { track } from "@/lib/track";
import d from "./Dialog.module.css";
import t from "./Teaching.module.css";

const ONE_TO_ONE = "1:1";

// Sending a clip: pages (from a notebook, a board, or a PDF / pictures
// picked here) into students' notebooks, as homework with a due date or as
// a resource.
//
//   userId        the teacher
//   pages         [{ blob, w, h, pw, ph }] already made, or null (pick files here)
//   title         a title to start from
//   from          where the pages came from ("notebook", "board", "file"), for counting
//   classId       send to this class to start with
//   boardId       or to this one student's notebook
//   onClose, onSent({ clip, sent, skipped })
export default function ClipSend({ userId, pages: given = null, title: startTitle = "", from = "file", classId = null, boardId = null, onClose, onSent }) {
  const [pages, setPages] = useState(given || []);
  const [home, setHome] = useState(null);
  const [dest, setDest] = useState(classId || (boardId ? ONE_TO_ONE : ""));
  const [roster, setRoster] = useState(null); // the chosen class's students
  const [everyone, setEveryone] = useState(true);
  const [chosen, setChosen] = useState(() => new Set(boardId ? [boardId] : []));
  const [kind, setKind] = useState("homework");
  const [title, setTitle] = useState(startTitle);
  const [note, setNote] = useState("");
  const [due, setDue] = useState(() => toLocalInput(defaultDue()));
  const [maxScore, setMaxScore] = useState("");
  const [status, setStatus] = useState(""); // what's happening while sending
  const [error, setError] = useState("");
  const [picker, setPicker] = useState(null); // { file, url }
  const fileRef = useRef(null);

  // where it can go
  useEffect(() => {
    let live = true;
    call("teacher_home").then((res) => {
      if (!live) return;
      const h = res.data || { classes: [], students: [] };
      setHome(h);
      setDest((cur) => cur || (h.classes && h.classes[0] ? h.classes[0].id : h.students && h.students.length ? ONE_TO_ONE : ""));
    });
    return () => {
      live = false;
    };
  }, []);

  // the chosen class's students (for sending to some of them)
  useEffect(() => {
    if (!dest || dest === ONE_TO_ONE) return undefined;
    let live = true;
    call("class_overview", { p_class: dest }).then((res) => {
      if (live) setRoster(res.data ? res.data.students || [] : []);
    });
    return () => {
      live = false;
    };
  }, [dest]);

  // small pictures of the pages
  const thumbs = useMemo(() => pages.map((p) => URL.createObjectURL(p.blob)), [pages]);
  useEffect(() => () => thumbs.forEach((u) => URL.revokeObjectURL(u)), [thumbs]);

  async function addFiles(list) {
    const files = Array.from(list || []);
    if (!files.length) return;
    const pdf = files.find((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (pdf) {
      if (!browserCanOpenPdfs()) {
        setError(PDF_UNSUPPORTED_MESSAGE);
        return;
      }
      setPicker({ file: pdf, url: URL.createObjectURL(pdf) });
      if (!title) setTitle(pdf.name.replace(/\.pdf$/i, "").slice(0, 120));
      return;
    }
    setStatus("Preparing the pictures…");
    const made = [];
    for (const f of files.filter((x) => /^image\//.test(x.type)).slice(0, 30)) {
      const page = await imageFilePage(f);
      if (page) made.push(page);
    }
    setStatus("");
    if (!made.length) {
      setError("Those files couldn't be read. Try a PDF, or photos (JPEG or PNG).");
      return;
    }
    if (!title) setTitle(files[0].name.replace(/\.[a-z0-9]+$/i, "").slice(0, 120));
    setPages((prev) => [...prev, ...made].slice(0, 60));
  }

  async function pdfPicked(picked) {
    const pick = picker;
    setPicker(null);
    if (!pick) return;
    URL.revokeObjectURL(pick.url);
    if (!picked || !picked.length) return;
    setStatus("Preparing the pages…");
    const made = await pdfFilePages(pick.file, picked, (i, n) => setStatus(`Preparing page ${i + 1} of ${n}…`));
    setStatus("");
    if (!made || !made.length) {
      setError("That PDF couldn't be opened. It may be locked or damaged.");
      return;
    }
    setPages((prev) => [...prev, ...made].slice(0, 60));
  }

  const classes = (home && home.classes) || [];
  const oneToOne = ((home && home.students) || []).filter((s) => s.permission !== "view");
  const isClass = dest && dest !== ONE_TO_ONE;
  const targets = isClass ? (everyone ? null : [...chosen]) : [...chosen];
  const ready =
    pages.length > 0 &&
    title.trim() &&
    dest &&
    (isClass ? everyone ? (roster ? roster.length > 0 : true) : chosen.size > 0 : chosen.size > 0) &&
    !status;

  async function send() {
    if (!ready) return;
    setError("");
    if (kind === "homework" && maxScore !== "" && !(Number(maxScore) > 0 && Number(maxScore) <= 1000)) {
      setError("Marks out of: a number from 1 to 1000, or leave it empty.");
      return;
    }
    setStatus("Uploading the pages…");
    const uploaded = await uploadClipPages(userId, pages, (i, n) => setStatus(`Uploading page ${i + 1} of ${n}…`));
    if (!uploaded) {
      setStatus("");
      setError("The pages couldn't be uploaded. Check your connection and try again.");
      return;
    }
    setStatus("Sending…");
    const res = await call("clip_send", {
      p_class: isClass ? dest : null,
      p_boards: targets,
      p_kind: kind,
      p_title: title.trim(),
      p_note: note.trim() || null,
      p_due: kind === "homework" ? fromLocalInput(due) : null,
      p_max: kind === "homework" && maxScore !== "" ? Number(maxScore) : null,
      p_questions: [],
      p_pages: uploaded,
    });
    setStatus("");
    if (!res.data) {
      setError(problemText(res, "It couldn't be sent. Check your connection and try again."));
      return;
    }
    track("clip_sent", { kind, pages: pages.length, notebooks: res.data.sent, from });
    // notebooks open right now load the new pages
    const boards = isClass ? (everyone ? (roster || []).map((s) => s.board).filter(Boolean) : targets) : targets;
    nudgeNotebooks(boards);
    onSent(res.data);
  }

  const toggle = (id) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className={d.overlay} onClick={status ? undefined : onClose} data-board-shortcuts="off">
      <div
        className={d.card}
        style={{ width: "min(560px, calc(100vw - 24px))", maxHeight: "calc(100dvh - 24px)", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="clip-send-title"
        data-clip-send="true"
      >
        <div className={d.header}>
          <div className={d.titleBlock}>
            <h2 id="clip-send-title" className={d.title}>Send to students</h2>
            <p className={d.subtitle}>The pages go at the end of each student&apos;s notebook. They write straight on them.</p>
          </div>
          <button type="button" className={d.close} onClick={onClose} aria-label="Close" disabled={!!status}>
            <X size={18} />
          </button>
        </div>

        <div className={t.field}>
          <span>
            {pages.length ? `${pages.length} page${pages.length === 1 ? "" : "s"}` : "Pages"}
          </span>
          {pages.length > 0 && (
            <div className={t.thumbs}>
              {thumbs.map((u, i) => (
                <span
                  key={u}
                  role="img"
                  aria-label={`Page ${i + 1}`}
                  className={t.thumb}
                  style={{ width: Math.round((110 * ((pages[i] && pages[i].w) || 3)) / Math.max(1, (pages[i] && pages[i].h) || 4)), backgroundImage: `url(${u})`, backgroundSize: "cover" }}
                />
              ))}
            </div>
          )}
          {!given && (
            <div className={t.row}>
              <button type="button" className={`${t.btn} ${t.btnSmall}`} onClick={() => fileRef.current && fileRef.current.click()} disabled={!!status}>
                <FilePlus2 size={15} aria-hidden="true" /> {pages.length ? "Add more" : "Choose a PDF or photos"}
              </button>
              {pages.length > 0 && (
                <button type="button" className={`${t.btn} ${t.btnSmall} ${t.btnQuiet}`} onClick={() => setPages([])} disabled={!!status}>
                  Clear
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,image/*"
                multiple
                hidden
                data-clip-file="true"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
          )}
        </div>

        <label className={t.field} style={{ marginTop: 12 }}>
          Send to
          <select className={t.input} value={dest} onChange={(e) => { setDest(e.target.value); setEveryone(true); setChosen(new Set()); setRoster(null); }} data-clip-dest="true">
            {!home && <option value="">Loading…</option>}
            {home && !classes.length && !oneToOne.length && <option value="">You have no classes or students yet</option>}
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.students} student{c.students === 1 ? "" : "s"})
              </option>
            ))}
            {oneToOne.length > 0 && <option value={ONE_TO_ONE}>One-to-one students</option>}
          </select>
        </label>
        {isClass && (
          <div style={{ marginTop: 8 }}>
            <label className={t.check}>
              <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} /> Everyone in the class
              {roster && roster.length === 0 && <span className={t.warn}> (nobody has joined yet)</span>}
            </label>
            {!everyone && (
              <div className={t.targets}>
                {(roster || []).map((s) => (
                  <label key={s.id} className={t.check}>
                    <input type="checkbox" checked={chosen.has(s.board)} onChange={() => toggle(s.board)} disabled={!s.board} /> {s.name || s.email}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        {dest === ONE_TO_ONE && (
          <div className={t.targets} style={{ marginTop: 8 }}>
            {oneToOne.map((s) => (
              <label key={s.board} className={t.check}>
                <input type="checkbox" checked={chosen.has(s.board)} onChange={() => toggle(s.board)} /> {s.name}
                {s.pending && <span className={t.small}> (invite not opened yet)</span>}
              </label>
            ))}
          </div>
        )}

        <div className={t.row} style={{ marginTop: 14 }}>
          <div className={t.segment} role="radiogroup" aria-label="What it is">
            <button type="button" role="radio" aria-checked={kind === "homework"} className={kind === "homework" ? t.segOn : ""} onClick={() => setKind("homework")}>
              Homework
            </button>
            <button type="button" role="radio" aria-checked={kind === "resource"} className={kind === "resource" ? t.segOn : ""} onClick={() => setKind("resource")}>
              Resource
            </button>
          </div>
          <span className={t.small}>{kind === "homework" ? "Due date, handed in, marked." : "Notes or a worksheet to keep. Nothing to hand in."}</span>
        </div>

        <label className={t.field} style={{ marginTop: 12 }}>
          Title
          <input className={t.input} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Quadratics practice" data-clip-title="true" />
        </label>
        {kind === "homework" && (
          <div className={t.row} style={{ marginTop: 10, alignItems: "flex-end" }}>
            <label className={`${t.field} ${t.grow}`}>
              Due
              <input type="datetime-local" className={t.input} value={due} onChange={(e) => setDue(e.target.value)} data-clip-due="true" />
            </label>
            <label className={t.field} style={{ width: 120 }}>
              Marks out of
              <input type="number" min="1" max="1000" inputMode="decimal" className={t.input} value={maxScore} onChange={(e) => setMaxScore(e.target.value)} placeholder="optional" data-clip-max="true" />
            </label>
          </div>
        )}
        <label className={t.field} style={{ marginTop: 10 }}>
          Note for students (optional)
          <textarea className={t.textarea} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Show your working. Questions 1–6." />
        </label>

        {error && <p className={t.warn} role="alert" style={{ marginTop: 10 }}>{error}</p>}
        <div className={d.actions} style={{ marginTop: 16 }}>
          <span className={t.small} role="status" style={{ marginRight: "auto" }}>{status}</span>
          <button type="button" className={d.btn} onClick={onClose} disabled={!!status}>
            Cancel
          </button>
          <button type="button" className={`${d.btn} ${d.btnPrimary}`} onClick={send} disabled={!ready} data-clip-go="true">
            <Send size={15} aria-hidden="true" /> Send
          </button>
        </div>
      </div>
      {picker &&
        typeof document !== "undefined" &&
        createPortal(
          <RefPagePicker
            url={picker.url}
            fileName={picker.file.name}
            max={60 - pages.length}
            adding
            onCancel={() => {
              URL.revokeObjectURL(picker.url);
              setPicker(null);
            }}
            onDone={pdfPicked}
          />,
          document.body
        )}
    </div>
  );
}
