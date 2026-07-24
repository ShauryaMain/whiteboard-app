"use client";

import { Pencil, Highlighter, Eraser, Ruler, Home, Undo2, Redo2, Trash2, Link2, CheckCircle2 } from "lucide-react";
const PRESET_COLORS = ["#1a1a1a", "#E53935", "#FB8C00", "#43A047", "#1E88E5", "#8E24AA", "#00897B"];

export default function Toolbar({
  tool, setTool, color, setColor, strokeWidth, setStrokeWidth,
  onUndo, onRedo, onClear, canUndo, canRedo,
  isOwner, onCopyLink, onEndSession, saveStatus,
  rulerActive, onToggleRuler, onResetView
}) {
  return (
    <>
      <div className="toolbar-scroll" onContextMenu={(e) => e.preventDefault()} style={barStyle}>
        <div style={groupStyle}>
          <IconButton active={tool === "pen"} onClick={() => setTool("pen")} label="Pen">
            <Pencil size={19} strokeWidth={2} />
          </IconButton>
          <IconButton active={tool === "highlighter"} onClick={() => setTool("highlighter")} label="Highlighter">
            <Highlighter size={19} strokeWidth={2} />
          </IconButton>
          <IconButton active={tool === "eraser"} onClick={() => setTool("eraser")} label="Eraser">
            <Eraser size={19} strokeWidth={2} />
          </IconButton>
          <IconButton active={rulerActive} onClick={onToggleRuler} label="Ruler">
            <Ruler size={19} strokeWidth={2} />
          </IconButton>
        </div>

        <Divider />

        <div style={{ ...groupStyle, gap: 8 }}>
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => { setColor(c); if (tool === "eraser") setTool("pen"); }}
              aria-label={`Color ${c}`}
              style={{
                width: 28, height: 28, borderRadius: "50%", background: c,
                border: color === c ? "3px solid #1a1a1a" : "2px solid transparent",
                boxShadow: "0 0 0 1px #ddd", cursor: "pointer", padding: 0,
                flexShrink: 0, WebkitTouchCallout: "none", WebkitUserSelect: "none",
              }}
            />
          ))}
          <label
            style={{
              width: 28, height: 28, borderRadius: "50%", overflow: "hidden",
              border: "2px solid #ddd", cursor: "pointer", display: "block",
              position: "relative", flexShrink: 0,
            }}
          >
            <input
              type="color"
              value={color}
              onChange={(e) => { setColor(e.target.value); if (tool === "eraser") setTool("pen"); }}
              style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
            />
            <div style={{ width: "100%", height: "100%", background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }} />
          </label>
        </div>

        <Divider />

        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 6px", flexShrink: 0 }}>
          <span
            style={{
              width: Math.max(6, Math.min(strokeWidth, 22)),
              height: Math.max(6, Math.min(strokeWidth, 22)),
              borderRadius: "50%",
              background: tool === "eraser" ? "#ccc" : color,
              flexShrink: 0,
            }}
          />
          <input
            type="range"
            min={1}
            max={40}
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
            style={{ width: 90, height: 36 }}
          />
        </div>

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

function IconButton({ children, active, disabled, onClick, label, pill, primary }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
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

function Divider() {
  return <div style={{ width: 1, height: 24, background: "#e5e5e5", flexShrink: 0 }} />;
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