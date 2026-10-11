"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ArrowRight, Check } from "lucide-react";
import s from "./TourGuide.module.css";

const GAP = 16; // between the note and what it sits beside
const EDGE = 8; // kept clear at the edges of the screen
const NARROW = 700; // below this the note docks to the top or bottom instead

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

function onScreen(r, vw, vh) {
  return !!r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
}

// Where the highlight ring and the note go for this step, right now.
// `plain` is the note's size when it sits beside something (a docked note
// is wider and so shorter; measuring that would let it flip back and forth
// between the two for ever).
function measure(step, card, plain) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const docked = card && card.dataset.docked === "true";
  // its size now (for docking), and its size beside something (for the
  // spots beside it)
  const nowW = card ? card.offsetWidth : 300, nowH = card ? card.offsetHeight : 170;
  const cw = docked ? (plain ? plain.w : 300) : nowW;
  const ch = docked ? (plain ? plain.h : nowH) : nowH;
  const target = step.target ? document.querySelector(step.target) : null;
  const tr = target ? target.getBoundingClientRect() : null;
  const seen = onScreen(tr, vw, vh);
  const ring = seen ? { left: tr.left - 6, top: tr.top - 6, width: tr.width + 12, height: tr.height + 12 } : null;

  const anchor = step.beside ? document.querySelector(step.beside) : target;
  const ar = anchor ? anchor.getBoundingClientRect() : null;
  if (vw >= NARROW && onScreen(ar, vw, vh)) {
    const cx = ar.left + ar.width / 2, cy = ar.top + ar.height / 2;
    const spots = {
      below: { left: clamp(cx - cw / 2, EDGE, vw - cw - EDGE), top: ar.bottom + GAP },
      above: { left: clamp(cx - cw / 2, EDGE, vw - cw - EDGE), top: ar.top - GAP - ch },
      right: { left: ar.right + GAP, top: clamp(cy - ch / 2, EDGE, vh - ch - EDGE) },
      left: { left: ar.left - GAP - cw, top: clamp(cy - ch / 2, EDGE, vh - ch - EDGE) },
    };
    for (const side of [step.place || "below", "right", "left", "below", "above"]) {
      const p = spots[side];
      if (p.left >= EDGE && p.left + cw <= vw - EDGE && p.top >= EDGE && p.top + ch <= vh - EDGE) {
        return { found: !!target, ring, docked: false, left: Math.round(p.left), top: Math.round(p.top) };
      }
    }
  }
  // No room beside it (or a small screen): sit along the top or bottom
  // edge, whichever is further from the thing being pointed at.
  const targetLow = seen ? tr.top + tr.height / 2 > vh * 0.55 : false;
  // (a note that isn't docked yet is about to get wider and shorter: use
  // its docked size once it has one)
  return { found: !!target, ring, docked: true, left: Math.round((vw - (docked ? nowW : Math.min(440, vw - 16))) / 2), top: targetLow ? EDGE : Math.max(EDGE, vh - (docked ? nowH : ch) - EDGE) };
}

function sameLayout(a, b) {
  if (!a || !b) return a === b;
  if (a.left !== b.left || a.top !== b.top || a.docked !== b.docked || a.found !== b.found) return false;
  if (!a.ring || !b.ring) return a.ring === b.ring;
  return ["left", "top", "width", "height"].every((k) => Math.abs(a.ring[k] - b.ring[k]) < 0.5);
}

// A step-by-step guide laid over the board: a ring round the thing to
// press, and a note beside it saying what to do. It follows along by
// watching the page (see src/lib/tours.js), so it keeps up whichever way
// the person gets there, and it never blocks the board underneath.
// `onStep(id)` (optional) hears each step as it's reached.
export default function TourGuide({ tour, onEnd, onStep }) {
  const steps = tour.steps;
  const [stepId, setStepId] = useState(steps[0].id);
  const [layout, setLayout] = useState(null);
  const [started, setStarted] = useState(false);
  const cardRef = useRef(null);
  const plainSize = useRef(null); // the note's size when not docked (see measure)
  const step = steps.find((x) => x.id === stepId) || steps[0];
  const number = steps.indexOf(step) + 1;
  const onStepRef = useRef(onStep);
  useEffect(() => {
    onStepRef.current = onStep;
  }, [onStep]);
  useEffect(() => {
    if (onStepRef.current) onStepRef.current(stepId);
  }, [stepId]);

  // Keep up with the page: move on when the step's condition is met, and
  // keep the ring and note lined up as things move.
  useEffect(() => {
    let fresh = true;
    plainSize.current = null; // a new step's note may be a different size
    function tick() {
      const jump = step.watch ? step.watch() : null;
      if (jump && jump !== step.id) {
        setStepId(jump);
        return;
      }
      if (fresh) {
        fresh = false;
        const el = step.target ? document.querySelector(step.target) : null;
        if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
      const card = cardRef.current;
      if (card && card.dataset.docked !== "true" && card.offsetWidth > 0) {
        plainSize.current = { w: card.offsetWidth, h: card.offsetHeight };
      }
      const next = measure(step, card, plainSize.current);
      if (next.found) setStarted(true);
      setLayout((prev) => (sameLayout(prev, next) ? prev : next));
    }
    const frame = requestAnimationFrame(tick);
    const timer = setInterval(tick, 200);
    window.addEventListener("resize", tick);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
      window.removeEventListener("resize", tick);
    };
  }, [step]);

  // "Your turn" steps: pressing the thing itself moves on.
  useEffect(() => {
    const clicks = step.clicks;
    if (!clicks) return undefined;
    function onClick(e) {
      if (!e.target || !e.target.closest) return;
      for (const selector of Object.keys(clicks)) {
        const hit = e.target.closest(selector);
        if (hit && !hit.disabled) {
          setStepId(clicks[selector]);
          return;
        }
      }
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [step]);

  if (typeof document === "undefined") return null;
  // wait for the board (and the first thing to point at) to be there
  const visible = started && !!layout;

  return createPortal(
    <>
      {visible && layout.ring && <div className={s.ring} style={layout.ring} aria-hidden="true" />}
      <div
        ref={cardRef}
        className={`${s.card} ${visible && layout.docked ? s.cardDocked : ""}`}
        data-docked={visible && layout.docked ? "true" : "false"}
        style={visible ? { left: layout.left, top: layout.top } : { left: 0, top: 0, visibility: "hidden" }}
        role="dialog"
        aria-label={`Walkthrough: ${tour.name}`}
        aria-live="polite"
        // keys pressed in the note aren't board shortcuts
        data-board-shortcuts="off"
        data-tour-step={step.id}
        onKeyDown={(e) => {
          if (e.key === "Escape") onEnd();
        }}
      >
        <div className={s.top}>
          <span className={s.count}>Step {number} of {steps.length}</span>
          <button type="button" className={s.closeBtn} onClick={onEnd} aria-label="Close the walkthrough">
            <X size={15} />
          </button>
        </div>
        <h3 className={s.title}>{step.title}</h3>
        <p className={s.body}>{step.body}</p>
        <div className={s.actions}>
          {!step.last && (
            <button type="button" className={s.skip} onClick={onEnd}>Skip</button>
          )}
          {step.last ? (
            <button type="button" className={s.next} onClick={onEnd}>
              <Check size={16} /> Done
            </button>
          ) : step.next ? (
            <button type="button" className={s.next} onClick={() => setStepId(step.next)}>
              Next <ArrowRight size={16} />
            </button>
          ) : (
            <span className={s.yourTurn}>your turn — give it a tap</span>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
