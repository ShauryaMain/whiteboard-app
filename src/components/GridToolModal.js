"use client";

import { useEffect, useRef, useState } from "react";
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

const PREVIEW_SIZE = 300;

// The "ultimate grid tool" dialog: fully customize a graph-paper /
// grid overlay (cartesian or polar, scale, units, trig/radian labeling,
// axes, unit circle...) with a live preview, before placing it on the
// board (or re-customizing one that's already there). The preview and
// the actual board rendering share the exact same drawing code
// (gridRenderer.js), so what you see here is exactly what you get.
export default function GridToolModal({ initialConfig, onApply, onClose }) {
  const existing = withDefaults(initialConfig);
  const [config, setConfig] = useState(() => ({
    type: existing?.type || "cartesian",
    cols: existing?.cols || 10,
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
    const ratio = window.devicePixelRatio || 1;
    canvas.width = PREVIEW_SIZE * ratio;
    canvas.height = PREVIEW_SIZE * ratio;
    canvas.style.width = PREVIEW_SIZE + "px";
    canvas.style.height = PREVIEW_SIZE + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
    const cellPx = PREVIEW_SIZE / config.cols;
    renderGrid(ctx, config, { cellPx, originXPx: 0, originYPx: 0, lineScale: 1 });
  }, [config]);

  function set(patch) {
    setConfig((prev) => ({ ...prev, ...patch }));
  }

  const isPolar = config.type === "polar";
  const isNewGrid = !initialConfig;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "#fff", borderRadius: 16, width: "min(720px, 100%)", maxHeight: "90vh",
          overflow: "auto", boxShadow: "0 12px 40px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid #eee" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1a1a1a", flex: 1 }}>Grid / Graph Paper</div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ border: "none", background: "#f0f0f0", borderRadius: 8, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ display: "flex", gap: 20, padding: 20, flexWrap: "wrap" }}>
          <div style={{ flex: "0 0 auto" }}>
            <canvas
              ref={canvasRef}
              style={{ border: "1px solid #eee", borderRadius: 10, display: "block" }}
            />
          </div>

          <div style={{ flex: "1 1 260px", minWidth: 240, display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Type">
              <div style={{ display: "flex", gap: 8 }}>
                <SegButton active={!isPolar} onClick={() => set({ type: "cartesian" })}>Cartesian</SegButton>
                <SegButton active={isPolar} onClick={() => set({ type: "polar" })}>Polar</SegButton>
              </div>
            </Field>

            <Field label={isPolar ? "Rings" : "Divisions"}>
              <NumberInput
                value={config.cols}
                min={2}
                max={40}
                onChange={(v) => set({ cols: v })}
              />
            </Field>

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

            <Field label={isPolar ? "Trig labels (radians on spokes)" : "Trig graph (label axes in π)"}>
              <Toggle checked={config.trig} onChange={(v) => set({ trig: v })} />
            </Field>

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

            <Field label="Show axes">
              <Toggle checked={config.showAxes} onChange={(v) => set({ showAxes: v })} />
            </Field>
            <Field label="Show numbers">
              <Toggle checked={config.showNumbers} onChange={(v) => set({ showNumbers: v })} />
            </Field>
            <Field label={isPolar ? "Highlight unit ring" : "Show unit circle"}>
              <Toggle checked={config.showUnitCircle} onChange={(v) => set({ showUnitCircle: v })} />
            </Field>

            <Field label="Color">
              <div style={{ display: "flex", gap: 6 }}>
                {GRID_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => set({ color: c })}
                    aria-label={`Color ${c}`}
                    style={{
                      width: 24, height: 24, borderRadius: "50%", background: c, padding: 0, cursor: "pointer",
                      border: config.color === c ? "2px solid #1a1a1a" : "2px solid transparent", boxShadow: "0 0 0 1px #ddd",
                    }}
                  />
                ))}
              </div>
            </Field>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "14px 20px", borderTop: "1px solid #eee" }}>
          <button onClick={onClose} style={secondaryBtnStyle}>Cancel</button>
          <button onClick={() => onApply(config)} style={primaryBtnStyle}>
            {isNewGrid ? "Add to Board" : "Apply Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "#666", marginBottom: 6, fontWeight: 600 }}>{label}</div>
      {children}
    </div>
  );
}

function SegButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: "8px 12px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600,
        border: active ? "2px solid #1E88E5" : "1px solid #ddd",
        background: active ? "#E3F2FD" : "#fff", color: "#1a1a1a",
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
        width: 44, height: 26, borderRadius: 999, border: "none", cursor: "pointer", position: "relative",
        background: checked ? "#1E88E5" : "#ddd", transition: "background 0.15s",
      }}
    >
      <span
        style={{
          position: "absolute", top: 3, left: checked ? 21 : 3, width: 20, height: 20, borderRadius: "50%",
          background: "#fff", transition: "left 0.15s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        }}
      />
    </button>
  );
}

const selectStyle = {
  padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13, color: "#1a1a1a", background: "#fff",
};

const primaryBtnStyle = {
  border: "none", background: "#1E88E5", color: "#fff", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer",
};

const secondaryBtnStyle = {
  border: "none", background: "#f0f0f0", color: "#333", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
