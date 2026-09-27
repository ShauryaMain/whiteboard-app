"use client";

import { useRef } from "react";
import { msSincePenActivity } from "@/lib/penActivity";

// A button that only responds to a deliberate tap, for everything in the
// board's toolbars. A resting palm tends to either land right after a pen
// stroke, stay down for a while, or smear across the screen — so a press
// is ignored if:
//   - it's a touch that starts within PEN_GRACE_MS of the pen last touching
//     the board (iPad Safari already blocks touches while the pen is down;
//     this covers the gaps between strokes),
//   - it's held longer than MAX_HOLD_MS, or
//   - the contact moves more than MAX_MOVE_PX before lifting.
// Mouse, pen and keyboard presses work exactly like a normal button.
const PEN_GRACE_MS = 700;
const MAX_HOLD_MS = 700;
const MAX_MOVE_PX = 16;

export default function PalmSafeButton({ onPress, disabled, children, ...rest }) {
  const pressRef = useRef(null);

  function handlePointerDown(e) {
    if (disabled) return;
    pressRef.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      startedAt: Date.now(),
      rejected: e.pointerType === "touch" && msSincePenActivity() < PEN_GRACE_MS,
    };
  }

  function handlePointerUp(e) {
    const press = pressRef.current;
    pressRef.current = null;
    if (!press || press.id !== e.pointerId || press.rejected || disabled) return;
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    const held = Date.now() - press.startedAt;
    if (moved > MAX_MOVE_PX || held > MAX_HOLD_MS) return;
    onPress?.(e);
  }

  function handleClick(e) {
    // Pointer presses are handled on pointer-up above. A click with
    // detail === 0 comes from the keyboard (Enter/Space) or assistive tech,
    // which should always work.
    if (e.detail === 0 && !disabled) onPress?.(e);
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        pressRef.current = null;
      }}
      onClick={handleClick}
      {...rest}
    >
      {children}
    </button>
  );
}
