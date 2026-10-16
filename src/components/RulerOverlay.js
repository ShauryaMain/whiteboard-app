"use client";

// The ruler (Maths ▸ Ruler). It lies across the board like a real one:
//   • centimetre (or inch) marks that grow and shrink with the zoom, so
//     they measure the board as it is drawn
//   • the angle it's turned to, always showing in the middle; turning it
//     clicks onto 0°, 15°, 30°, 45°… when it gets close
//   • drag it to move it; turn it with the round handle, two fingers, or
//     the mouse wheel over it (1° a click)
//   • draw along either edge and the line follows the edge (Whiteboard.js,
//     with rulerEdgeAt / rulerProject below); draw anywhere else and it's
//     ordinary writing
//
// Its coordinates are the board pane's (it's position:fixed inside the
// pane, which has a transform, so "fixed" means "in the pane").

import { useRef } from "react";
import { RotateCw } from "lucide-react";

export const RULER_HEIGHT = 76;
const END_PAD = 14; // from the end of the ruler to its 0 mark
const SNAP_PX = 36; // how near an edge a stroke has to start to follow it
const SNAP_DEG = 2; // how near 0°, 15°, 30°… the angle clicks onto it
const PX_PER = { cm: 96 / 2.54, in: 96 }; // at 100% (CSS units)

// As long as the board is wide, within reason.
export function rulerLength(paneWidth) {
  return Math.round(Math.max(360, Math.min(1100, (paneWidth || 800) - 120)));
}

// The angle as people read it: 0° level, counting up anticlockwise, 0–179.
export function rulerDegrees(angle) {
  const deg = (-angle * 180) / Math.PI;
  return ((Math.round(deg) % 180) + 180) % 180;
}

// Turning clicks onto every 15° when it's close.
export function snapRulerAngle(angle) {
  const deg = (angle * 180) / Math.PI;
  const near = Math.round(deg / 15) * 15;
  return Math.abs(deg - near) <= SNAP_DEG ? (near * Math.PI) / 180 : angle;
}

// A press at p (pane coordinates): is it by one of the ruler's long edges?
// Gives which side, and how far from the middle a line drawn along that
// edge sits (so ink `inkPx` thick just touches the edge).
export function rulerEdgeAt(p, ruler, inkPx) {
  const { position: c, angle, length } = ruler;
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const u = dx * Math.cos(angle) + dy * Math.sin(angle);
  const v = -dx * Math.sin(angle) + dy * Math.cos(angle);
  const half = RULER_HEIGHT / 2;
  if (Math.abs(u) > length / 2 + 24) return null;
  if (Math.abs(v) < half - 6 || Math.abs(v) > half + SNAP_PX) return null;
  const side = v < 0 ? -1 : 1;
  return { side, offset: side * (half + Math.max(1, inkPx) / 2 + 1) };
}

// Where p lands on the line along that edge.
export function rulerProject(p, ruler, offset) {
  const { position: c, angle } = ruler;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const u = (p.x - c.x) * cos + (p.y - c.y) * sin;
  return { x: c.x + u * cos - offset * sin, y: c.y + u * sin + offset * cos };
}

