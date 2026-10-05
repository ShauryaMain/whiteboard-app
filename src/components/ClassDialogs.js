"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileDown, Images, Send, X } from "lucide-react";
import { saveClassBoards, makeSaveJob, safeFileName } from "@/lib/boardExport";
import d from "./Dialog.module.css";
import cls from "./Classroom.module.css";

// Two small dialogs the teacher opens from the Students list in a live
// class: "Send my board" and "Save boards".

function clock(ms) {
  try {
    return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch (err) {
    return "";
  }
}

// ---------- Send my board ----------
//
// Copies what is on the teacher's board onto every student's own board (see
// src/lib/classControl.js). `sent` is the question that is on students'
// boards now ({ sentAt }), or null.
export function SendBoardDialog({ studentCount, sent, sending, onSend, onTakeBack, onClose }) {
  return (
    <div className={d.overlay} onClick={onClose}>
      <div
        className={d.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-board-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <div className={d.header}>
          <div className={d.titleBlock}>
            <h2 id="send-board-title" className={d.title}>Send your board to students</h2>
            <p className={d.subtitle}>
              Everything on your board right now is copied onto every student&apos;s own board, as a starting point.
            </p>
          </div>
          <button type="button" className={d.close} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <ul className={cls.dialogList}>
          <li>Their own work stays exactly where it is.</li>
          <li>They can write over what you send, but only you can take it off.</li>
          <li>Students who join later get it too.</li>
        </ul>

        {sent && (
          <p className={cls.dialogNote} role="status">
            {`Your board was sent at ${clock(sent.sentAt)}. Anything you've changed since isn't on their boards until you send again.`}
          </p>
        )}
        {!sent && studentCount === 0 && (
          <p className={cls.dialogNote}>Nobody has joined yet. It will be waiting on their boards when they do.</p>
        )}

        <div className={d.actions}>
          {sent && (
            <button type="button" className={d.btn} onClick={onTakeBack} disabled={sending}>
              Take it off their boards
            </button>
          )}
          <button type="button" className={`${d.btn} ${d.btnPrimary}`} onClick={onSend} disabled={sending} autoFocus>
            <Send size={16} />
            {sending ? "Sending…" : sent ? "Send again" : studentCount > 1 ? `Send to ${studentCount} students` : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Save boards ----------
//
// Fetches every student's board over the live connection and offers it two
// ways: one PDF with a page per student, and a zip of separate pictures.
// Everything is made here in the browser; nothing is uploaded.
export function SaveBoardsDialog({ code, students, question, boardName, onClose }) {
  // "ready" -> "working" -> "done"
  const [phase, setPhase] = useState("ready");
  const [progress, setProgress] = useState({ done: 0, total: students.length, name: "" });
  const [result, setResult] = useState(null); // { pdfUrl, zipUrl, saved, missed, base }
  const [failed, setFailed] = useState(false);
  const jobRef = useRef(null);
  const urlsRef = useRef([]);

  // Closing the dialog part way stops the fetching at once (and lets go of
  // the board it was connected to, so that board can be opened straight away).
  useEffect(() => {
    return () => {
      if (jobRef.current) jobRef.current.cancel();
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current = [];
    };
  }, []);

  function start() {
    if (jobRef.current) jobRef.current.cancel();
    const job = makeSaveJob();
    jobRef.current = job;
    setFailed(false);
    setPhase("working");
    setProgress({ done: 0, total: students.length, name: students[0] ? students[0].name : "" });
    saveClassBoards({
      code,
      students,
      question,
      boardName,
      job,
      onProgress: (p) => {
        if (!job.cancelled) setProgress(p);
      },
    }).then(
      (made) => {
        if (!made || job.cancelled) return;
        const pdfUrl = made.pdf ? URL.createObjectURL(made.pdf) : null;
        const zipUrl = made.zip ? URL.createObjectURL(made.zip) : null;
        urlsRef.current.push(...[pdfUrl, zipUrl].filter(Boolean));
        setResult({
          pdfUrl,
          zipUrl,
          saved: made.saved,
          missed: made.missed,
          base: `${safeFileName(boardName, "Class")} - student boards ${made.date}`,
        });
        setPhase("done");
      },
      () => {
        if (job.cancelled) return;
        setFailed(true);
        setPhase("ready");
      }
    );
  }

  const count = students.length;

  return (
    <div className={d.overlay} onClick={phase === "working" ? undefined : onClose}>
      <div
        className={d.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-boards-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <div className={d.header}>
          <div className={d.titleBlock}>
            <h2 id="save-boards-title" className={d.title}>Save students&apos; boards</h2>
            <p className={d.subtitle}>
              A picture of each student&apos;s board as it is right now, with their name on it. Do this before you end the class: their boards
              are on their own devices, so they can&apos;t be fetched afterwards.
            </p>
          </div>
          <button type="button" className={d.close} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {phase === "ready" && count === 0 && (
          <p className={cls.dialogNote}>Nobody is in the class right now, so there are no boards to save.</p>
        )}

        {phase === "ready" && failed && (
          <p className={cls.dialogNote} role="alert">
            Something went wrong putting the boards together. Nothing on anyone&apos;s board has changed: please try again.
          </p>
        )}

        {phase === "ready" && count > 0 && (
          <div className={d.actions}>
            <button type="button" className={d.btn} onClick={onClose}>
              Not now
            </button>
            <button type="button" className={`${d.btn} ${d.btnPrimary}`} onClick={start} autoFocus>
              <Download size={16} />
              {count === 1 ? "Fetch 1 board" : `Fetch ${count} boards`}
            </button>
          </div>
        )}

        {phase === "working" && (
          <div role="status" aria-live="polite" className={cls.saveProgress}>
            <div className={cls.saveBar}>
              <span style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
            </div>
            <div>
              {progress.name
                ? `Fetching ${progress.name}'s board (${Math.min(progress.done + 1, progress.total)} of ${progress.total})…`
                : "Putting the files together…"}
            </div>
          </div>
        )}

        {phase === "done" && result && (
          <>
            <p className={cls.dialogNote} role="status">
              {result.saved.length === 0
                ? "None of the boards could be reached."
                : `${result.saved.length} board${result.saved.length === 1 ? " is" : "s are"} ready: ${result.saved.join(", ")}.`}
              {result.missed.length > 0 && result.saved.length > 0 && (
                <>
                  <br />
                  {`Couldn't reach: ${result.missed.join(", ")}.`}
                </>
              )}
            </p>
            {result.saved.length > 0 && (
              <div className={cls.saveChoices}>
                {result.pdfUrl && (
                  <a className={`${d.btn} ${d.btnPrimary}`} href={result.pdfUrl} download={`${result.base}.pdf`}>
                    <FileDown size={16} /> Download PDF
                  </a>
                )}
                {result.zipUrl && (
                  <a className={d.btn} href={result.zipUrl} download={`${result.base}.zip`}>
                    <Images size={16} /> Download pictures (.zip)
                  </a>
                )}
              </div>
            )}
            <div className={d.actions}>
              {result.missed.length > 0 && (
                <button type="button" className={d.btn} onClick={start}>
                  Try again
                </button>
              )}
              <button type="button" className={d.btn} onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
