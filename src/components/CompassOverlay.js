"use client";

import { useRef } from "react";

export default function CompassOverlay({ center, setCenter, radius, setRadius, angle, setAngle }) {
  const dragState = useRef(null);

  function handlePinPointerDown(e) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = {
      mode: "move",
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origin: { ...center },
    };
  }

  function handlePencilPointerDown(e) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = { mode: "resize", pointerId: e.pointerId };
  }

  function handlePointerMove(e) {
    const drag = dragState.current;
    if (!drag || e.pointerId !== drag.pointerId) return;

    if (drag.mode === "move") {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      setCenter({ x: drag.origin.x + dx, y: drag.origin.y + dy });
    } else if (drag.mode === "resize") {
      const dx = e.clientX - center.x;
      const dy = e.clientY - center.y;
      setRadius(Math.max(20, Math.hypot(dx, dy)));
      setAngle(Math.atan2(dy, dx));
    }
  }

  function handlePointerUp(e) {
    const drag = dragState.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    dragState.current = null;
  }

  const pencilX = center.x + Math.cos(angle) * radius;
  const pencilY = center.y + Math.sin(angle) * radius;

  return (
    <>
      <svg
        style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", pointerEvents: "none", zIndex: 19 }}
      >
        <circle
          cx={center.x} cy={center.y} r={radius}
          fill="none" stroke="rgba(30,136,229,0.55)" strokeWidth={1.5} strokeDasharray="5 5"
        />
        <line
          x1={center.x} y1={center.y} x2={pencilX} y2={pencilY}
          stroke="rgba(30,136,229,0.6)" strokeWidth={1.5}
        />
      </svg>

      <div
        style={{
          position: "fixed", left: center.x + 14, top: center.y - 10,
          background: "#1E88E5", color: "#fff", fontSize: 11, fontWeight: 600,
          padding: "2px 6px", borderRadius: 6, pointerEvents: "none", zIndex: 19, whiteSpace: "nowrap",
        }}
      >
        r = {Math.round(radius)}
      </div>

      {/* Pin — drag to move the whole compass */}
      <div
        onPointerDown={handlePinPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          position: "fixed", left: center.x - 16, top: center.y - 16,
          width: 32, height: 32, borderRadius: "50%", background: "#1E88E5",
          border: "3px solid #fff", boxShadow: "0 1px 6px rgba(0,0,0,0.3)",
          zIndex: 21, touchAction: "none", WebkitUserSelect: "none", userSelect: "none",
          WebkitTouchCallout: "none", cursor: "grab",
        }}
      />

      {/* Pencil — drag to open/close the compass (set the radius) */}
      <div
        onPointerDown={handlePencilPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          position: "fixed", left: pencilX - 15, top: pencilY - 15,
          width: 30, height: 30, borderRadius: "50%", background: "#fff",
          border: "3px solid #1E88E5", boxShadow: "0 1px 6px rgba(0,0,0,0.3)",
          zIndex: 21, touchAction: "none", WebkitUserSelect: "none", userSelect: "none",
          WebkitTouchCallout: "none", cursor: "grab",
        }}
      />
    </>
  );
}