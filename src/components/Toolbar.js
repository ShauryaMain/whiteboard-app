"use client";

export default function Toolbar({
  colors, widths, tool, setTool, color, setColor,
  strokeWidth, setStrokeWidth, onUndo, onRedo, onClear, canUndo, canRedo,
}) {
  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "#ffffff",
        padding: "8px 14px",
        borderRadius: 999,
        boxShadow: "0 2px 12px rgba(0,0,0,0.15)",
        zIndex: 10,
        flexWrap: "wrap",
        justifyContent: "center",
      }}
    >
      {/* Pen / Eraser */}
      <button onClick={() => setTool("pen")} style={btnStyle(tool === "pen")}>✏️ Pen</button>
      <button onClick={() => setTool("eraser")} style={btnStyle(tool === "eraser")}>🧹 Eraser</button>

      <Divider />

      {/* Colors */}
      {colors.map((c) => (
        <button
          key={c}
          onClick={() => { setColor(c); setTool("pen"); }}
          style={{
            width: 26, height: 26, borderRadius: "50%", background: c,
            border: color === c && tool === "pen" ? "3px solid #1E88E5" : "2px solid #ddd",
            cursor: "pointer",
          }}
        />
      ))}

      <Divider />

      {/* Stroke width */}
      {Object.entries(widths).map(([label, size]) => (
        <button
          key={label}
          onClick={() => setStrokeWidth(size)}
          style={btnStyle(strokeWidth === size)}
          title={label}
        >
          <span
            style={{
              display: "inline-block",
              width: size + 4,
              height: size + 4,
              borderRadius: "50%",
              background: "#000",
            }}
          />
        </button>
      ))}

      <Divider />

      <button onClick={onUndo} disabled={!canUndo} style={btnStyle(false, !canUndo)}>↩️ Undo</button>
      <button onClick={onRedo} disabled={!canRedo} style={btnStyle(false, !canRedo)}>↪️ Redo</button>
      <button onClick={onClear} style={btnStyle(false)}>🗑️ Clear</button>
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 24, background: "#e0e0e0" }} />;
}

function btnStyle(active, disabled) {
  return {
    padding: "6px 10px",
    borderRadius: 8,
    border: "none",
    background: active ? "#E3F2FD" : "transparent",
    color: disabled ? "#bbb" : "#333",
    cursor: disabled ? "default" : "pointer",
    fontSize: 14,
    whiteSpace: "nowrap",
  };
}