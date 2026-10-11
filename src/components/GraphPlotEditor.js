"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Plus, Trash2, X, Table2, Pin } from "lucide-react";
import "mathlive/static.css";
import { loadMathEngine } from "@/lib/calcMath";
import { readEquation, readInterval, readNumber, readPointList, tableXs, sliderOf, formatValue } from "@/lib/graphMath";
import { PLOT_COLORS, EMPTY_PLOT, tidyParams, equationText, paramValues, formatX, usesDegrees } from "@/lib/graphPlot";
import { axesOf } from "@/lib/graphAxes";
import { newId } from "@/lib/boardObjects";
import g from "./GraphTool.module.css";

// The "Plot" side of the graph dialog: equations to draw, sliders for the
// letters in them, points, the features to mark, a table of values, and
// the read-offs pinned on the board. Everything is stored in the graph's
// settings as `plot` (see src/lib/graphPlot.js).


// Keys for typing maths. `latex` goes into the maths box; `text` is used
// when the maths box can't load (older iPads) and a plain box is shown.
const KEYS = [
  [
    { label: "x", latex: "x", text: "x" },
    { label: "y", latex: "y", text: "y" },
    { label: "a", latex: "a", text: "a" },
    { label: "b", latex: "b", text: "b" },
    { label: "c", latex: "c", text: "c" },
    { label: "θ", latex: "\\theta", text: "θ", aria: "theta" },
    { label: "π", latex: "\\pi", text: "π", aria: "pi" },
    { label: "e", latex: "e", text: "e" },
  ],
  [
    { label: "x²", latex: "^{2}", text: "^2", aria: "squared" },
    { label: "xʸ", latex: "^{#0}", text: "^", aria: "power" },
    { label: "√", latex: "\\sqrt{#0}", text: "sqrt(", aria: "square root" },
    { label: "a/b", latex: "\\frac{#0}{#?}", text: "/", aria: "fraction" },
    { label: "|x|", latex: "\\left|#0\\right|", text: "abs(", aria: "absolute value" },
    { label: "(", latex: "(", text: "(", aria: "open bracket" },
    { label: ")", latex: ")", text: ")", aria: "close bracket" },
    { label: "eˣ", latex: "e^{#0}", text: "e^", aria: "e to the power" },
  ],
  [
    { label: "sin", latex: "\\sin\\left(#0\\right)", text: "sin(" },
    { label: "cos", latex: "\\cos\\left(#0\\right)", text: "cos(" },
    { label: "tan", latex: "\\tan\\left(#0\\right)", text: "tan(" },
    { label: "ln", latex: "\\ln\\left(#0\\right)", text: "ln(" },
    { label: "log", latex: "\\log\\left(#0\\right)", text: "log(" },
    { label: "=", latex: "=", text: "=", aria: "equals" },
    { label: "<", latex: "<", text: "<", aria: "less than" },
    { label: ">", latex: ">", text: ">", aria: "greater than" },
  ],
  [
    { label: "≤", latex: "\\le", text: "<=", aria: "less than or equal to" },
    { label: "≥", latex: "\\ge", text: ">=", aria: "greater than or equal to" },
    { label: "←", action: "left", aria: "Move left" },
    { label: "→", action: "right", aria: "Move right" },
    { label: "⌫", action: "del", aria: "Delete" },
  ],
];

// the keys a number line needs
const LINE_KEYS = new Set(["x", "π", "√", "a/b", "(", ")", "=", "<", ">", "≤", "≥", "←", "→", "⌫"]);

const FEATURES = [
  ["roots", "Roots (where it crosses the x-axis)"],
  ["yint", "y-intercept"],
  ["turning", "Turning points"],
  ["intersections", "Where curves cross each other"],
  ["asymptotes", "Asymptotes"],
];

function nextColor(used) {
  return PLOT_COLORS.find((c) => !used.includes(c)) || PLOT_COLORS[used.length % PLOT_COLORS.length];
}


