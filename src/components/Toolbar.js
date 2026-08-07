"use client";

import { useState, useRef, useEffect } from "react";
import {
  Pencil, Highlighter, Eraser, Type, Ruler, Compass, Grid3x3, Hand, X, Home,
  Undo2, Redo2, Trash2, Link2, CheckCircle2,
} from "lucide-react";

const PRESET_COLORS = ["#1a1a1a", "#E53935", "#FB8C00", "#43A047", "#1E88E5", "#8E24AA", "#00897B"];

export default function Toolbar({
  tool, setTool, color, setColor, strokeWidth, setStrokeWidth,
  onUndo, onRedo, onClear, canUndo, canRedo,
  isOwner, onCopyLink, onEndSession, saveStatus,
  rulerActive, onToggleRuler, onResetView,
  compassActive, onToggleCompass,
  gridToolActive, onToggleGrid, onRemoveGrid,
  panToolActive, onTogglePan,
}) {
  const [openPopup, setOpenPopup] = useState(null); // null | "pen" | "highlighter" | "eraser"
  const [popupAnchorX, setPopupAnchorX] = useState(0);
  const popoverRef = useRef(null);

  useEffect(() => {
    function handleOutside(e) {
      if (e.target.closest("[data-tool-trigger]")) return;
      if (popoverRef.current && popoverRef.current.contains(e.target)) return;
      setOpenPopup(null);
    }
    if (openPopup) document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, [openPopup]);

  function handleToolClick(name, e) {
    const rect = e.currentTarget.getBoundingClientRect();
    setPopupAnchorX(rect.left + rect.width / 2);
    if (tool !== name) {
      setTool(name);
      setOpenPopup(name);
    } else {
      setOpenPopup((prev) => (prev === name ? null : name));
    }
  }

  return (
    <>
      {openPopup && (
        <div
          ref={popoverRef}
          style={{ ...popoverStyle, left: popupAnchorX, transform: "translateX(-50%)" }}
        >
          {(openPopup === "pen" || openPopup === "highlighter") && (
            <>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    aria-label={`Color ${c}`}
                    style={{
                      width: 26, height: 26, borderRadius: "50%", background: c,
                      border: color === c ? "3px solid #1a1a1a" : "2px solid transparent",
                      boxShadow: "0 0 0 1px #ddd", cursor: "pointer", padding: 0, flexShrink: 0,
                    }}
                  />
                ))}
                <label
                  style={{
                    width: 26, height: 26, borderRadius: "50%", overflow: "hidden",
                    border: "2px solid #ddd", cursor: "pointer", display: "block",
                    position: "relative", flexShrink: 0,
                  }}
                >
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
                  />
                  <div style={{ width: "100%", height: "100%", background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }} />
                </label>
              </div>
              <Divider horizontal />
            </>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
            <span
              style={{
                width: Math.max(6, Math.min(strokeWidth, 22)),
                height: Math.max(6, Math.min(strokeWidth, 22)),
                borderRadius: "50%",
                background: openPopup === "eraser" ? "#ccc" : color,
                flexShrink: 0,
              }}
            />
            <input
              type="range"
              min={1}
              max={40}
              value={strokeWidth}
              onChange={(e) => setStrokeWidth(Number(e.target.value))}
              style={{ flex: 1, height: 36 }}
            />
          </div>
        </div>
      )}

      <div className="toolbar-scroll" onContextMenu={(e) => e.preventDefault()} style={barStyle}>
        <div style={groupStyle}>
          <IconButton active={panToolActive} onClick={onTogglePan} label="Pan">
            <Hand size={19} strokeWidth={2} />
          </IconButton>
          <IconButton
            active={tool === "pen"}
            onClick={(e) => handleToolClick("pen", e)}
            label="Pen"
            dataAttr
          >
            <Pencil size={19} strokeWidth={2} />
          </IconButton>
          <IconButton
            active={tool === "highlighter"}
            onClick={(e) => handleToolClick("highlighter", e)}
            label="Highlighter"
            dataAttr
          >
            <Highlighter size={19} strokeWidth={2} />
          </IconButton>
          <IconButton
            active={tool === "eraser"}
            onClick={(e) => handleToolClick("eraser", e)}
            label="Eraser"
            dataAttr
          >
            <Eraser size={19} strokeWidth={2} />
          </IconButton>
          <IconButton active={tool === "text"} onClick={() => setTool("text")} label="Text">
            <Type size={19} strokeWidth={2} />
          </IconButton>
          <IconButton active={rulerActive} onClick={onToggleRuler} label="Ruler">
            <Ruler size={19} strokeWidth={2} />
          </IconButton>
          <IconButton active={compassActive} onClick={onToggleCompass} label="Compass">
            <Compass size={19} strokeWidth={2} />
          </IconButton>
          <IconButton active={gridToolActive} onClick={onToggleGrid} label="Grid">
            <Grid3x3 size={19} strokeWidth={2} />
          </IconButton>
        </div>

        <Divider />

        <IconButton onClick={onRemoveGrid} label="Remove grid">
          <span style={{ position: "relative", display: "inline-flex" }}>
            <Grid3x3 size={19} strokeWidth={2} />
            <span
              style={{
                position: "absolute", bottom: -5, right: -5, background: "#fff",
                borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <X size={11} strokeWidth={3.5} color="#d32f2f" />
            </span>
          </span>
        </IconButton>

        <Divider />

        <IconButton onClick={onResetView} label="Reset view">
          <Home size={19} strokeWidth={2} />
        </IconButton>

        <Divider />

        <div style={groupStyle}>
          <IconButton onClick={onUndo} disabled={!canUndo} label="Undo">
            <Undo2 size={19} strokeWidth={2} />
          </IconButton>
          <IconButton onClick={onRedo} disabled={!canRedo} label="Redo">
            <Redo2 size={19} strokeWidth={2} />
          </IconButton>
          <IconButton onClick={onClear} label="Clear">
            <Trash2 size={19} strokeWidth={2} />
          </IconButton>
        </div>
      </div>

      {isOwner && (
        <div style={ownerBarStyle}>
          {saveStatus && <span style={statusStyle}>{saveStatus}</span>}
          <IconButton onClick={onCopyLink} label="Copy student link" pill>
            <Link2 size={16} strokeWidth={2} />
          </IconButton>
          <IconButton onClick={onEndSession} label="End session & save" pill primary>
            <CheckCircle2 size={16} strokeWidth={2} />
          </IconButton>
        </div>
      )}
    </>
  );
}

function IconButton({ children, active, disabled, onClick, label, pill, primary, dataAttr }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      data-tool-trigger={dataAttr ? "true" : undefined}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        border: "none", borderRadius: pill ? 999 : 10,
        padding: pill ? "11px 16px" : "11px",
        minWidth: pill ? "auto" : 44,
        minHeight: 44,
        background: primary ? "#1E88E5" : active ? "#E3F2FD" : "transparent",
        color: primary ? "#fff" : disabled ? "#c4c4c4" : "#333",
        cursor: disabled ? "default" : "pointer", fontSize: 13,
        boxShadow: pill ? "0 1px 6px rgba(0,0,0,0.12)" : "none",
        flexShrink: 0,
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
        WebkitTapHighlightColor: "transparent",
        touchAction: "manipulation",
      }}
    >
      {children}
      {pill && <span>{label}</span>}
    </button>
  );
}

