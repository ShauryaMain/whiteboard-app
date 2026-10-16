"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import d from "./Dialog.module.css";
import st from "./Settings.module.css";

// What each (i) in Settings explains: a short looping clip recorded from
// the real board (public/settings-demos/<name>.mp4 and .webm, with a still .png
// shown first, or only the .png), and a sentence or two. The clips were
// recorded from the app itself (see the Settings status note); re-record
// them if the toolbar changes a lot.
export const EXPLAINERS = {
  scribble: {
    title: "Scribble to erase",
    text: "With the pen, scribble quickly back and forth over a mistake and it's rubbed out, without switching to the eraser. Undo brings it back.",
    tip: "Turn it off if you shade a lot with the pen.",
  },
  sensitivity: {
    title: "How easily a scribble erases",
    text: "Gentle needs a long, clear scribble right over the mistake, so nothing vanishes by accident. Eager also takes a quick, messy scribble that only half covers it. Normal is in between. A W or a zigzag never counts, on any of them.",
    tip: "Try Eager if scribbles don't always work for you, Gentle if things vanish that you didn't mean to rub out.",
  },
  eraser: {
    title: "Eraser",
    text: "Precise rubs out only where you drag, like a real rubber. Whole stroke removes any line you touch in one go, which is quicker for clearing big things.",
    tip: "You can also switch between them on the board, under the Eraser.",
  },
  pencil: {
    title: "Pencil only",
    text: "Only your Apple Pencil or stylus draws. Fingers scroll and zoom instead, so your hand can rest on the screen. It turns on by itself the first time you write with a stylus on a device.",
    tip: "This one is kept per device, because it depends on whether that device has a stylus.",
    still: true, // a picture rather than a clip (a finger and a Pencil look the same on video)
  },
  move: {
    title: "The Move tool",
    text: "Back to my last tool: drag the board once with Move and you're straight back to the pen (or whatever you had). Stay on Move: it keeps moving the board until you pick another tool.",
    tip: "Two fingers always move and zoom the board, whichever you choose.",
  },
  hints: {
    title: "Tool hints",
    text: "The line beside the tools that says what the chosen tool does and how to use it. Hide it once you know your way around, for a little more room.",
    tip: "",
  },
};

export default function SettingsExplainer({ name, onClose }) {
  const info = EXPLAINERS[name];
  const closeRef = useRef(null);
  const [videoFailed, setVideoFailed] = useState(false);
  // people who ask for less motion get the clip paused, with its controls
  const [calm] = useState(() => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (closeRef.current) closeRef.current.focus();
    function onKey(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  if (!info) return null;
  // on top of everything, including the board's toolbar
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className={d.overlay}
      style={{ zIndex: 340 }}
      data-board-shortcuts="off"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`${d.card} ${st.explainCard}`} role="dialog" aria-modal="true" aria-labelledby="explain-title" data-settings-explainer={name}>
        <div className={d.header}>
          <div className={d.titleBlock}>
            <h2 id="explain-title" className={d.title}>{info.title}</h2>
          </div>
          <button type="button" ref={closeRef} className={d.close} onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {videoFailed || info.still ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={st.video} src={`/settings-demos/${name}.png`} alt="" />
        ) : (
          <video
            className={st.video}
            poster={`/settings-demos/${name}.png`}
            autoPlay={!calm}
            controls={calm}
            loop
            muted
            playsInline
            preload="auto"
            aria-label={`A short clip showing ${info.title.toLowerCase()}`}
          >
            {/* MP4 for Safari and iPads, WebM for browsers without H.264 */}
            <source src={`/settings-demos/${name}.mp4`} type="video/mp4" />
            <source src={`/settings-demos/${name}.webm`} type="video/webm" onError={() => setVideoFailed(true)} />
          </video>
        )}
        <p className={st.explainText}>{info.text}</p>
        {info.tip && <p className={st.explainTip}>{info.tip}</p>}
      </div>
    </div>,
    document.body
  );
}
