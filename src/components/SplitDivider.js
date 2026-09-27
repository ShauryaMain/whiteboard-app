"use client";

import { useRef } from "react";

// The draggable bar between the reference document and the board, like the
// divider in iPad Split View. Works with Pencil, finger and mouse (pointer
// capture keeps the drag even if the pointer leaves the bar), double-tap
// resets it, and arrow keys nudge it for keyboard users.
//
// orientation "vertical" = side-by-side panes (drag left/right);
// "horizontal" = stacked panes (drag up/down).
// onDrag / onDragEnd receive the pointer's position as a fraction (0–1)
// along the container, plus the container's size in px so the caller can
// clamp. onDragEnd is where the final size should be saved.
export default function SplitDivider({ orientation, containerRef, valueNow, onDrag, onDragEnd, onReset }) {
  const dragRef = useRef(null);
  const lastTapRef = useRef(0);
  const vertical = orientation === "vertical";

  function measure(e) {
    const rect = containerRef.current.getBoundingClientRect();
    return vertical
      ? { fraction: (e.clientX - rect.left) / rect.width, total: rect.width }
      : { fraction: (e.clientY - rect.top) / rect.height, total: rect.height };
  }

  function handlePointerDown(e) {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {
      // synthetic events can't be captured; dragging still works while over the bar
    }
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  }

  function handlePointerMove(e) {
    const drag = dragRef.current;
    if (!drag || drag.id !== e.pointerId) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
    drag.moved = true;
    drag.last = measure(e);
    onDrag(drag.last.fraction, drag.last.total);
  }

  function handlePointerUp(e) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.id !== e.pointerId) return;
    if (drag.moved) {
      // Finish from the release point itself: browsers may coalesce the
      // last move event into the pointer-up, and this also avoids relying
      // on state from the previous render.
      lastTapRef.current = 0;
      const { fraction, total } = measure(e);
      onDragEnd(fraction, total);
      return;
    }
    const now = Date.now();
    if (now - lastTapRef.current < 350) {
      lastTapRef.current = 0;
      onReset();
    } else {
      lastTapRef.current = now;
    }
  }

  function handlePointerCancel(e) {
    // The system took the pointer away (e.g. a gesture): keep the size
    // from the last move rather than the cancel event's position.
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && drag.id === e.pointerId && drag.moved && drag.last) {
      onDragEnd(drag.last.fraction, drag.last.total);
    }
  }

  function handleKeyDown(e) {
    const back = vertical ? "ArrowLeft" : "ArrowUp";
    const forward = vertical ? "ArrowRight" : "ArrowDown";
    if (e.key !== back && e.key !== forward) return;
    e.preventDefault();
    const total = vertical
      ? containerRef.current.getBoundingClientRect().width
      : containerRef.current.getBoundingClientRect().height;
    onDragEnd(valueNow + (e.key === forward ? 0.05 : -0.05), total);
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-label="Resize the reference document — drag, or double-tap to reset"
      aria-valuenow={Math.round(valueNow * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
      style={{
        // A 32px touch target around a slim visible bar; the negative
        // margins let the extra hit area overlap the panes' edges.
        flex: "0 0 auto",
        position: "relative",
        zIndex: 5,
        width: vertical ? 32 : "auto",
        height: vertical ? "auto" : 32,
        margin: vertical ? "0 -9px" : "-9px 0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: vertical ? "col-resize" : "row-resize",
        touchAction: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
      }}
    >
      <span
        style={{
          position: "absolute",
          inset: vertical ? "0 9px" : "9px 0",
          background: "var(--border)",
        }}
      />
      <span
        style={{
          position: "relative",
          width: vertical ? 6 : 48,
          height: vertical ? 48 : 6,
          borderRadius: 6,
          background: "var(--faint)",
        }}
      />
    </div>
  );
}