function Divider({ horizontal }) {
  return horizontal
    ? <div style={{ height: 1, background: "#e5e5e5", margin: "0 -14px" }} />
    : <div style={{ width: 1, height: 24, background: "#e5e5e5", flexShrink: 0 }} />;
}

const groupStyle = { display: "flex", alignItems: "center", gap: 2, flexShrink: 0 };

const barStyle = {
  position: "fixed",
  bottom: "max(16px, env(safe-area-inset-bottom))",
  left: "50%",
  transform: "translateX(-50%)",
  display: "flex",
  alignItems: "center",
  gap: 10,
  background: "#ffffff",
  padding: "8px 14px",
  borderRadius: 999,
  boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
  zIndex: 10,
  maxWidth: "calc(100vw - 92px)",
  overflowX: "auto",
  WebkitOverflowScrolling: "touch",
  WebkitUserSelect: "none",
  userSelect: "none",
  touchAction: "manipulation",
};

const popoverStyle = {
  position: "fixed",
  bottom: "calc(max(16px, env(safe-area-inset-bottom)) + 68px)",
  background: "#ffffff",
  borderRadius: 14,
  padding: 14,
  boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
  zIndex: 11,
  width: 220,
  WebkitUserSelect: "none",
  userSelect: "none",
};

const ownerBarStyle = {
  position: "fixed",
  top: "max(16px, env(safe-area-inset-top))",
  right: 16,
  display: "flex",
  alignItems: "center",
  gap: 8,
  zIndex: 10,
};

const statusStyle = {
  fontSize: 12, color: "#666", background: "#fff", padding: "4px 10px",
  borderRadius: 999, boxShadow: "0 1px 6px rgba(0,0,0,0.1)",
};