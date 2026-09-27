"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { BOARD_BACKGROUNDS, backgroundCss } from "@/lib/boardBackground";
import d from "./Dialog.module.css";

// "New board" dialog: a name and which paper to start on. The paper can be
// changed any time afterwards from Page ▾ on the board.
export default function NewBoardModal({ onClose, onCreate }) {
  const [name, setName] = useState("");
  const [background, setBackground] = useState("blank");

  function handleSubmit(e) {
    e.preventDefault();
    onCreate(name.trim(), background);
  }

  return (
    <div className={d.overlay} onClick={onClose}>
      <form
        className={d.card}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-board-title"
      >
        <div className={d.header}>
          <div className={d.titleBlock}>
            <h2 id="new-board-title" className={d.title}>New board</h2>
            <p className={d.subtitle}>Give it a name you&apos;ll recognise later, like a student or a topic.</p>
          </div>
          <button type="button" className={d.close} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <label className={d.label}>
          Board name
          <input
            autoFocus
            className={d.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Alex — Tuesdays"
            maxLength={80}
          />
        </label>

        <div className={d.label} role="radiogroup" aria-label="Page">
          Page
          <div className={d.pageGrid}>
            {BOARD_BACKGROUNDS.map((bg) => {
              const on = background === bg.id;
              return (
                <button
                  key={bg.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  title={bg.desc}
                  className={`${d.pageTile} ${on ? d.pageTileOn : ""}`}
                  onClick={() => setBackground(bg.id)}
                >
                  <span className={d.pagePreview} style={backgroundCss(bg.id, 0.6, { x: 4, y: 4 })} />
                  {bg.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className={d.actions}>
          <button type="button" className={d.btn} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${d.btn} ${d.btnPrimary}`}>
            Create board
          </button>
        </div>
      </form>
    </div>
  );
}
