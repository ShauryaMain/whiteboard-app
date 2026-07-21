"use client";

import { useRef } from "react";

const RULER_LENGTH = 320;
const RULER_HEIGHT = 56;

export default function RulerOverlay({ angle, setAngle, position, setPosition }) {
  const dragState = useRef(null);

  function handleBodyPointerDown(e) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = {
      mode: "move",
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origin: { ...position },
    };
  }

  function handleHandlePointerDown(e) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = { mode: "rotate", pointerId: e.pointerId };
  }

  function handlePointerMove(e) {
    const drag = dragState.current;
    if (!drag || e.pointerId !== drag.pointerId) return;

    if (drag.mode === "move") {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      setPosition({ x: drag.origin.x + dx, y: drag.origin.y + dy });
    } else if (drag.mode === "rotate") {
      const dx = e.clientX - position.x;
      const dy = e.clientY - position.y;
      setAngle(Math.atan2(dy, dx));
    }
  }

  function handlePointerUp(e) {
    const drag = dragState.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    dragState.current = null;
  }

  const handleX = position.x + Math.cos(angle) * (RULER_LENGTH / 2);
  const handleY = position.y + Math.sin(angle) * (RULER_LENGTH / 2);

  return (
    <>
      <div
        onPointerDown={handleBodyPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          position: "fixed",
          left: position.x,
          top: position.y,
          width: RULER_LENGTH,
          height: RULER_HEIGHT,
          marginLeft: -RULER_LENGTH / 2,
          marginTop: -RULER_HEIGHT / 2,
          transform: `rotate(${angle}rad)`,
          transformOrigin: "center",
          background: "rgba(30, 136, 229, 0.16)",
          border: "2px solid #1E88E5",
          borderRadius: 10,
          zIndex: 20,
          touchAction: "none",
          WebkitUserSelect: "none",
          userSelect: "none",
          WebkitTouchCallout: "none",
          cursor: "grab",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: 8,
            right: 8,
            height: 1,
            background: "rgba(30,136,229,0.5)",
            transform: "translateY(-50%)",
          }}
        />
      </div>

      <div
        onPointerDown={handleHandlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          position: "fixed",
          left: handleX - 14,
          top: handleY - 14,
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: "#1E88E5",
          border: "3px solid #fff",
          boxShadow: "0 1px 6px rgba(0,0,0,0.3)",
          zIndex: 21,
          touchAction: "none",
          cursor: "grab",
        }}
      />
    </>
  );
}