export default function GraphPlotEditor({ plot: plotIn, graph, onChange, onPlaceTable }) {
  const plot = { ...EMPTY_PLOT, ...(plotIn || {}) };
  // the paper it's drawn on
  const axes = axesOf(graph || {});
  const isPolar = axes.paper === "polar";
  const isLine = axes.paper === "numberline";
  const isLog = axes.paper === "log";
  const degrees = usesDegrees({ ...(graph || {}), plot });
  const [mathStatus, setMathStatus] = useState("loading"); // loading | full | basic
  const activeRef = useRef(null); // { el, onChange } of the box the keys type into
  const [tableSpec, setTableSpec] = useState({ fnId: "", from: "-3", to: "3", step: "1", blankY: false });
  const [keysOpen, setKeysOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadMathEngine().then((loaded) => {
      if (!cancelled) setMathStatus(loaded ? "full" : "basic");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function update(patch) {
    onChange({ ...plot, ...patch });
  }

  function setFns(fns) {
    const live = new Set(fns.map((f) => f.id));
    onChange(tidyParams({ ...plot, fns, pins: (plot.pins || []).filter((p) => live.has(p.fnId)) }));
  }

  function addFn() {
    const fn = { id: newId(), latex: "", color: nextColor(plot.fns.map((f) => f.color)) };
    setFns([...plot.fns, fn]);
  }

  function updateFn(id, patch) {
    setFns(plot.fns.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function setParam(name, patch) {
    const p = { ...sliderOf(plot.params[name]), ...patch };
    update({ params: { ...plot.params, [name]: p } });
  }

  function setPoints(points) {
    update({ points });
  }

  function press(key) {
    const target = activeRef.current;
    if (!target || !target.el || !target.el.isConnected) return;
    const el = target.el;
    if (el.tagName === "MATH-FIELD") {
      if (key.action === "del") el.executeCommand("deleteBackward");
      else if (key.action === "left") el.executeCommand("moveToPreviousChar");
      else if (key.action === "right") el.executeCommand("moveToNextChar");
      else el.insert(key.latex, { format: "latex", focus: true, selectionMode: "placeholder", scrollIntoView: true });
      target.onChange(el.value);
      return;
    }
    // a plain text box
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    let value = el.value;
    let caret = start;
    if (key.action === "del") {
      if (start === end && start > 0) {
        value = value.slice(0, start - 1) + value.slice(end);
        caret = start - 1;
      } else {
        value = value.slice(0, start) + value.slice(end);
      }
    } else if (key.action === "left") caret = Math.max(0, start - 1);
    else if (key.action === "right") caret = Math.min(value.length, end + 1);
    else {
      value = value.slice(0, start) + key.text + value.slice(end);
      caret = start + key.text.length;
    }
    target.onChange(value);
    requestAnimationFrame(() => {
      try {
        el.focus();
        el.setSelectionRange(caret, caret);
      } catch (err) {
        // the box has gone
      }
    });
  }

  const usedColors = plot.fns.map((f) => f.color);
  const paramNames = Object.keys(plot.params || {}).sort();
  const values = paramValues(plot);
  const explicitFns = plot.fns.filter((f) => {
    const r = readEquation(f.latex, { degrees });
    return r.ok && r.kind === "y" && r.op === "=";
  });
  const tableFnId = explicitFns.some((f) => f.id === tableSpec.fnId) ? tableSpec.fnId : explicitFns[0] ? explicitFns[0].id : "";
  const tableCount = tableXs(readNumber(tableSpec.from, values), readNumber(tableSpec.to, values), readNumber(tableSpec.step, values)).length;
  const configLike = graph || {};

  return (
    <div className={g.editor}>
      {/* ---------- equations ---------- */}
      <section className={g.section} aria-labelledby="graph-eq-title">
        <div className={g.sectionHead}>
          <h3 id="graph-eq-title" className={g.sectionTitle}>{isLine ? "Points and inequalities" : "Equations"}</h3>
          <span className={g.hint}>
            {isLine ? "e.g. x = 4, x > 2, x ≤ −1, −1 ≤ x < 3" : `e.g. y = x² − 3, y > 2x + 1, x² + y² = 25${isPolar ? ", r = 2cos θ" : ""}`}
          </span>
        </div>
        {plot.fns.length === 0 && <div className={g.empty}>{isLine ? "Nothing marked yet." : "Nothing plotted yet."}</div>}
        {plot.fns.map((fn, index) => {
          const read = isLine ? readInterval(fn.latex) : readEquation(fn.latex, { degrees });
          const explicit = !isLine && !isLog && read.ok && read.kind === "y";
          return (
            <div key={fn.id} className={g.fnRow}>
              <div className={g.fnLine}>
                <button
                  type="button"
                  className={g.colorDot}
                  style={{ background: fn.color }}
                  aria-label={`Colour of equation ${index + 1}. Press to change`}
                  onClick={() => {
                    const i = PLOT_COLORS.indexOf(fn.color);
                    updateFn(fn.id, { color: PLOT_COLORS[(i + 1) % PLOT_COLORS.length] });
                  }}
                />
                <EquationField
                  value={fn.latex}
                  mathStatus={mathStatus}
                  label={`Equation ${index + 1}`}
                  onChange={(latex) => updateFn(fn.id, { latex })}
                  onActive={(el, change) => {
                    activeRef.current = { el, onChange: change };
                  }}
                />
                <button
                  type="button"
                  className={g.iconBtn}
                  aria-label={fn.hidden ? `Show equation ${index + 1}` : `Hide equation ${index + 1}`}
                  aria-pressed={!fn.hidden}
                  onClick={() => updateFn(fn.id, { hidden: !fn.hidden })}
                >
                  {fn.hidden ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                <button type="button" className={g.iconBtn} aria-label={`Remove equation ${index + 1}`} onClick={() => setFns(plot.fns.filter((f) => f.id !== fn.id))}>
                  <Trash2 size={16} />
                </button>
              </div>
              {!read.ok && !read.empty && <div className={g.problem} role="status">{read.message}</div>}
              {isLine && read.ok && read.kind === "interval" && <div className={g.note}>{intervalNote(read)}</div>}
              {!isLine && read.ok && read.op !== "=" && <div className={g.note}>Shaded where it is true{read.strict ? " (dashed edge: the edge isn't included)" : ""}.</div>}
              {explicit && read.op === "=" && (
                <div className={g.areaLine}>
                  <label className={g.check}>
                    <input
                      type="checkbox"
                      checked={!!(fn.area && fn.area.on)}
                      onChange={(e) => updateFn(fn.id, { area: { from: "0", to: "1", ...(fn.area || {}), on: e.target.checked } })}
                    />
                    Shade the area under it
                  </label>
                  {fn.area && fn.area.on && (
                    <span className={g.areaRange}>
                      from x =
                      <input
                        className={g.smallInput}
                        value={fn.area.from}
                        aria-label="Area from"
                        onChange={(e) => updateFn(fn.id, { area: { ...fn.area, from: e.target.value } })}
                      />
                      to
                      <input
                        className={g.smallInput}
                        value={fn.area.to}
                        aria-label="Area to"
                        onChange={(e) => updateFn(fn.id, { area: { ...fn.area, to: e.target.value } })}
                      />
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div className={g.rowBtns}>
          <button type="button" className={g.addBtn} onClick={addFn} disabled={plot.fns.length >= 8}>
            <Plus size={15} /> {isLine ? "Add a point or inequality" : "Add an equation"}
          </button>
          {plot.fns.length > 0 && (
            <button type="button" className={g.linkBtn} onClick={() => setKeysOpen((v) => !v)} aria-expanded={keysOpen}>
              {keysOpen ? "Hide maths keys" : "Show maths keys"}
            </button>
          )}
        </div>
        {plot.fns.length > 0 && keysOpen && (
          <div className={g.keys} role="group" aria-label="Maths keys">
            {KEYS.map((row, r) => (
              <div key={r} className={g.keyRow}>
                {row
                  .filter((k) => (k.label !== "θ" || isPolar) && (!isLine || LINE_KEYS.has(k.label)))
                  .map((k) => (
                    <button
                      key={k.label}
                      type="button"
                      className={`${g.key} ${k.action ? g.keyAction : ""}`}
                      aria-label={k.aria || k.label}
                      // keep the maths box focused while a key is pressed
                      onPointerDown={(e) => e.preventDefault()}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => press(k)}
                    >
                      {k.label}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        )}
      </section>

      {isLine && (
        <section className={g.section}>
          <label className={g.check}>
            <input type="checkbox" checked={plot.equations !== false} onChange={(e) => update({ equations: e.target.checked })} />
            Write each inequality above its line
          </label>
        </section>
      )}

      {/* ---------- sliders ---------- */}
      {!isLine && paramNames.length > 0 && (
        <section className={g.section} aria-labelledby="graph-sliders-title">
          <div className={g.sectionHead}>
            <h3 id="graph-sliders-title" className={g.sectionTitle}>Sliders</h3>
            <span className={g.hint}>These also sit beside the graph on the board, to drag during the lesson.</span>
          </div>
          {paramNames.map((name) => {
            const p = sliderOf(plot.params[name]);
            return (
              <div key={name} className={g.sliderRow}>
                <span className={g.paramName}>{name}</span>
                <input
                  type="range"
                  className={g.range}
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  value={p.value}
                  aria-label={`${name}`}
                  onChange={(e) => setParam(name, { value: Number(e.target.value) })}
                />
                <span className={g.paramValue}>{formatValue(p.value, 3)}</span>
                <label className={g.miniField}>
                  min
                  <NumberBox value={p.min} label={`${name} smallest`} onCommit={(v) => Number.isFinite(v) && v < p.max && setParam(name, { min: v, value: Math.max(v, p.value) })} />
                </label>
                <label className={g.miniField}>
                  max
                  <NumberBox value={p.max} label={`${name} largest`} onCommit={(v) => Number.isFinite(v) && v > p.min && setParam(name, { max: v, value: Math.min(v, p.value) })} />
                </label>
                <label className={g.miniField}>
                  step
                  <NumberBox value={p.step} label={`${name} step`} onCommit={(v) => Number.isFinite(v) && v > 0 && setParam(name, { step: v })} />
                </label>
              </div>
            );
          })}
        </section>
      )}

      {!isLine && (
      <>
      {/* ---------- points ---------- */}
      <section className={g.section} aria-labelledby="graph-points-title">
        <div className={g.sectionHead}>
          <h3 id="graph-points-title" className={g.sectionTitle}>Points</h3>
        </div>
        {(plot.points || []).map((set, index) => (
          <PointSet
            key={set.id}
            set={set}
            index={index}
            onChange={(next) => setPoints(plot.points.map((s) => (s.id === set.id ? next : s)))}
            onRemove={() => setPoints(plot.points.filter((s) => s.id !== set.id))}
          />
        ))}
        <button
          type="button"
          className={g.addBtn}
          disabled={(plot.points || []).length >= 6}
          onClick={() =>
            setPoints([
              ...(plot.points || []),
              { id: newId(), color: nextColor([...usedColors, ...(plot.points || []).map((s) => s.color)]), pts: [[null, null], [null, null], [null, null]], join: false, fit: false, labels: false },
            ])
          }
        >
          <Plus size={15} /> Add points
        </button>
      </section>

      {/* ---------- key features ---------- */}
      <section className={g.section} aria-labelledby="graph-features-title">
        <div className={g.sectionHead}>
          <h3 id="graph-features-title" className={g.sectionTitle}>Mark on the curves</h3>
        </div>
        {isLog && <div className={g.empty}>Roots, turning points and areas aren&apos;t marked on log paper.</div>}
        <div className={g.checkGrid}>
          {(isLog ? [] : FEATURES).map(([key, text]) => (
            <label key={key} className={g.check}>
              <input
                type="checkbox"
                checked={!!(plot.features && plot.features[key])}
                onChange={(e) => update({ features: { ...(plot.features || {}), [key]: e.target.checked } })}
              />
              {text}
            </label>
          ))}
        </div>
        <div className={g.checkGrid}>
          <label className={g.check}>
            <input type="checkbox" checked={plot.equations !== false} onChange={(e) => update({ equations: e.target.checked })} />
            Show the equations on the graph
          </label>
        </div>
        {axes.x.label === "deg" && <div className={g.hint}>sin, cos and tan work in degrees, as the x-axis is in degrees.</div>}
        {axes.x.label === "number" && (
          <div className={g.angleRow} role="radiogroup" aria-label="Angles">
            <span className={g.hint}>sin, cos and tan work in</span>
            <button type="button" role="radio" aria-checked={plot.angle !== "deg"} className={`${g.seg} ${plot.angle !== "deg" ? g.segOn : ""}`} onClick={() => update({ angle: "rad" })}>
              radians
            </button>
            <button type="button" role="radio" aria-checked={plot.angle === "deg"} className={`${g.seg} ${plot.angle === "deg" ? g.segOn : ""}`} onClick={() => update({ angle: "deg" })}>
              degrees
            </button>
          </div>
        )}
      </section>

      {/* ---------- table of values ---------- */}
      <section className={g.section} aria-labelledby="graph-table-title">
        <div className={g.sectionHead}>
          <h3 id="graph-table-title" className={g.sectionTitle}>Table of values</h3>
          <span className={g.hint}>Placed beside the graph as ordinary writing, so students can fill it in.</span>
        </div>
        {explicitFns.length === 0 ? (
          <div className={g.empty}>Add an equation like y = x² − 3 first.</div>
        ) : (
          <>
            <div className={g.tableFields}>
              <label className={g.miniField}>
                for
                <select className={g.select} value={tableFnId} onChange={(e) => setTableSpec((t) => ({ ...t, fnId: e.target.value }))} aria-label="Equation for the table">
                  {explicitFns.map((f) => (
                    <option key={f.id} value={f.id}>
                      {equationText(f.latex)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={g.miniField}>
                x from
                <input className={g.smallInput} value={tableSpec.from} aria-label="Table from" onChange={(e) => setTableSpec((t) => ({ ...t, from: e.target.value }))} />
              </label>
              <label className={g.miniField}>
                to
                <input className={g.smallInput} value={tableSpec.to} aria-label="Table to" onChange={(e) => setTableSpec((t) => ({ ...t, to: e.target.value }))} />
              </label>
              <label className={g.miniField}>
                in steps of
                <input className={g.smallInput} value={tableSpec.step} aria-label="Table step" onChange={(e) => setTableSpec((t) => ({ ...t, step: e.target.value }))} />
              </label>
            </div>
            <div className={g.rowBtns}>
              <label className={g.check}>
                <input type="checkbox" checked={tableSpec.blankY} onChange={(e) => setTableSpec((t) => ({ ...t, blankY: e.target.checked }))} />
                Leave the y row blank
              </label>
              <button
                type="button"
                className={g.addBtn}
                disabled={!tableCount || !tableFnId}
                onClick={() => onPlaceTable({ ...tableSpec, fnId: tableFnId })}
              >
                <Table2 size={15} /> {tableCount ? `Put the table on the board (${tableCount} values)` : "Check the numbers"}
              </button>
            </div>
          </>
        )}
      </section>

      {/* ---------- read-offs ---------- */}
      <section className={g.section} aria-labelledby="graph-pins-title">
        <div className={g.sectionHead}>
          <h3 id="graph-pins-title" className={g.sectionTitle}>Reading off a curve</h3>
          <span className={g.hint}>On the board, with the Graph tool on, tap a curve and slide along it. Pin a point to keep it.</span>
        </div>
        {(plot.pins || []).length === 0 ? (
          <div className={g.empty}>No pinned points.</div>
        ) : (
          (plot.pins || []).map((pin) => {
            const fn = plot.fns.find((f) => f.id === pin.fnId);
            return (
              <div key={pin.id} className={g.pinRow}>
                <Pin size={14} color={fn ? fn.color : undefined} aria-hidden="true" />
                <span className={g.pinText}>
                  x = {formatX(pin.x, configLike)} on {fn ? equationText(fn.latex) : "a removed curve"}
                </span>
                <label className={g.check}>
                  <input
                    type="checkbox"
                    checked={!!pin.tangent}
                    onChange={(e) => update({ pins: plot.pins.map((p) => (p.id === pin.id ? { ...p, tangent: e.target.checked } : p)) })}
                  />
                  tangent
                </label>
                <button type="button" className={g.iconBtn} aria-label="Remove this pinned point" onClick={() => update({ pins: plot.pins.filter((p) => p.id !== pin.id) })}>
                  <X size={15} />
                </button>
              </div>
            );
          })
        )}
      </section>
      </>
      )}
    </div>
  );
}

// What the circles at the ends of an inequality mean.
function intervalNote(r) {
  const ends = [];
  if (Number.isFinite(r.lo)) ends.push(r.loClosed);
  if (Number.isFinite(r.hi)) ends.push(r.hiClosed);
  const parts = [];
  if (ends.includes(true)) parts.push("A filled circle: that number is included.");
  if (ends.includes(false)) parts.push("An open circle: that number isn't.");
  return parts.join(" ");
}

// One equation: the maths box (or a plain box when it can't load).
function EquationField({ value, mathStatus, label, onChange, onActive }) {
  const mfRef = useRef(null);
  const inputRef = useRef(null);
  const latest = useRef({ onChange, onActive, value });

  useEffect(() => {
    latest.current = { onChange, onActive, value };
  });

  useEffect(() => {
    if (mathStatus !== "full") return undefined;
    const mf = mfRef.current;
    if (!mf) return undefined;
    mf.mathVirtualKeyboardPolicy = "manual";
    mf.menuItems = [];
    mf.popoverPolicy = "off";
    mf.smartFence = true;
    mf.placeholder = "y=";
    if (mf.value !== latest.current.value) mf.value = latest.current.value || "";
    const change = (v) => latest.current.onChange(v);
    function onInput() {
      latest.current.onChange(mf.value);
    }
    function onFocus() {
      latest.current.onActive(mf, change);
    }
    mf.addEventListener("input", onInput);
    mf.addEventListener("focus", onFocus);
    mf.addEventListener("focusin", onFocus);
    // a new, empty box is ready to type into. This waits a frame: focusing
    // the maths box the moment it's added leaves it thinking it has the
    // keyboard when it doesn't, and then a click on it does nothing.
    let frame = 0;
    if (!latest.current.value && window.matchMedia && window.matchMedia("(hover: hover)").matches) {
      frame = requestAnimationFrame(() => {
        if (mf.isConnected) mf.focus();
      });
    }
    latest.current.onActive(mf, change);
    return () => {
      cancelAnimationFrame(frame);
      mf.removeEventListener("input", onInput);
      mf.removeEventListener("focus", onFocus);
      mf.removeEventListener("focusin", onFocus);
    };
  }, [mathStatus]);

  if (mathStatus === "full") {
    return (
      <div className={g.mathBox}>
        <math-field ref={mfRef} aria-label={label}></math-field>
      </div>
    );
  }
  return (
    <input
      ref={inputRef}
      className={g.textBox}
      aria-label={label}
      value={value}
      placeholder={mathStatus === "loading" ? "Loading the maths keyboard…" : "y = x^2 - 3"}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => onActive(e.target, onChange)}
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
    />
  );
}

// A number box that lets you type freely ("-", "0.") and only passes on
// numbers it can read (including "π/2").
function NumberBox({ value, label, onCommit, className }) {
  const [draft, setDraft] = useState(null);
  const shown = draft !== null ? draft : value === null || value === undefined || !Number.isFinite(value) ? "" : String(Number(Number(value).toPrecision(6)));
  return (
    <input
      className={className || g.smallInput}
      value={shown}
      aria-label={label}
      inputMode="decimal"
      onChange={(e) => {
        setDraft(e.target.value);
        const v = readNumber(e.target.value);
        if (Number.isFinite(v)) onCommit(v);
        else if (!e.target.value.trim()) onCommit(null);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

function PointSet({ set, index, onChange, onRemove }) {
  const [quick, setQuick] = useState("");
  const pts = set.pts || [];
  const setPt = (row, col, v) => {
    const next = pts.map((p, k) => (k === row ? (col === 0 ? [v, p[1]] : [p[0], v]) : p));
    onChange({ ...set, pts: next });
  };
  const filled = pts.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).length;
  return (
    <div className={g.pointSet}>
      <div className={g.fnLine}>
        <button
          type="button"
          className={g.colorDot}
          style={{ background: set.color }}
          aria-label={`Colour of points ${index + 1}. Press to change`}
          onClick={() => {
            const i = PLOT_COLORS.indexOf(set.color);
            onChange({ ...set, color: PLOT_COLORS[(i + 1) % PLOT_COLORS.length] });
          }}
        />
        <span className={g.pointsTitle}>Points {index + 1}</span>
        <span className={g.hint}>{filled} plotted</span>
        <button type="button" className={g.iconBtn} aria-label={`Remove points ${index + 1}`} onClick={onRemove}>
          <Trash2 size={16} />
        </button>
      </div>
      <div className={g.ptTable} role="table" aria-label={`Points ${index + 1}`}>
        <div className={g.ptHead} role="row">
          <span role="columnheader">x</span>
          <span role="columnheader">y</span>
          <span />
        </div>
        {pts.map((p, row) => (
          <div key={row} className={g.ptRow} role="row">
            <NumberBox value={p[0]} label={`Point ${row + 1} x`} onCommit={(v) => setPt(row, 0, v)} className={g.ptInput} />
            <NumberBox value={p[1]} label={`Point ${row + 1} y`} onCommit={(v) => setPt(row, 1, v)} className={g.ptInput} />
            <button type="button" className={g.iconBtn} aria-label={`Remove point ${row + 1}`} onClick={() => onChange({ ...set, pts: pts.filter((_, k) => k !== row) })}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className={g.rowBtns}>
        <button type="button" className={g.linkBtn} onClick={() => onChange({ ...set, pts: [...pts, [null, null]] })} disabled={pts.length >= 60}>
          + Add a row
        </button>
        <span className={g.quick}>
          <input
            className={g.quickInput}
            value={quick}
            placeholder="or type (1, 2) (3, 5) …"
            aria-label={`Type points for points ${index + 1}`}
            onChange={(e) => setQuick(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const add = readPointList(quick);
              if (!add.length) return;
              const kept = pts.filter((p) => Number.isFinite(p[0]) || Number.isFinite(p[1]));
              onChange({ ...set, pts: [...kept, ...add].slice(0, 60) });
              setQuick("");
            }}
          />
          <button
            type="button"
            className={g.linkBtn}
            disabled={!readPointList(quick).length}
            onClick={() => {
              const add = readPointList(quick);
              const kept = pts.filter((p) => Number.isFinite(p[0]) || Number.isFinite(p[1]));
              onChange({ ...set, pts: [...kept, ...add].slice(0, 60) });
              setQuick("");
            }}
          >
            Add these
          </button>
        </span>
      </div>
      <div className={g.checkGrid}>
        <label className={g.check}>
          <input type="checkbox" checked={!!set.join} onChange={(e) => onChange({ ...set, join: e.target.checked })} />
          Join them up
        </label>
        <label className={g.check}>
          <input type="checkbox" checked={!!set.fit} onChange={(e) => onChange({ ...set, fit: e.target.checked })} />
          Line of best fit
        </label>
        <label className={g.check}>
          <input type="checkbox" checked={!!set.labels} onChange={(e) => onChange({ ...set, labels: e.target.checked })} />
          Show coordinates
        </label>
      </div>
    </div>
  );
}
