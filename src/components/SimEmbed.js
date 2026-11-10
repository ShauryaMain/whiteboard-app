"use client";

import { useRef } from "react";
import { X, Move } from "lucide-react";

// A single embedded external simulation (e.g. a PhET sim) placed on the
// board as a movable/resizable box hosting an iframe. Its on-screen
// position/size is driven imperatively by the parent (Whiteboard.js) via
// `registerNode`, the same way the board's pan/zoom already works (pan and
// scale are refs, not React state, so repositioning happens outside
// render) — this component only needs to report drags back up.
//
// Dragging is intentionally NOT wired into the canvas' own select/hit-test
// system: an iframe (especially a cross-origin one, which most
// simulations are) captures all pointer input over itself, so a plain
// header bar + a small corner handle — both real DOM elements stacked
// above the iframe — are what actually receive the drag.

// Only an ordinary web address goes in the frame (a board shared with
// others can carry anything in sim.url). The frame's sandbox above stops
// the page inside from navigating the whole tab somewhere else.
function simAddress(url) {
  try {
    const u = new URL(String(url || ""));
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : "about:blank";
  } catch (err) {
    return "about:blank";
  }
}
export default function SimEmbed({ sim, scaleRef, onMove, onResize, onCommit, onRemove, registerNode }) {
  const dragRef = useRef(null); // { mode: "move" | "resize", startScreen: {x,y}, start: {...} }

  function handlePointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    const scale = scaleRef.current || 1;
    const dxWorld = (e.clientX - d.startScreen.x) / scale;
    const dyWorld = (e.clientY - d.startScreen.y) / scale;
    if (d.mode === "move") {
      onMove(sim.id, d.start.x + dxWorld, d.start.y + dyWorld);
    } else {
      onResize(sim.id, Math.max(160, d.start.width + dxWorld), Math.max(120, d.start.height + dyWorld));
    }
  }

  function endDrag() {
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", endDrag);
    dragRef.current = null;
    onCommit(sim.id);
  }

  function handleHeaderPointerDown(e) {
    e.stopPropagation();
    dragRef.current = { mode: "move", startScreen: { x: e.clientX, y: e.clientY }, start: { x: sim.x, y: sim.y } };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", endDrag);
  }

  function handleResizePointerDown(e) {
    e.stopPropagation();
    dragRef.current = {
      mode: "resize",
      startScreen: { x: e.clientX, y: e.clientY },
      start: { width: sim.width, height: sim.height },
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", endDrag);
  }

  return (
    <div
      ref={registerNode}
      style={{
        position: "fixed",
        display: "flex",
        flexDirection: "column",
        border: "2px solid var(--ink-line)",
        borderRadius: 12,
        background: "#fff",
        boxShadow: "4px 4px 0 var(--ink-line)",
        overflow: "hidden",
      }}
    >
      <div
        onPointerDown={handleHeaderPointerDown}
        style={{
          height: 28,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 8px",
          background: "var(--paper)",
          borderBottom: "2px solid var(--ink-line)",
          cursor: "grab",
          touchAction: "none",
        }}
      >
        <Move size={13} color="var(--ink-2)" />
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 12,
            fontWeight: 700,
            color: "var(--ink)",
            flex: 1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {sim.title || sim.url}
        </span>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onRemove(sim.id)}
          aria-label="Remove simulation"
          style={{ border: "none", background: "transparent", cursor: "pointer", display: "flex", padding: 2 }}
        >
          <X size={14} color="var(--ink-2)" />
        </button>
      </div>
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <iframe
          src={simAddress(sim.url)}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-pointer-lock allow-modals"
          referrerPolicy="no-referrer"
          title={sim.title || "Embedded simulation"}
          style={{ width: "100%", height: "100%", border: "none", display: "block" }}
          allow="fullscreen; autoplay"
        />
        <div
          onPointerDown={handleResizePointerDown}
          style={{ position: "absolute", right: 0, bottom: 0, width: 18, height: 18, cursor: "nwse-resize", touchAction: "none" }}
        >
          <svg width="18" height="18" style={{ display: "block" }}>
            <path d="M15 3 L3 15 M15 9 L9 15" stroke="#bbb" strokeWidth="1.5" />
          </svg>
        </div>
      </div>
    </div>
  );
}
