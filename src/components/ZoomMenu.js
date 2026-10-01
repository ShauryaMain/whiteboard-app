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
  border: "1.5px solid var(--ink-line)",
  background: "rgba(255,255,255,0.96)",
  boxShadow: "var(--shadow-hard-sm)",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--ink)",
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
  borderRadius: 14,
  border: "2px solid var(--ink-line)",
  boxShadow: "4px 4px 0 var(--ink-line)",
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
  borderRadius: 8,
  fontSize: 13.5,
  color: "#1a1a1a",
  textAlign: "left",
  cursor: "pointer",
  WebkitTouchCallout: "none",
  WebkitUserSelect: "none",
  userSelect: "none",
  touchAction: "manipulation",
};