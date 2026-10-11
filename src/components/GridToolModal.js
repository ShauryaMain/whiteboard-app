"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Plus } from "lucide-react";
import { renderGrid, withDefaults } from "@/lib/gridRenderer";
import GraphPlotEditor from "./GraphPlotEditor";
import GraphChartEditor from "./GraphChartEditor";
import { CHART_KINDS, sampleChart } from "@/lib/graphCharts";
import { BUILT_IN_PRESETS, MAX_PRESETS, loadGraphPresets, saveGraphPresets, presetSettings, expandPreset } from "@/lib/graphPresets";
import { EMPTY_PLOT, tidyParams } from "@/lib/graphPlot";
import {
  axesOf, DEFAULT_AXIS, withLabel, withLog, switchPaper, graphProblem, finishGraph, layoutAxes, layoutOf, piStepValue,
} from "@/lib/graphAxes";
import { readNumber, readInterval, asPiMultiple, formatValue } from "@/lib/graphMath";
import g from "./GraphTool.module.css";

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

const PAPERS = [
  { id: "cartesian", label: "Graph" },
  { id: "dots", label: "Dotted" },
  { id: "log", label: "Log" },
  { id: "polar", label: "Polar" },
  { id: "numberline", label: "Number line" },
  { id: "isometric", label: "Isometric" },
  { id: "chart", label: "Chart" },
];

const LAYOUTS = [
  { id: "four", label: "Four quadrants" },
  { id: "first", label: "First quadrant" },
  { id: "top", label: "Top half" },
  { id: "circle", label: "Unit circle" },
];

// The settings the dialog starts with: the graph's own (an older graph's
// are worked out into ranges, so it looks the same), or a new graph.
function startingConfig(initialConfig, zoomScale) {
  const existing = withDefaults(initialConfig);
  const A = axesOf(existing || { type: "cartesian", axes: { x: DEFAULT_AXIS, y: DEFAULT_AXIS } });
  // (a chart's automatic "Frequency" name isn't one typed by hand, even
  // if an earlier version saved it as the axis' name)
  const auto = (a) => a.autoName || (A.paper === "chart" && (a.name === "Frequency" || a.name === "Frequency density"));
  const plain = (a) => ({ min: a.min, max: a.max, step: a.step, label: a.label, piStep: a.piStep, log: a.log, perDecade: a.perDecade, name: auto(a) ? "" : a.name, anchor: a.anchor });
  const legacyCircle = existing && existing.showUnitCircle && !existing.unitCircle;
  return {
    type: A.paper,
    cols: existing?.cols || 10,
    rows: existing?.rows || existing?.cols || 10,
    // The size of a square ON SCREEN at the current zoom (see Whiteboard.js:
    // more squares repeat the same-size square outward).
    cellSizePx: existing ? Math.round((existing.size / existing.cols) * zoomScale) : 48,
    axes: { x: plain(A.x), y: plain(A.y) },
    minor: A.minor,
    numbersEvery: A.every,
    arrows: A.arrows,
    title: A.title,
    style: A.style,
    unitCircle: existing?.unitCircle
      ? { ...A.unitCircle }
      : legacyCircle
        ? { angles: "none", values: false, units: "deg" }
        : { angles: "all", values: true, units: "deg" },
    unitsPerCell: existing?.unitsPerCell ?? 1,
    unitLabel: existing?.unitLabel ?? "",
    trig: existing?.trig ?? false,
    trigStep: existing?.trigStep || { num: 1, den: 2 },
    showAxes: existing?.showAxes ?? true,
    showNumbers: existing?.showNumbers ?? true,
    showUnitCircle: existing?.showUnitCircle ?? false,
    spokeCount: existing?.spokeCount || 12,
    color: existing?.color || "#cfd8e3",
    snap: !!existing?.snap,
    // a statistics chart's data (see src/lib/graphCharts.js)
    chart: existing?.chart || null,
    // what is drawn on it (see src/lib/graphPlot.js)
    plot: tidyParams({ ...EMPTY_PLOT, ...(existing?.plot || {}) }),
  };
}