// How long a stretch of screen is, in the ruler's units at this zoom.
export function rulerMeasure(px, scale, units) {
  const per = PX_PER[units] || PX_PER.cm;
  const n = px / (per * scale);
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units === "in" ? "in" : "cm"}`;
}

// The marks along an edge: [x, height, label?]
function marks(length, scale, units) {
  const unit = (PX_PER[units] || PX_PER.cm) * scale;
  const steps = units === "in" ? [8, 4, 2, 1] : [10, 2, 1];
  const minor = steps.find((s) => unit / s >= 6) || 1;
  let labelEvery = 1;
  for (const k of [1, 2, 5, 10, 20, 50, 100]) {
    labelEvery = k;
    if (unit * k >= 26) break;
  }
  const out = [];
  const usable = length - END_PAD * 2;
  const count = Math.floor((usable / unit) * minor + 1e-6);
  if (count > 600) return out;
  for (let i = 0; i <= count; i++) {
    const x = END_PAD + (i * unit) / minor;
    const whole = i % minor === 0;
    const n = i / minor;
    if (whole) {
      const labelled = n % labelEvery === 0;
      out.push([x, labelled ? 18 : 13, labelled ? String(n) : null]);
    } else {
      const half = minor % 2 === 0 && i % (minor / 2) === 0;
      out.push([x, half ? 11 : 7, null]);
    }
  }
  return out;
}

export default function RulerOverlay({ angle, setAngle, position, setPosition, length, scale = 1, units = "cm", onUnits }) {
  const drag = useRef(null);
  const touches = useRef(new Map());
  const half = RULER_HEIGHT / 2;

  function toPane(e) {
    const pane = e.currentTarget.closest ? e.currentTarget.closest("[data-board-pane]") : null;
    const rect = pane ? pane.getBoundingClientRect() : { left: 0, top: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // ---- the body: drag to move, two fingers to turn ----
  function bodyDown(e) {
    if (e.target.closest && e.target.closest("[data-ruler-units]")) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toPane(e);
    touches.current.set(e.pointerId, p);
    if (touches.current.size >= 2) {
      const [a, b] = [...touches.current.values()];
      drag.current = {
        mode: "twist",
        startPair: Math.atan2(b.y - a.y, b.x - a.x),
        startAngle: angle,
        startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        origin: { ...position },
      };
    } else {
      drag.current = { mode: "move", pointerId: e.pointerId, start: p, origin: { ...position } };
    }
  }
  function bodyMove(e) {
    const d = drag.current;
    if (!d || !touches.current.has(e.pointerId)) return;
    const p = toPane(e);
    touches.current.set(e.pointerId, p);
    if (d.mode === "twist" && touches.current.size >= 2) {
      const [a, b] = [...touches.current.values()];
      const pair = Math.atan2(b.y - a.y, b.x - a.x);
      setAngle(snapRulerAngle(d.startAngle + (pair - d.startPair)));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      setPosition({ x: d.origin.x + mid.x - d.startMid.x, y: d.origin.y + mid.y - d.startMid.y });
    } else if (d.mode === "move" && e.pointerId === d.pointerId) {
      setPosition({ x: d.origin.x + p.x - d.start.x, y: d.origin.y + p.y - d.start.y });
    }
  }
  function bodyUp(e) {
    touches.current.delete(e.pointerId);
    if (touches.current.size === 0) drag.current = null;
    else if (drag.current && drag.current.mode === "twist") {
      // one finger left: carry on moving with it
      const [id, p] = [...touches.current.entries()][0];
      drag.current = { mode: "move", pointerId: id, start: p, origin: { ...position } };
    }
  }
  function bodyWheel(e) {
    const step = (e.deltaY > 0 ? 1 : -1) * (Math.PI / 180);
    setAngle(angle + step);
  }

  // ---- the round handle: drag to turn ----
  function handleDown(e) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode: "turn", pointerId: e.pointerId };
  }
  function handleMove(e) {
    const d = drag.current;
    if (!d || d.mode !== "turn" || e.pointerId !== d.pointerId) return;
    const p = toPane(e);
    setAngle(snapRulerAngle(Math.atan2(p.y - position.y, p.x - position.x)));
  }
  function handleUp(e) {
    if (drag.current && drag.current.pointerId === e.pointerId) drag.current = null;
  }

  const ticks = marks(length, scale, units);
  const deg = rulerDegrees(angle);
  const level = deg % 15 === 0;
  // the turning handle sits on the ruler, to the right of the angle (so
  // it's on screen however the ruler is turned)
  const reach = Math.min(length / 2 - 40, 78);
  const below = RULER_HEIGHT * 0.12; // between the numbers and the lower marks
  const hx = position.x + Math.cos(angle) * reach - Math.sin(angle) * below;
  const hy = position.y + Math.sin(angle) * reach + Math.cos(angle) * below;
  // labels stay the right way up however it's turned
  const flip = Math.cos(angle) < -0.01;

  return (
    <>
      <div
        data-ruler="true"
        aria-label={`Ruler at ${deg} degrees`}
        role="img"
        onPointerDown={bodyDown}
        onPointerMove={bodyMove}
        onPointerUp={bodyUp}
        onPointerCancel={bodyUp}
        onWheel={bodyWheel}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          position: "fixed",
          left: position.x,
          top: position.y,
          width: length,
          height: RULER_HEIGHT,
          marginLeft: -length / 2,
          marginTop: -half,
          transform: `rotate(${angle}rad)`,
          transformOrigin: "center",
          background: "rgba(255, 252, 238, 0.9)",
          border: "2px solid var(--ink-line, #1c1c1c)",
          borderRadius: 12,
          boxShadow: "3px 3px 0 rgba(28, 28, 28, 0.22)",
          zIndex: 20,
          touchAction: "none",
          WebkitUserSelect: "none",
          userSelect: "none",
          WebkitTouchCallout: "none",
          cursor: "grab",
          overflow: "hidden",
        }}
      >
        <svg width={length} height={RULER_HEIGHT - 4} style={{ position: "absolute", left: -2, top: 0, overflow: "visible" }} aria-hidden="true">
          {ticks.map(([x, h, label], i) => (
            <g key={i}>
              <line x1={x} y1={0} x2={x} y2={h} stroke="#1c1c1c" strokeWidth={label ? 1.3 : 1} />
              <line x1={x} y1={RULER_HEIGHT - 4} x2={x} y2={RULER_HEIGHT - 4 - h * 0.7} stroke="#1c1c1c" strokeWidth={1} opacity={0.75} />
              {label && (
                <text
                  x={x}
                  y={29}
                  textAnchor="middle"
                  fontSize="10.5"
                  fontWeight="600"
                  fill="#1c1c1c"
                  fontFamily="var(--font-sans, sans-serif)"
                  transform={flip ? `rotate(180 ${x} 25.5)` : undefined}
                >
                  {label}
                </text>
              )}
            </g>
          ))}
        </svg>
        {/* the angle, in the middle */}
        <div
          data-ruler-angle={deg}
          style={{
            position: "absolute",
            left: "50%",
            top: "58%",
            transform: `translate(-50%, -50%)${flip ? " rotate(180deg)" : ""}`,
            padding: "2px 10px",
            borderRadius: 999,
            border: "1.5px solid var(--ink-line, #1c1c1c)",
            background: level ? "var(--accent, #2453D6)" : "var(--surface, #fff)",
            color: level ? "#fff" : "var(--ink, #1c1c1c)",
            fontFamily: "var(--font-sans, sans-serif)",
            fontSize: 14,
            fontWeight: 800,
            lineHeight: 1.3,
            pointerEvents: "none",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {deg}°
        </div>
        {/* cm / in */}
        <button
          type="button"
          data-ruler-units="true"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (onUnits) onUnits(units === "cm" ? "in" : "cm");
          }}
          aria-label={`Ruler in ${units === "in" ? "inches" : "centimetres"}. Press to change`}
          title="Change between centimetres and inches"
          style={{
            position: "absolute",
            left: "50%",
            top: "58%",
            transform: `translate(calc(-50% ${flip ? "+" : "-"} 64px), -50%)${flip ? " rotate(180deg)" : ""}`,
            minWidth: 36,
            height: 26,
            padding: "0 8px",
            borderRadius: 8,
            border: "1.5px solid var(--border-strong, #bbb)",
            background: "var(--surface, #fff)",
            color: "var(--hand-blue, #2453D6)",
            fontFamily: "var(--font-hand, cursive)",
            fontSize: 16,
            fontWeight: 700,
            cursor: "pointer",
            touchAction: "manipulation",
          }}
        >
          {units}
        </button>
      </div>

      {/* the turning handle */}
      <div
        data-ruler-handle="true"
        title="Drag to turn the ruler"
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        style={{
          position: "fixed",
          left: hx - 14,
          top: hy - 14,
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: "var(--surface, #fff)",
          border: "2px solid var(--ink-line, #1c1c1c)",
          boxShadow: "1.5px 1.5px 0 var(--ink-line, #1c1c1c)",
          color: "var(--ink, #1c1c1c)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 21,
          touchAction: "none",
          cursor: "grab",
        }}
      >
        <RotateCw size={14} strokeWidth={2.4} aria-hidden="true" />
      </div>
    </>
  );
}
