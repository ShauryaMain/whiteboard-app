"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";

const ZOOM_LEVELS = [25, 50, 75, 100, 150, 200, 300];

export default function ZoomMenu({ zoomPercent, onSelect }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handleClickOutside);
    return () => document.removeEventListener("pointerdown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} style={containerStyle}>
      {open && (
        <div style={dropdownStyle}>
          {ZOOM_LEVELS.map((level) => (
            <button
              key={level}
              onClick={() => {
                onSelect(level);
                setOpen(false);
              }}
              style={{
                ...optionStyle,
                fontWeight: zoomPercent === level ? 600 : 400,
                background: zoomPercent === level ? "var(--accent-soft)" : "transparent",
              }}
            >
              {level}%
            </button>
          ))}
        </div>
      )}
      <button onClick={() => setOpen((v) => !v)} style={buttonStyle}>
        <span>{zoomPercent}%</span>
        <ChevronDown
          size={14}
          strokeWidth={2}
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
        />
      </button>
    </div>
  );
}

// Top-right of the board: the bottom corners are where a writing hand
// rests, so nothing tappable lives there any more.
const containerStyle = {
  position: "fixed",
  top: 12,
  right: "max(12px, env(safe-area-inset-right))",
  zIndex: 20,
};

const buttonStyle = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "0 12px",
  minHeight: 40,
  borderRadius: 999,
  border: "1px solid var(--border)",
  background: "rgba(255,255,255,0.94)",
  boxShadow: "var(--shadow-card)",
  fontSize: 12.5,
  fontWeight: 500,
  color: "var(--ink-2)",
  cursor: "pointer",
  WebkitTouchCallout: "none",
  WebkitUserSelect: "none",
  userSelect: "none",
  touchAction: "manipulation",
};

const dropdownStyle = {
  position: "absolute",
  top: 44,
  right: 0,
  background: "#fff",
  borderRadius: 10,
  boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
  padding: 6,
  display: "flex",
  flexDirection: "column",
  gap: 2,
  minWidth: 90,
};

const optionStyle = {
  border: "none",
  background: "transparent",
  padding: "11px 12px",
  minHeight: 44,
  borderRadius: 6,
  fontSize: 13.5,
  color: "#1a1a1a",
  textAlign: "left",
  cursor: "pointer",
  WebkitTouchCallout: "none",
  WebkitUserSelect: "none",
  userSelect: "none",
  touchAction: "manipulation",
};