// Room round the preview for what's drawn outside the box (numbers along
// an edge, the axes' names, a title, polar angles).
function previewMargins(c, boxH) {
  const A = axesOf(c);
  const titleRoom = A.title ? 28 : 0;
  if (A.paper === "polar") return { l: 34, r: 34, t: 30 + (A.title ? 26 : 0), b: 30 };
  if (A.paper === "isometric") return { l: 8, r: 8, t: 8 + titleRoom, b: 8 };
  if (A.paper === "numberline") {
    // the inequalities are stacked above the line, the numbers below it
    const levels = ((c.plot && c.plot.fns) || []).filter((f) => f && f.latex && !f.hidden && readInterval(f.latex).kind === "interval").length;
    const above = levels ? 24 + 28 * (levels - 1) + 24 : 12;
    return {
      l: 16,
      r: 16 + (A.x.name ? 8 * A.x.name.length + 18 : 0),
      t: 6 + titleRoom + Math.max(0, above - boxH * 0.64),
      b: 6 + Math.max(0, 36 - boxH * 0.36),
    };
  }
  // an axis along the bottom / left edge has its numbers and name outside
  // the box; one through the middle has its name past its end
  const xAlongBottom = A.y.log || A.y.min >= 0;
  const yAlongLeft = A.x.log || A.x.min >= 0;
  return {
    l: 12 + (c.showNumbers && yAlongLeft ? 40 : 0) + (A.y.name && yAlongLeft ? 22 : 0),
    r: 18 + (A.x.name && !xAlongBottom ? 8 * A.x.name.length + 12 : 0),
    t: 12 + titleRoom + (A.y.name && !yAlongLeft ? 22 : 0),
    b: 10 + (c.showNumbers && xAlongBottom ? 22 : 0) + (A.x.name && xAlongBottom ? 24 : 0),
  };
}

