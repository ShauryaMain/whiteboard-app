"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { renderGrid, withDefaults } from "@/lib/gridRenderer";

const PI_STEP_PRESETS = [
  { label: "π", num: 1, den: 1 },
  { label: "π/2", num: 1, den: 2 },
  { label: "π/3", num: 1, den: 3 },
  { label: "π/4", num: 1, den: 4 },
  { label: "π/6", num: 1, den: 6 },
  { label: "π/8", num: 1, den: 8 },
  { label: "π/12", num: 1, den: 12 },
];

const GRID_COLORS = ["#cfd8e3", "#90a4ae", "#1E88E5", "#43A047", "#8E24AA", "#1a1a1a"];

const PREVIEW_SIZE = 240;

// The "ultimate grid tool" dialog: fully customize a graph-paper /
// grid overlay (cartesian or polar, scale, units, trig/radian labeling,
// axes, unit circle...) with a live preview, before placing it on the
// board (or re-customizing one that's already there). The preview and
// the actual board rendering share the exact same drawing code
// (gridRenderer.js), so what you see here is exactly what you get.
export default function GridToolModal({ initialConfig, currentZoomScale, onApply, onClose }) {
  const existing = withDefaults(initialConfig);
  const zoomScale = currentZoomScale || 1;
  const [config, setConfig] = useState(() => ({
    type: existing?.type || "cartesian",
    cols: existing?.cols || 10,
    rows: existing?.rows || existing?.cols || 10,
    // The grid's scale, as a target ON-SCREEN size (not a physical unit).
    // This is what stays constant when you change how many columns/rows/
    // rings there are, so adding more of them repeats the SAME-size cell
    // outward (stretching the grid) instead of shrinking every cell to
    // cram the same count into a fixed footprint. It's tied to your
    // CURRENT zoom level rather than a fixed real-world measurement, so a
    // grid always looks like a reasonable size on screen no matter how
    // zoomed in or out you are, and adding a lot of sections can't balloon
    // it into something bigger than your view.
    cellSizePx: existing ? Math.round((existing.size / existing.cols) * zoomScale) : 48,
    unitsPerCell: existing?.unitsPerCell ?? 1,
    unitLabel: existing?.unitLabel ?? "",
    trig: existing?.trig ?? false,
    trigStep: existing?.trigStep || { num: 1, den: 2 },
    showAxes: existing?.showAxes ?? true,
    showNumbers: existing?.showNumbers ?? true,
    showUnitCircle: existing?.showUnitCircle ?? false,
    spokeCount: existing?.spokeCount || 12,
    color: existing?.color || "#cfd8e3",
  }));

  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // The preview canvas itself is resized to the grid's actual aspect
    // ratio (rather than staying a fixed square and rendering a smaller
    // rectangle inside it) so a stretched grid never leaves dead white
    // space in the box - the canvas simply IS the shape of the grid.
    // Bounded so an extreme ratio can't make the dialog unusably huge or
    // a sliver too thin to read.
    const rows = config.type === "polar" ? config.cols : config.rows || config.cols;
    const cols = config.cols;
    const MIN_DIM = 80;
    const MAX_DIM = 340;
    let cellPx = PREVIEW_SIZE / Math.max(cols, rows);
    let boxW = cellPx * cols;
    let boxH = cellPx * rows;
    if (Math.max(boxW, boxH) > MAX_DIM) {
      const s = MAX_DIM / Math.max(boxW, boxH);
      cellPx *= s; boxW *= s; boxH *= s;
    }
    if (Math.min(boxW, boxH) < MIN_DIM) {
      const s = Math.min(MIN_DIM / Math.min(boxW, boxH), MAX_DIM / Math.max(boxW, boxH));
      cellPx *= s; boxW *= s; boxH *= s;
    }

    const ratio = window.devicePixelRatio || 1;
    canvas.width = boxW * ratio;
    canvas.height = boxH * ratio;
    canvas.style.width = boxW + "px";
    canvas.style.height = boxH + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, boxW, boxH);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, boxW, boxH);
    renderGrid(ctx, config, { cellPx, originXPx: 0, originYPx: 0, lineScale: 1 });
  }, [config]);

  function set(patch) {
    setConfig((prev) => ({ ...prev, ...patch }));
  }

  const isPolar = config.type === "polar";
  const isNewGrid = !initialConfig;

  // Rendered into <body> (not inside the board pane) so it's centred on the
  // whole screen and can use its full height. The card never exceeds the
  // visible screen: the header and the Cancel/Apply buttons stay pinned and
  // only the settings scroll, so nothing gets cut off on small tablets.
  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000, background: "rgba(27,29,36,0.32)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card"
        style={{
          background: "#fff", borderRadius: 18, width: "min(680px, 100%)", border: "2px solid var(--ink-line)",
          overflow: "hidden", boxShadow: "6px 6px 0 var(--ink-line)", display: "flex", flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: "2px solid var(--ink-line)", flexShrink: 0, ...paperStyle }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800, color: "var(--ink)", flex: 1 }}>Graph</div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ border: "1.5px solid var(--ink-line)", background: "#fff", borderRadius: 11, width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--ink)" }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
        <div style={{ display: "flex", gap: 16, padding: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ flex: "0 0 auto" }}>
            <canvas
              ref={canvasRef}
              style={{ border: "2px solid var(--ink-line)", borderRadius: 12, display: "block", boxShadow: "var(--shadow-hard)" }}
            />
          </div>

          <div style={{ flex: "1 1 260px", minWidth: 240, display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="Type">
              <div style={{ display: "flex", gap: 8 }}>
                <SegButton active={!isPolar} onClick={() => set({ type: "cartesian" })}>Cartesian</SegButton>
                <SegButton active={isPolar} onClick={() => set({ type: "polar" })}>Polar</SegButton>
              </div>
            </Field>

            <Field label="Cell size (scales with your zoom)">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <NumberInput
                  value={config.cellSizePx}
                  min={10}
                  max={200}
                  step={2}
                  onChange={(v) => set({ cellSizePx: v })}
                />
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>px per {isPolar ? "ring" : "square"}, at current zoom</span>
              </div>
            </Field>

            {isPolar ? (
              <Field label="Rings">
                <NumberInput
                  value={config.cols}
                  min={2}
                  max={60}
                  onChange={(v) => set({ cols: v })}
                />
              </Field>
            ) : (
              <Field label="Sections (repeat cells outward)">
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <NumberInput
                    value={config.cols}
                    min={2}
                    max={60}
                    onChange={(v) => set({ cols: v })}
                  />
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>columns</span>
                  <NumberInput
                    value={config.rows}
                    min={2}
                    max={60}
                    onChange={(v) => set({ rows: v })}
                  />
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>rows</span>
                </div>
              </Field>
            )}

            {isPolar && (
              <Field label="Spokes (angle divisions)">
                <NumberInput
                  value={config.spokeCount}
                  min={2}
                  max={72}
                  onChange={(v) => set({ spokeCount: v })}
                />
              </Field>
            )}

            <ToggleRow
              label={isPolar ? "Trig labels (radians on spokes)" : "Trig graph (label axes in π)"}
              checked={config.trig}
              onChange={(v) => set({ trig: v })}
            />

            {!isPolar && config.trig && (
              <Field label="Spacing per cell">
                <select
                  value={`${config.trigStep.num}/${config.trigStep.den}`}
                  onChange={(e) => {
                    const [num, den] = e.target.value.split("/").map(Number);
                    set({ trigStep: { num, den } });
                  }}
                  style={selectStyle}
                >
                  {PI_STEP_PRESETS.map((p) => (
                    <option key={p.label} value={`${p.num}/${p.den}`}>
                      {p.label} per cell
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {(!config.trig || isPolar) && (
              <Field label={isPolar ? "Value per ring" : "Value per cell"}>
                <div style={{ display: "flex", gap: 8 }}>
                  <NumberInput
                    value={config.unitsPerCell}
                    min={0.01}
                    step={0.5}
                    allowFloat
                    onChange={(v) => set({ unitsPerCell: v })}
                  />
                  <input
                    type="text"
                    value={config.unitLabel}
                    onChange={(e) => set({ unitLabel: e.target.value })}
                    placeholder="units, cm, m…"
                    style={{ ...selectStyle, width: 100 }}
                  />
                </div>
              </Field>
            )}

            <div style={{ display: "flex", flexDirection: "column", border: "1.5px solid var(--ink-line)", borderRadius: 12, padding: "2px 12px" }}>
              <ToggleRow label="Show axes" checked={config.showAxes} onChange={(v) => set({ showAxes: v })} />
              <ToggleRow label="Show numbers" checked={config.showNumbers} onChange={(v) => set({ showNumbers: v })} divider />
              <ToggleRow
                label={isPolar ? "Highlight unit ring" : "Show unit circle"}
                checked={config.showUnitCircle}
                onChange={(v) => set({ showUnitCircle: v })}
                divider
              />
            </div>

            <Field label="Color">
              <div style={{ display: "flex", gap: 6 }}>
                {GRID_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => set({ color: c })}
                    aria-label={`Color ${c}`}
                    style={{
                      width: 24, height: 24, borderRadius: "50%", background: c, padding: 0, cursor: "pointer",
                      border: config.color === c ? "2px solid var(--ink-line)" : "1.5px solid rgba(27,29,36,0.35)",
                      boxShadow: config.color === c ? "inset 0 0 0 2px #fff, 2px 2px 0 var(--ink-line)" : "none",
                    }}
                  />
                ))}
              </div>
            </Field>
          </div>
        </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "12px 16px", borderTop: "2px solid var(--ink-line)", flexShrink: 0, background: "var(--paper)" }}>
          <button onClick={onClose} style={secondaryBtnStyle}>Cancel</button>
          <button onClick={() => onApply(config)} style={primaryBtnStyle}>
            {isNewGrid ? "Add to board" : "Apply changes"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ToggleRow({ label, checked, onChange, divider }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 44,
        borderTop: divider ? "1.5px dashed #D6D2C8" : "none",
      }}
    >
      <span style={{ fontSize: 13.5, color: "var(--ink)" }}>{label}</span>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}


function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginBottom: 6, fontWeight: 700 }}>{label}</div>
      {children}
    </div>
  );
}

function SegButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: "8px 12px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700,
        border: active ? "2px solid var(--ink-line)" : "1.5px solid #CFCBC1",
        background: active ? "var(--accent-soft)" : "#fff", color: "var(--ink)",
        boxShadow: active ? "var(--shadow-hard-sm)" : "none",
      }}
    >
      {children}
    </button>
  );
}

function NumberInput({ value, onChange, min, max, step = 1, allowFloat }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const raw = e.target.value;
        const v = allowFloat ? parseFloat(raw) : parseInt(raw, 10);
        if (!Number.isNaN(v)) onChange(v);
      }}
      style={{ ...selectStyle, width: 90 }}
    />
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      style={{
        width: 46, height: 28, borderRadius: 999, border: "1.5px solid var(--ink-line)", cursor: "pointer", position: "relative",
        background: checked ? "var(--accent)" : "#E9E6DE", transition: "background 0.15s", flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute", top: 2.5, left: checked ? 20.5 : 2.5, width: 20, height: 20, borderRadius: "50%",
          background: "#fff", transition: "left 0.15s", border: "1.5px solid var(--ink-line)", boxSizing: "border-box",
        }}
      />
    </button>
  );
}

const selectStyle = {
  padding: "8px 10px", borderRadius: 10, border: "1.5px solid var(--ink-line)", fontSize: 13.5, color: "var(--ink)", background: "#fff",
};

const paperStyle = {
  backgroundColor: "var(--paper)",
  backgroundImage: "linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px)",
  backgroundSize: "20px 20px",
};

const primaryBtnStyle = {
  border: "2px solid var(--ink-line)", background: "var(--accent)", color: "#fff", borderRadius: 12, padding: "0 18px", height: 44,
  fontSize: 14.5, fontWeight: 600, cursor: "pointer", boxShadow: "var(--shadow-hard)",
};

const secondaryBtnStyle = {
  border: "2px solid var(--ink-line)", background: "#fff", color: "var(--ink)", borderRadius: 12, padding: "0 18px", height: 44,
  fontSize: 14.5, fontWeight: 600, cursor: "pointer",
};
