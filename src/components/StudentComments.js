"use client";

import { useState } from "react";
import cls from "./Classroom.module.css";

// The teacher's comments, as a student sees them on their own board in a
// live class: a sticky-note button saying how many there are, which opens
// the list. The numbered pins themselves are drawn on the board by
// Whiteboard.js; tapping a comment here asks the board to show its pin.
export default function StudentComments({ comments, onShow }) {
  const [open, setOpen] = useState(false);
  if (!comments || comments.length === 0) return null;
  return (
    <>
      <button type="button" className={cls.myCommentsBtn} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? "Hide comments" : `${comments.length} comment${comments.length === 1 ? "" : "s"} from teacher`}
      </button>
      {open && (
        <div className={cls.myCommentsPanel} role="region" aria-label="Comments from your teacher">
          {comments.map((c, i) => (
            <button
              key={c.id}
              type="button"
              className={`${cls.commentRow} ${cls.commentRowBtn}`}
              onClick={() => onShow?.(c)}
              title="Show where this is on your board"
            >
              <span className={cls.commentNum}>{i + 1}</span>
              <span className={cls.commentText}>{c.text}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