// The graph dialog: presets along the top, a big live preview, and the
// settings in three tabs — Axes (the paper, its layout and ranges), Plot
// (equations, points, marks on a number line, or a chart's data) and
// Style (title, lines, numbers, unit circle, snapping, size, colour). The
// preview and the board share the same drawing code (gridRenderer.js), so
// what you see here is exactly what you get.
export default function GridToolModal({ initialConfig, currentZoomScale, onApply, onClose, initialTab = "axes" }) {
  const zoomScale = currentZoomScale || 1;
  const [config, setConfig] = useState(() => startingConfig(initialConfig, zoomScale));
  const [tabWanted, setTab] = useState(initialTab); // "axes" | "plot" | "style"
  const [myPresets, setMyPresets] = useState([]);
  const [presetsWhere, setPresetsWhere] = useState("browser");
  const [naming, setNaming] = useState(null); // the name being typed for a new preset
  const [presetNote, setPresetNote] = useState("");
  const [previewMax, setPreviewMax] = useState(460);

  const canvasRef = useRef(null);
  const isIsometric = config.type === "isometric";
  const isChart = config.type === "chart";
  // (nothing is plotted on isometric paper)
  const tab = isIsometric && tabWanted === "plot" ? "axes" : tabWanted;
  const problem = graphProblem(config);
  const finished = finishGraph(config);

  // the teacher's own presets
  useEffect(() => {
    let cancelled = false;
    loadGraphPresets().then(({ presets, where }) => {
      if (cancelled) return;
      setMyPresets(presets);
      setPresetsWhere(where);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // a big picture on a big screen, a smaller one on a phone
  useEffect(() => {
    function fit() {
      setPreviewMax(Math.max(240, Math.min(560, Math.round(window.innerWidth * 0.4), window.innerHeight - 300)));
    }
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // While the settings can't be drawn, the last good picture stays.
    if (problem) return;

    // The preview canvas is the shape of the graph (plus a margin for
    // what's drawn round it), bounded so an extreme ratio can't make the
    // dialog huge or a sliver too thin to read.
    const rows = finished.type === "polar" ? finished.cols : finished.rows || finished.cols;
    const cols = finished.cols;
    const MIN_DIM = 80;
    const MAX_DIM = previewMax;
    let cellPx = MAX_DIM / Math.max(cols, rows);
    let boxW = cellPx * cols;
    let boxH = cellPx * rows;
    if (Math.min(boxW, boxH) < MIN_DIM && finished.type !== "numberline") {
      const s = Math.min(MIN_DIM / Math.min(boxW, boxH), (MAX_DIM * 1.4) / Math.max(boxW, boxH));
      cellPx *= s; boxW *= s; boxH *= s;
    }
    const m = previewMargins(finished, boxH);
    const w = boxW + m.l + m.r, h = boxH + m.t + m.b;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = w * ratio;
    canvas.height = h * ratio;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    renderGrid(ctx, finished, { cellPx, originXPx: m.l, originYPx: m.t, lineScale: 1 });
  }, [finished, problem, previewMax]);

  function set(patch) {
    setConfig((prev) => ({ ...prev, ...patch }));
  }
  function setAxis(k, patch) {
    // a new range or step has its lines at whole steps from 0
    const moved = ["min", "max", "step", "piStep"].some((key) => key in patch);
    setConfig((prev) => ({ ...prev, axes: { ...prev.axes, [k]: { ...prev.axes[k], ...patch, ...(moved ? { anchor: "zero" } : {}) } } }));
  }
  function replaceAxis(k, axis) {
    setConfig((prev) => ({ ...prev, axes: { ...prev.axes, [k]: axis } }));
  }
  function chooseLayout(id) {
    setConfig((prev) => {
      // the ranges change; the steps (and π or degrees) stay, except for
      // the unit circle, which needs ordinary numbers
      const out = { ...prev, axes: layoutAxes(id, prev.axes.x, prev.axes.y) };
      if (id === "circle") {
        out.showUnitCircle = true;
        out.unitCircle = { ...prev.unitCircle, angles: prev.unitCircle.angles === "none" ? "all" : prev.unitCircle.angles, values: true };
        out.cellSizePx = Math.max(prev.cellSizePx, 100);
        out.showAxes = true;
      }
      return out;
    });
  }
  function choosePreset(preset) {
    // the preset's settings; what's plotted (and the title) stay
    setConfig((prev) => {
      const next = { ...prev, ...expandPreset(preset.settings) };
      // (a preset saved from a chart carries its paper, not its data)
      if (next.type === "chart" && (!next.chart || typeof next.chart !== "object")) next.chart = sampleChart("bar");
      return next;
    });
  }
  async function storePresets(next) {
    setMyPresets(next);
    const where = await saveGraphPresets(next);
    setPresetsWhere(where);
    return where;
  }
  async function saveAsPreset() {
    const name = (naming || "").trim();
    if (!name) return;
    const preset = { id: `mine-${Date.now().toString(36)}`, name, settings: presetSettings(config) };
    const next = [...myPresets.filter((p) => p.name !== name), preset].slice(-MAX_PRESETS);
    setNaming(null);
    const where = await storePresets(next);
    setPresetNote(where === "account" ? `Saved “${name}” with your account.` : `Saved “${name}” in this browser.`);
  }
  async function removePreset(id) {
    await storePresets(myPresets.filter((p) => p.id !== id));
    setPresetNote("");
  }
  function chooseChartKind(kind) {
    setConfig((prev) => {
      const old = prev.chart && prev.chart.kind === kind ? prev.chart : null;
      return { ...prev, chart: old || { ...sampleChart(kind) } };
    });
  }

  const paper = config.type;
  const isPolar = paper === "polar";
  const isLine = paper === "numberline";
  const isLog = paper === "log";
  const hasAxes = paper === "cartesian" || paper === "dots" || paper === "log";
  const chartKind = isChart && config.chart ? config.chart.kind : null;
  const fitAxes = isChart && (!config.chart || config.chart.fitAxes !== false);
  const isNewGrid = !initialConfig;
  const plotCount = isChart ? 0 : ((config.plot && config.plot.fns) || []).filter((f) => f.latex).length + (isLine ? 0 : ((config.plot && config.plot.points) || []).length);
  const layout = layoutOf(config.axes.x, config.axes.y);
  const plotTabName = isChart ? "Data" : isLine ? "Mark on the line" : "Plot";

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
      // keys pressed in this dialog aren't board shortcuts
      data-board-shortcuts="off"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card"
        role="dialog"
        aria-label={isNewGrid ? "New graph" : "Change graph"}
        style={{
          background: "#fff", borderRadius: 18, width: "min(1180px, 100%)", height: "min(880px, 100%)", border: "2px solid var(--ink-line)",
          overflow: "hidden", boxShadow: "6px 6px 0 var(--ink-line)", display: "flex", flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: "2px solid var(--ink-line)", flexShrink: 0, ...paperStyle }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800, color: "var(--ink)", flex: 1 }}>{isNewGrid ? "New graph" : "Graph"}</div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ border: "1.5px solid var(--ink-line)", background: "#fff", borderRadius: 11, width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--ink)" }}
          >
            <X size={16} />
          </button>
        </div>

        <div className={g.presets} role="group" aria-label="Presets">
          <span className={g.presetLabel}>Presets</span>
          {BUILT_IN_PRESETS.map((p) => (
            <button key={p.id} type="button" className={g.preset} onClick={() => choosePreset(p)}>
              {p.name}
            </button>
          ))}
          {myPresets.map((p) => (
            <span key={p.id} className={`${g.preset} ${g.presetMine}`}>
              <button type="button" style={{ border: "none", background: "none", font: "inherit", color: "inherit", cursor: "pointer", padding: 0 }} onClick={() => choosePreset(p)}>
                {p.name}
              </button>
              <button type="button" className={g.presetRemove} aria-label={`Delete the preset ${p.name}`} onClick={() => removePreset(p.id)}>
                <X size={13} />
              </button>
            </span>
          ))}
          {naming === null ? (
            <button
              type="button"
              className={`${g.preset} ${g.presetSave}`}
              disabled={myPresets.length >= MAX_PRESETS}
              onClick={() => {
                setNaming("");
                setPresetNote("");
              }}
            >
              <Plus size={14} /> Save as a preset
            </button>
          ) : (
            <form
              className={g.presetForm}
              onSubmit={(e) => {
                e.preventDefault();
                saveAsPreset();
              }}
            >
              <input
                autoFocus
                className={g.textInput}
                value={naming}
                maxLength={40}
                placeholder="Name it, e.g. Year 9 axes"
                aria-label="Preset name"
                onChange={(e) => setNaming(e.target.value)}
              />
              <button type="submit" className={g.preset} disabled={!naming.trim()}>
                Save
              </button>
              <button type="button" className={g.presetRemove} aria-label="Don't save a preset" onClick={() => setNaming(null)}>
                <X size={13} />
              </button>
            </form>
          )}
          {presetNote && <span className={g.hint} role="status">{presetNote}</span>}
          {!presetNote && myPresets.length > 0 && presetsWhere === "browser" && <span className={g.hint}>(your presets are kept in this browser)</span>}
        </div>

        <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
          <div className={g.dialogBody}>
            <div className={g.previewCol}>
              <canvas
                ref={canvasRef}
                data-graph-preview="true"
                style={{ border: "2px solid var(--ink-line)", borderRadius: 12, display: "block", maxWidth: "100%", boxShadow: "var(--shadow-hard)", opacity: problem ? 0.45 : 1 }}
              />
              {problem && <div className={g.problem} style={{ marginLeft: 0, maxWidth: 420 }} role="alert">{problem}</div>}
            </div>

            <div className={g.settingsCol}>
              <div className={g.tabs} style={{ padding: 0 }} role="tablist" aria-label="Graph settings">
                <button type="button" role="tab" aria-selected={tab === "axes"} className={`${g.tab} ${tab === "axes" ? g.tabOn : ""}`} onClick={() => setTab("axes")}>
                  Axes
                </button>
                {!isIsometric && (
                  <button type="button" role="tab" aria-selected={tab === "plot"} className={`${g.tab} ${tab === "plot" ? g.tabOn : ""}`} onClick={() => setTab("plot")}>
                    {plotTabName}
                    {plotCount > 0 && <span className={g.tabCount}>{plotCount}</span>}
                  </button>
                )}
                <button type="button" role="tab" aria-selected={tab === "style"} className={`${g.tab} ${tab === "style" ? g.tabOn : ""}`} onClick={() => setTab("style")}>
                  Style
                </button>
              </div>

              {tab === "plot" &&
                (isChart ? (
                  <GraphChartEditor chart={config.chart} onChange={(chart) => set({ chart })} />
                ) : (
                  <GraphPlotEditor
                    plot={config.plot}
                    graph={finished}
                    onChange={(plot) => set({ plot })}
                    onPlaceTable={(table) => !problem && onApply(finished, { table })}
                  />
                ))}

              {tab === "axes" && (
                <>
                  <Field label="Paper">
                    <div className={g.paperChoices} role="radiogroup" aria-label="Paper">
                      {PAPERS.map((p) => (
                        <SegButton key={p.id} active={paper === p.id} role="radio" onClick={() => setConfig((prev) => switchPaper(prev, p.id))}>
                          {p.label}
                        </SegButton>
                      ))}
                    </div>
                  </Field>

                  {isChart && (
                    <Field label="Chart">
                      <div className={g.paperChoices} role="radiogroup" aria-label="Chart">
                        {CHART_KINDS.map((k) => (
                          <SegButton key={k.id} active={chartKind === k.id} role="radio" onClick={() => chooseChartKind(k.id)}>
                            {k.label}
                          </SegButton>
                        ))}
                      </div>
                    </Field>
                  )}

                  {hasAxes && !isLog && (
                    <Field label="Layout">
                      <div className={g.paperChoices} role="radiogroup" aria-label="Layout">
                        {LAYOUTS.map((l) => (
                          <SegButton key={l.id} active={layout === l.id} role="radio" onClick={() => chooseLayout(l.id)}>
                            {l.label}
                          </SegButton>
                        ))}
                      </div>
                    </Field>
                  )}

                  {isChart && (
                    <label className={g.check}>
                      <input
                        type="checkbox"
                        checked={fitAxes}
                        onChange={(e) => setConfig((prev) => ({ ...prev, axes: e.target.checked ? prev.axes : finishGraph(prev).axes, chart: { ...prev.chart, fitAxes: e.target.checked } }))}
                      />
                      Fit the axes to the data
                    </label>
                  )}

                  {(hasAxes || isLine || isChart) && (
                    <div className={g.axisBlock}>
                      {isChart && fitAxes ? (
                        <>
                          {chartKind !== "bar" && <AxisName which="x" title="x-axis" axis={config.axes.x} onChange={(patch) => setAxis("x", patch)} />}
                          {chartKind !== "box" && <AxisName which="y" title="y-axis" axis={config.axes.y} onChange={(patch) => setAxis("y", patch)} placeholder={chartKind === "scatter" ? "e.g. Mass (kg)" : "Frequency"} />}
                        </>
                      ) : (
                        <>
                          <AxisRow
                            which="x"
                            title={isLine ? "Number line" : "x-axis"}
                            axis={config.axes.x}
                            allowDeg={!isLog && !isChart}
                            allowPi={!isLog && !isChart}
                            canLog={isLog}
                            onChange={(patch) => setAxis("x", patch)}
                            onReplace={(axis) => replaceAxis("x", axis)}
                          />
                          {!isLine && (
                            <AxisRow
                              which="y"
                              title="y-axis"
                              axis={config.axes.y}
                              allowDeg={false}
                              allowPi={!isLog && !isChart}
                              canLog={isLog}
                              onChange={(patch) => setAxis("y", patch)}
                              onReplace={(axis) => replaceAxis("y", axis)}
                            />
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {isPolar && (
                    <>
                      <Field label="Rings">
                        <NumberInput value={config.cols} min={2} max={60} onChange={(v) => set({ cols: v })} label="Rings" />
                      </Field>
                      <Field label="Spokes (angle divisions)">
                        <NumberInput value={config.spokeCount} min={2} max={72} onChange={(v) => set({ spokeCount: v })} label="Spokes" />
                      </Field>
                      <ToggleRow label="Angles in radians (π)" checked={config.trig} onChange={(v) => set({ trig: v })} />
                      <Field label="Value per ring">
                        <div style={{ display: "flex", gap: 8 }}>
                          <NumberInput value={config.unitsPerCell} min={0.01} step={0.5} allowFloat onChange={(v) => set({ unitsPerCell: v })} label="Value per ring" />
                          <input
                            type="text"
                            value={config.unitLabel}
                            onChange={(e) => set({ unitLabel: e.target.value })}
                            placeholder="units, cm, m…"
                            aria-label="Units"
                            style={{ ...selectStyle, width: 110 }}
                          />
                        </div>
                      </Field>
                    </>
                  )}

                  {isIsometric && (
                    <>
                      <Field label="Size (squares across and down)">
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <NumberInput value={config.cols} min={2} max={60} onChange={(v) => set({ cols: v })} label="Squares across" />
                          <span style={{ fontSize: 12, color: "var(--muted)" }}>across</span>
                          <NumberInput value={config.rows} min={2} max={60} onChange={(v) => set({ rows: v })} label="Squares down" />
                          <span style={{ fontSize: 12, color: "var(--muted)" }}>down</span>
                        </div>
                      </Field>
                      <Field label="Drawn with">
                        <div style={{ display: "flex", gap: 8 }}>
                          <SegButton active={config.style !== "dots"} onClick={() => set({ style: "lines" })}>Lines</SegButton>
                          <SegButton active={config.style === "dots"} onClick={() => set({ style: "dots" })}>Dots</SegButton>
                        </div>
                      </Field>
                    </>
                  )}
                </>
              )}

              {tab === "style" && (
                <>
                  <Field label="Title">
                    <input
                      type="text"
                      value={config.title}
                      maxLength={80}
                      onChange={(e) => set({ title: e.target.value })}
                      placeholder="e.g. Distance travelled"
                      aria-label="Title"
                      style={{ ...selectStyle, width: "100%", boxSizing: "border-box" }}
                    />
                  </Field>

                  {(hasAxes || isLine || isChart) && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
                      {!isLog && paper !== "dots" && !isChart && (
                        <Field label={isLine ? "Small marks between numbers" : "Small squares"}>
                          <select value={String(config.minor)} onChange={(e) => set({ minor: Number(e.target.value) })} style={selectStyle} aria-label={isLine ? "Small marks" : "Small squares"}>
                            <option value="0">None</option>
                            <option value="2">2 across</option>
                            <option value="4">4 across</option>
                            <option value="5">5 across</option>
                            <option value="10">10 across</option>
                          </select>
                        </Field>
                      )}
                      <Field label="Numbers">
                        <select
                          value={String(config.numbersEvery)}
                          onChange={(e) => set({ numbersEvery: e.target.value === "auto" ? "auto" : Number(e.target.value) })}
                          style={selectStyle}
                          aria-label="Numbers on"
                        >
                          <option value="auto">Spaced so they fit</option>
                          <option value="1">On every line</option>
                          <option value="2">On every 2nd line</option>
                          <option value="5">On every 5th line</option>
                          <option value="10">On every 10th line</option>
                        </select>
                      </Field>
                    </div>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", border: "1.5px solid var(--ink-line)", borderRadius: 12, padding: "2px 12px" }}>
                    {(hasAxes || isPolar || isChart) && <ToggleRow label="Show axes" checked={config.showAxes} onChange={(v) => set({ showAxes: v })} />}
                    {(hasAxes || isLine || isChart) && <ToggleRow label="Arrows on the axes" checked={config.arrows} onChange={(v) => set({ arrows: v })} divider={hasAxes || isChart} />}
                    {!isIsometric && <ToggleRow label="Show numbers" checked={config.showNumbers} onChange={(v) => set({ showNumbers: v })} divider />}
                    {(paper === "cartesian" || paper === "dots" || isPolar) && (
                      <ToggleRow label={isPolar ? "Unit circle (radius 1)" : "Show unit circle"} checked={config.showUnitCircle} onChange={(v) => set({ showUnitCircle: v })} divider />
                    )}
                    {config.showUnitCircle && (paper === "cartesian" || paper === "dots" || isPolar) && (
                      <UnitCircleOptions
                        value={config.unitCircle}
                        plainAxes={isPolar || (config.axes.x.label === "number" && config.axes.y.label === "number")}
                        onChange={(patch) => set({ unitCircle: { ...config.unitCircle, ...patch } })}
                      />
                    )}
                    {!isPolar && !isChart && (
                      <ToggleRow label="Snap ruler lines and dots to the grid" checked={!!config.snap} onChange={(v) => set({ snap: v })} divider />
                    )}
                  </div>
                  {config.snap && !isPolar && !isChart && (
                    <div className={g.hint}>
                      Ruler lines and pen dots (or a small ×) drawn near a {isIsometric ? "point of the grid" : isLine ? "mark on the line" : "crossing"} land exactly on it. Ordinary writing isn&apos;t moved.
                    </div>
                  )}

                  <Field label="Size of a square (scales with your zoom)">
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <NumberInput value={config.cellSizePx} min={10} max={200} step={2} onChange={(v) => set({ cellSizePx: v })} label="Size of a square" />
                      <span style={{ fontSize: 12.5, color: "var(--muted)" }}>px {isPolar ? "per ring" : "per square"}, at current zoom</span>
                    </div>
                  </Field>

                  <Field label="Grid colour">
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
                </>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, padding: "12px 16px", borderTop: "2px solid var(--ink-line)", flexShrink: 0, background: "var(--paper)" }}>
          {problem && <span style={{ flex: 1, fontSize: 13, color: "#C62828", fontWeight: 600 }}>Fix the axes first</span>}
          <button onClick={onClose} style={secondaryBtnStyle}>Cancel</button>
          <button onClick={() => !problem && onApply(finished)} disabled={!!problem} style={{ ...primaryBtnStyle, opacity: problem ? 0.5 : 1, cursor: problem ? "default" : "pointer" }}>
            {isNewGrid ? "Add to board" : "Apply changes"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Just an axis' name (for a chart whose ranges are fitted to its data).
function AxisName({ which, title, axis, onChange, placeholder }) {
  return (
    <div className={g.axisRow} role="group" aria-label={title}>
      <div className={g.axisFields}>
        <span className={g.axisTitle}>{title}</span>
        <label className={g.miniField} style={{ flex: "1 1 180px" }}>
          name
          <input
            className={g.textInput}
            value={axis.name || ""}
            maxLength={60}
            placeholder={placeholder || (which === "x" ? "e.g. Time (s)" : "e.g. Distance (m)")}
            aria-label={`${which} name`}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </label>
      </div>
    </div>
  );
}

// One axis: its range, its step, how its numbers are written, and its name.
function AxisRow({ which, title, axis, allowDeg, allowPi, canLog, onChange, onReplace }) {
  const label = axis.label || "number";
  const unit = label === "deg" ? "°" : "";
  const show = (v) => (label === "pi" ? asPiMultiple(v) || formatValue(v, 3) : `${formatValue(v, 4)}`);
  return (
    <div className={g.axisRow} role="group" aria-label={title}>
      <div className={g.axisHead}>
        <span className={g.axisTitle}>{title}</span>
        {(allowPi || allowDeg) && !axis.log && (
          <span className={g.axisLabels} role="radiogroup" aria-label={`${title} numbers`}>
            {[["number", "Numbers"], ...(allowPi ? [["pi", "π"]] : []), ...(allowDeg ? [["deg", "Degrees"]] : [])].map(([id, text]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={label === id}
                className={`${g.seg} ${label === id ? g.segOn : ""}`}
                onClick={() => label !== id && onReplace(withLabel(axis, id))}
              >
                {text}
              </button>
            ))}
          </span>
        )}
        {canLog && (
          <label className={g.check}>
            <input type="checkbox" checked={!!axis.log} onChange={(e) => onReplace(withLog(axis, e.target.checked))} />
            Log scale
          </label>
        )}
      </div>
      <div className={g.axisFields}>
        <label className={g.miniField}>
          from
          <RangeBox value={axis.min} show={show} unit={unit} label={`${which} from`} onCommit={(v) => onChange({ min: v })} />
        </label>
        <label className={g.miniField}>
          to
          <RangeBox value={axis.max} show={show} unit={unit} label={`${which} to`} onCommit={(v) => onChange({ max: v })} />
        </label>
        {axis.log ? (
          <label className={g.miniField}>
            squares per ×10
            <select className={g.select} value={String(axis.perDecade || 3)} onChange={(e) => onChange({ perDecade: Number(e.target.value) })} aria-label={`${which} squares per power of ten`}>
              {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        ) : label === "pi" ? (
          <label className={g.miniField}>
            step
            <select
              className={g.select}
              value={`${axis.piStep.num}/${axis.piStep.den}`}
              aria-label={`${which} step`}
              onChange={(e) => {
                const [num, den] = e.target.value.split("/").map(Number);
                onChange({ piStep: { num, den }, step: piStepValue({ num, den }) });
              }}
            >
              {PI_STEP_PRESETS.map((p) => (
                <option key={p.label} value={`${p.num}/${p.den}`}>{p.label}</option>
              ))}
            </select>
          </label>
        ) : (
          <label className={g.miniField}>
            step
            <RangeBox value={axis.step} show={show} unit={unit} label={`${which} step`} onCommit={(v) => v > 0 && onChange({ step: v })} />
          </label>
        )}
        <label className={g.miniField} style={{ flex: "1 1 150px" }}>
          name
          <input
            className={g.textInput}
            value={axis.name || ""}
            maxLength={60}
            placeholder={which === "x" ? "e.g. Time (s)" : "e.g. Distance (m)"}
            aria-label={`${which} name`}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </label>
      </div>
    </div>
  );
}

function UnitCircleOptions({ value, plainAxes, onChange }) {
  if (!plainAxes) {
    return <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "0 0 10px" }}>The unit circle shows when both axes use ordinary numbers.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0 12px" }}>
      <label className={g.miniField}>
        Angles marked
        <select className={g.select} value={value.angles} onChange={(e) => onChange({ angles: e.target.value })} aria-label="Angles marked">
          <option value="all">Every 30° and 45°</option>
          <option value="30">Every 30°</option>
          <option value="45">Every 45°</option>
          <option value="90">Every 90°</option>
          <option value="none">None</option>
        </select>
      </label>
      {value.angles !== "none" && (
        <>
          <div className={g.angleRow} role="radiogroup" aria-label="Unit circle angles in">
            <span className={g.hint}>Angles in</span>
            <button type="button" role="radio" aria-checked={value.units !== "rad"} className={`${g.seg} ${value.units !== "rad" ? g.segOn : ""}`} onClick={() => onChange({ units: "deg" })}>
              degrees
            </button>
            <button type="button" role="radio" aria-checked={value.units === "rad"} className={`${g.seg} ${value.units === "rad" ? g.segOn : ""}`} onClick={() => onChange({ units: "rad" })}>
              radians
            </button>
          </div>
          <label className={g.check}>
            <input type="checkbox" checked={!!value.values} onChange={(e) => onChange({ values: e.target.checked })} />
            Show (cos, sin) at each angle
          </label>
        </>
      )}
    </div>
  );
}

// A number box that lets you type freely ("-", "2π", "0.") and only
// passes on numbers it can read.
function RangeBox({ value, show, unit, label, onCommit }) {
  const [draft, setDraft] = useState(null);
  const shown = draft !== null ? draft : Number.isFinite(value) ? show(value) : "";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
      <input
        className={g.rangeInput}
        value={shown}
        aria-label={label}
        inputMode="decimal"
        onChange={(e) => {
          setDraft(e.target.value);
          const v = readNumber(e.target.value.replace(/°/g, ""));
          if (Number.isFinite(v)) onCommit(v);
        }}
        onBlur={() => setDraft(null)}
      />
      {unit && <span aria-hidden="true">{unit}</span>}
    </span>
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
      <Toggle checked={checked} onChange={onChange} label={label} />
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

function SegButton({ active, onClick, children, role }) {
  return (
    <button
      type="button"
      onClick={onClick}
      role={role}
      aria-checked={role ? !!active : undefined}
      style={{
        flex: 1, padding: "8px 12px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap",
        border: active ? "2px solid var(--ink-line)" : "1.5px solid #CFCBC1",
        background: active ? "var(--accent-soft)" : "#fff", color: "var(--ink)",
        boxShadow: active ? "var(--shadow-hard-sm)" : "none",
      }}
    >
      {children}
    </button>
  );
}

// A whole number box (or a decimal one) that lets you type freely and only
// passes on numbers between min and max.
function NumberInput({ value, onChange, min, max, step = 1, allowFloat, label }) {
  const [draft, setDraft] = useState(null);
  return (
    <input
      type="number"
      value={draft !== null ? draft : value}
      min={min}
      max={max}
      step={step}
      aria-label={label}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const v = allowFloat ? parseFloat(raw) : parseInt(raw, 10);
        if (Number.isFinite(v) && (min === undefined || v >= min) && (max === undefined || v <= max)) onChange(v);
      }}
      onBlur={() => setDraft(null)}
      style={{ ...selectStyle, width: 90 }}
    />
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      aria-label={label}
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
