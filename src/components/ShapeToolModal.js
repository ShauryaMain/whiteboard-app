"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Minus, Plus, RotateCcw } from "lucide-react";
import {
  FAMILIES, TRIANGLE_KINDS, QUAD_KINDS, CIRCLE_KINDS, SOLID_KINDS, DEFAULT_VIEW,
  MIN_SIDES, MAX_SIDES, MAX_BASE_SIDES, MIN_SIZE, MAX_SIZE,
  buildShape, shapeBounds, drawShape, browserTextEnv, labelOptions, canShowHeight, defaultShapeConfig,
  interiorAngle, exteriorAngle, sidesForAngle, polygonName, fmt, cleanUnit,
  recallShapeConfig, rememberShapeConfig,
} from "@/lib/shapeBuilder";
import chrome from "./StudioChrome.module.css";
import s from "./ShapeTool.module.css";

const PREVIEW = 300;

const INK_COLORS = [
  ["Black", "#1a1a1a"],
  ["Red", "#E53935"],
  ["Orange", "#FB8C00"],
  ["Green", "#43A047"],
  ["Blue", "#1E88E5"],
  ["Purple", "#8E24AA"],
  ["Teal", "#00897B"],
];

const TRIANGLE_MODES = [
  { id: "sss", label: "All three sides" },
  { id: "sas", label: "Two sides and the angle between them" },
  { id: "asa", label: "Two angles and the side between them" },
];

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function startConfig(maxSize) {
  const cfg = recallShapeConfig() || defaultShapeConfig();
  return { ...cfg, size: clamp(cfg.size, MIN_SIZE, maxSize) };
}

// The Shape dialog: pick a shape, set it up (sides, angles, lengths, which
// labels to show) and watch the preview, then add it to the board. It
// lands as ordinary pen lines and text labels, so everything the board
// already does with ink — move, copy, rub out, undo, live sharing — just
// works. The preview and the board are drawn by the same code
// (shapeBuilder.js), so what you see is what you get.
export default function ShapeToolModal({ zoomScale = 1, penColor = "#1a1a1a", penWidth = 4, maxSize = MAX_SIZE, onAdd, onClose }) {
  const sizeLimit = clamp(Math.round(maxSize), 200, MAX_SIZE);
  const [cfg, setCfg] = useState(() => startConfig(sizeLimit));
  const [color, setColor] = useState(penColor);
  // Thickness in on-screen pixels, starting at how thick the pen looks at
  // the current zoom.
  const [lineWidth, setLineWidth] = useState(() => clamp(Math.round(penWidth * zoomScale), 1, 12));
  const canvasRef = useRef(null);
  const cardRef = useRef(null);
  const dragRef = useRef(null);

  const env = browserTextEnv();
  const built = buildShape(cfg, env);
  const allowed = labelOptions(cfg);
  const is3d = cfg.family === "solid";
  const roundSolid = is3d && ["cylinder", "cone", "sphere"].includes(cfg.solid.kind);
  const swatches = INK_COLORS.some(([, hex]) => hex.toLowerCase() === String(penColor).toLowerCase())
    ? INK_COLORS
    : [["Your pen colour", penColor], ...INK_COLORS];

  useEffect(() => {
    if (cardRef.current) cardRef.current.focus();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = PREVIEW * ratio;
    canvas.height = PREVIEW * ratio;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, PREVIEW, PREVIEW);
    if (built.error || !built.strokes.length) return;
    const b = shapeBounds(built, env);
    const w = Math.max(b.maxX - b.minX, 1), h = Math.max(b.maxY - b.minY, 1);
    let k = Math.min((PREVIEW - 28) / w, (PREVIEW - 28) / h);
    let cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    if (is3d) {
      // a solid keeps one scale and stays put while you turn it
      const steady = (PREVIEW - 28) / (built.size * 1.2 + 70);
      if (steady <= k) {
        k = steady;
        cx = 0;
        cy = 0;
      }
    }
    ctx.translate(PREVIEW / 2, PREVIEW / 2);
    ctx.scale(k, k);
    ctx.translate(-cx, -cy);
    drawShape(ctx, built, { color, lineWidth, env });
  }, [built, env, color, lineWidth, is3d]);

  function setPart(key, patch) {
    setCfg((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function setTop(patch) {
    setCfg((prev) => ({ ...prev, ...patch }));
  }

  function turnBy(dYaw, dPitch) {
    setCfg((prev) => {
      let yaw = prev.solid.yaw + dYaw;
      if (yaw > 180) yaw -= 360;
      if (yaw < -180) yaw += 360;
      return { ...prev, solid: { ...prev.solid, yaw, pitch: clamp(prev.solid.pitch + dPitch, -90, 90) } };
    });
  }

  function onPreviewDown(e) {
    if (!is3d) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }

  function onPreviewMove(e) {
    const g = dragRef.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    dragRef.current = { id: g.id, x: e.clientX, y: e.clientY };
    turnBy(dx * 0.6, dy * 0.5);
  }

  function onPreviewUp(e) {
    const g = dragRef.current;
    if (g && g.id === e.pointerId) dragRef.current = null;
  }

  function onPreviewKey(e) {
    if (!is3d) return;
    const step = { ArrowLeft: [-6, 0], ArrowRight: [6, 0], ArrowUp: [0, -6], ArrowDown: [0, 6] }[e.key];
    if (!step) return;
    e.preventDefault();
    turnBy(step[0], step[1]);
  }

  function add() {
    if (built.error) return;
    rememberShapeConfig(cfg);
    onAdd({ built, color, lineWidth });
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  }

  return createPortal(
    <div
      className={s.overlay}
      // keys pressed in this dialog aren't board shortcuts
      data-board-shortcuts="off"
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* data-tour tags let the walkthrough point at parts of this window (src/lib/tours.js) */}
      <div className={s.card} role="dialog" aria-modal="true" aria-labelledby="shape-tool-title" tabIndex={-1} ref={cardRef} data-tour="shape-dialog">
        <div className={s.header}>
          <h2 className={s.title} id="shape-tool-title">Shape</h2>
          <button type="button" className={s.closeBtn} onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className={s.tabs} role="group" aria-label="Kind of shape" data-tour="shape-kinds">
          {FAMILIES.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`${s.tab} ${cfg.family === f.id ? s.tabOn : ""}`}
              aria-pressed={cfg.family === f.id}
              onClick={() => setTop({ family: f.id })}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className={s.scroll}>
          <div className={s.body}>
            <div className={s.previewCol} data-tour="shape-preview">
              <div className={s.previewBox}>
                <canvas
                  ref={canvasRef}
                  className={`${s.canvas} ${is3d ? s.canvasTurn : ""}`}
                  role="img"
                  aria-label={built.error ? "No preview" : `Preview: ${built.title}${is3d ? ". Drag, or use the arrow keys, to turn it" : ""}`}
                  tabIndex={is3d ? 0 : -1}
                  data-shape-preview={built.error ? "error" : built.title}
                  onPointerDown={onPreviewDown}
                  onPointerMove={onPreviewMove}
                  onPointerUp={onPreviewUp}
                  onPointerCancel={onPreviewUp}
                  onKeyDown={onPreviewKey}
                />
                {built.error && <div className={s.previewError} role="alert">{built.error}</div>}
                {is3d && !built.error && <span className={s.turnHint} aria-hidden="true">drag to turn</span>}
                {is3d && !built.error && (
                  <button type="button" className={s.resetBtn} onClick={() => setPart("solid", DEFAULT_VIEW)}>
                    <RotateCcw size={14} /> Reset view
                  </button>
                )}
              </div>
              {!built.error && (
                <div>
                  <div className={s.shapeName}>{built.title}</div>
                  <ul className={s.facts}>
                    {built.facts.map((f) => <li key={f}>{f}</li>)}
                  </ul>
                </div>
              )}
            </div>

            <div className={s.settings}>
              {cfg.family === "polygon" && <PolygonFields p={cfg.polygon} set={(patch) => setPart("polygon", patch)} unit={cfg.unit} />}
              {cfg.family === "triangle" && <TriangleFields t={cfg.triangle} set={(patch) => setPart("triangle", patch)} unit={cfg.unit} />}
              {cfg.family === "quad" && <QuadFields q={cfg.quad} set={(patch) => setPart("quad", patch)} unit={cfg.unit} />}
              {cfg.family === "circle" && <CircleFields c={cfg.circle} set={(patch) => setPart("circle", patch)} unit={cfg.unit} />}
              {is3d && <SolidFields v={cfg.solid} set={(patch) => setPart("solid", patch)} unit={cfg.unit} round={roundSolid} />}

              <div data-tour="shape-labels">
                <div className={s.label}>Labels</div>
                <div className={s.group}>
                  {allowed.angles && (
                    <Row label={cfg.family === "polygon" ? "Interior angle" : cfg.family === "circle" ? "Angle at the centre" : "Angles"}>
                      <Toggle checked={cfg.labels.angles} onChange={(v) => setPart("labels", { angles: v })} label="Show angles" />
                    </Row>
                  )}
                  {cfg.family === "polygon" && (
                    <Row label="Exterior angle">
                      <Toggle checked={cfg.polygon.exterior} onChange={(v) => setPart("polygon", { exterior: v })} label="Show the exterior angle" />
                    </Row>
                  )}
                  {cfg.family === "polygon" && cfg.labels.angles && (
                    <Row label="Mark every corner">
                      <Toggle checked={cfg.polygon.everyCorner} onChange={(v) => setPart("polygon", { everyCorner: v })} label="Mark every corner" />
                    </Row>
                  )}
                  {allowed.lengths && (
                    <Row label={is3d || cfg.family === "circle" ? "Lengths" : "Side lengths"}>
                      <Toggle checked={cfg.labels.lengths} onChange={(v) => setPart("labels", { lengths: v })} label="Show lengths" />
                    </Row>
                  )}
                  {allowed.letters && (
                    <Row label={cfg.family === "circle" ? "Letters (O, A, B)" : "Corner letters (A, B, C…)"}>
                      <Toggle checked={cfg.labels.letters} onChange={(v) => setPart("labels", { letters: v })} label="Show letters" />
                    </Row>
                  )}
                  {allowed.marks && (
                    <Row label={cfg.family === "quad" ? "Equal and parallel side marks" : "Equal side marks"}>
                      <Toggle checked={cfg.labels.marks} onChange={(v) => setPart("labels", { marks: v })} label="Show equal and parallel marks" />
                    </Row>
                  )}
                  {canShowHeight(cfg) && (
                    <Row label="Height line">
                      <Toggle
                        checked={cfg[cfg.family].heightLine}
                        onChange={(v) => setPart(cfg.family, { heightLine: v })}
                        label="Show the height"
                      />
                    </Row>
                  )}
                  <Row label="Units">
                    <input
                      type="text"
                      className={s.rowInput}
                      value={cfg.unit}
                      maxLength={8}
                      placeholder="cm, m, in…"
                      aria-label="Units"
                      onChange={(e) => setTop({ unit: e.target.value })}
                    />
                  </Row>
                </div>
              </div>

              <div>
                <div className={s.label}>Look</div>
                <div className={s.group}>
                  <Slider name="Size" min={MIN_SIZE} max={sizeLimit} step={10} value={cfg.size} onChange={(v) => setTop({ size: v })} />
                  <Slider name="Line" min={1} max={12} value={lineWidth} onChange={setLineWidth} showValue color={color} />
                  <div className={s.row}>
                    <span>Colour</span>
                    <div className={s.swatches}>
                      {swatches.map(([name, hex]) => (
                        <button
                          key={hex}
                          type="button"
                          className={`${s.swatch} ${color === hex ? s.swatchOn : ""}`}
                          style={{ background: hex }}
                          aria-label={name}
                          aria-pressed={color === hex}
                          onClick={() => setColor(hex)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={s.footer}>
          <div className={s.footNote}>
            {is3d ? "Drag the picture to turn it round." : "It lands as pen lines you can move, copy or rub out."}
          </div>
          <button type="button" className={s.btn} onClick={onClose}>Cancel</button>
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={add} disabled={!!built.error} data-tour="shape-add">Add to board</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ---------- regular polygon ----------

function PolygonFields({ p, set, unit }) {
  // What's being typed into an angle box, kept until it matches a real
  // polygon (so "12" on the way to "120" doesn't jump about).
  const [draft, setDraft] = useState(null);
  const n = p.n;

  function setSides(next) {
    setDraft(null);
    set({ n: clamp(next, MIN_SIDES, MAX_SIDES) });
  }

  function typeAngle(kind, text) {
    const found = sidesForAngle(kind, parseFloat(text));
    if (found.matches) {
      setDraft(null);
      set({ n: found.nearest });
    } else {
      setDraft({ kind, text });
    }
  }

  const shown = (kind) => (draft && draft.kind === kind ? draft.text : fmt(kind === "interior" ? interiorAngle(n) : exteriorAngle(n)));
  const note = draft ? angleNote(draft) : null;

  return (
    <>
      <div className={s.fields}>
        <Stepper label="Number of sides" value={n} min={MIN_SIDES} max={MAX_SIDES} onChange={setSides} />
        <TextField label="Interior angle" value={shown("interior")} suffix="°" onChange={(text) => typeAngle("interior", text)} />
        <TextField label="Exterior angle" value={shown("exterior")} suffix="°" onChange={(text) => typeAngle("exterior", text)} />
        <NumField label="Side length" value={p.side} suffix={cleanUnit(unit)} onChange={(v) => set({ side: v })} />
      </div>
      {note && (
        <div className={s.note} role="status">
          <span>{note.text}</span>
          {note.use && (
            <button type="button" className={s.noteBtn} onClick={() => setSides(note.use)}>
              Use {note.use} sides
            </button>
          )}
        </div>
      )}
    </>
  );
}

function angleNote(draft) {
  const a = parseFloat(draft.text);
  if (!Number.isFinite(a)) return null;
  const what = draft.kind === "interior" ? "interior" : "exterior";
  if (a <= 0 || a >= 180) return { text: `An ${what} angle is always more than 0° and less than 180°.` };
  const found = sidesForAngle(draft.kind, a);
  const whole = Math.round(found.exact);
  if (Math.abs(found.exact - whole) < 1e-6 && whole > MAX_SIDES) {
    return { text: `That would be a polygon with ${whole} sides. This can draw up to ${MAX_SIDES}.`, use: MAX_SIDES };
  }
  const real = draft.kind === "interior" ? interiorAngle(found.nearest) : exteriorAngle(found.nearest);
  return {
    text: `No regular polygon has a ${fmt(a)}° ${what} angle. The closest is the ${polygonName(found.nearest).toLowerCase()}, with ${fmt(real)}°.`,
    use: found.nearest,
  };
}

// ---------- triangle ----------

function TriangleFields({ t, set, unit }) {
  const u = cleanUnit(unit);
  return (
    <>
      <Chips label="Triangle" options={TRIANGLE_KINDS} value={t.kind} onChange={(kind) => set({ kind })} />
      {t.kind === "custom" && (
        <label className={s.field}>
          <div className={s.label}>Work it out from</div>
          <select className={s.select} value={t.mode} onChange={(e) => set({ mode: e.target.value })}>
            {TRIANGLE_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
      )}
      <div className={s.fields}>
        {t.kind === "equilateral" && <NumField label="Side" value={t.side} suffix={u} onChange={(v) => set({ side: v })} />}
        {t.kind === "isosceles" && (
          <>
            <NumField label="Base" value={t.base} suffix={u} onChange={(v) => set({ base: v })} />
            <NumField label="Equal sides" value={t.equal} suffix={u} onChange={(v) => set({ equal: v })} />
          </>
        )}
        {t.kind === "right" && (
          <>
            <NumField label="Base" value={t.base} suffix={u} onChange={(v) => set({ base: v })} />
            <NumField label="Height" value={t.height} suffix={u} onChange={(v) => set({ height: v })} />
          </>
        )}
        {t.kind === "custom" && (
          <>
            <NumField label="Side AB (the base)" value={t.ab} suffix={u} onChange={(v) => set({ ab: v })} />
            {t.mode === "sss" && <NumField label="Side BC" value={t.bc} suffix={u} onChange={(v) => set({ bc: v })} />}
            {t.mode !== "asa" && <NumField label="Side AC" value={t.ca} suffix={u} onChange={(v) => set({ ca: v })} />}
            {t.mode !== "sss" && <NumField label="Angle at A" value={t.angleA} suffix="°" max={179} onChange={(v) => set({ angleA: v })} />}
            {t.mode === "asa" && <NumField label="Angle at B" value={t.angleB} suffix="°" max={179} onChange={(v) => set({ angleB: v })} />}
          </>
        )}
      </div>
    </>
  );
}

// ---------- quadrilateral ----------

function QuadFields({ q, set, unit }) {
  const u = cleanUnit(unit);
  const k = q.kind;
  return (
    <>
      <Chips label="Quadrilateral" options={QUAD_KINDS} value={k} onChange={(kind) => set({ kind })} />
      <div className={s.fields}>
        {(k === "square" || k === "rhombus") && <NumField label="Side" value={q.side} suffix={u} onChange={(v) => set({ side: v })} />}
        {k === "rectangle" && <NumField label="Width" value={q.width} suffix={u} onChange={(v) => set({ width: v })} />}
        {(k === "rectangle" || k === "trapezium") && <NumField label="Height" value={q.height} suffix={u} onChange={(v) => set({ height: v })} />}
        {k === "parallelogram" && (
          <>
            <NumField label="Base" value={q.base} suffix={u} onChange={(v) => set({ base: v })} />
            <NumField label="Sloping side" value={q.slant} suffix={u} onChange={(v) => set({ slant: v })} />
          </>
        )}
        {(k === "parallelogram" || k === "rhombus") && (
          <NumField label="Angle at A" value={q.angle} suffix="°" max={179} onChange={(v) => set({ angle: v })} />
        )}
        {k === "trapezium" && (
          <>
            <NumField label="Bottom side" value={q.bottom} suffix={u} onChange={(v) => set({ bottom: v })} />
            <NumField label="Top side" value={q.top} suffix={u} onChange={(v) => set({ top: v })} />
          </>
        )}
        {k === "kite" && (
          <>
            <NumField label="Width" value={q.width} suffix={u} onChange={(v) => set({ width: v })} />
            <NumField label="Top part" value={q.upper} suffix={u} onChange={(v) => set({ upper: v })} />
            <NumField label="Bottom part" value={q.lower} suffix={u} onChange={(v) => set({ lower: v })} />
          </>
        )}
      </div>
      {k === "trapezium" && (
        <div className={s.group}>
          <Row label="Right-angled (one upright side)">
            <Toggle checked={q.rightAngled} onChange={(v) => set({ rightAngled: v })} label="Right-angled trapezium" />
          </Row>
        </div>
      )}
    </>
  );
}

// ---------- circles ----------

function CircleFields({ c, set, unit }) {
  const u = cleanUnit(unit);
  const k = c.kind;
  const hasAngle = k === "sector" || k === "segment" || k === "arc";
  return (
    <>
      <Chips label="Circle" options={CIRCLE_KINDS} value={k} onChange={(kind) => set({ kind })} />
      <div className={s.fields}>
        {k !== "ellipse" && <NumField label="Radius" value={c.radius} suffix={u} onChange={(v) => set({ radius: v })} />}
        {hasAngle && <NumField label="Angle" value={c.angle} suffix="°" max={359} onChange={(v) => set({ angle: v })} />}
        {k === "ellipse" && (
          <>
            <NumField label="Width" value={c.width} suffix={u} onChange={(v) => set({ width: v })} />
            <NumField label="Height" value={c.height} suffix={u} onChange={(v) => set({ height: v })} />
          </>
        )}
      </div>
      {!hasAngle && (
        <div className={s.group}>
          {k !== "ellipse" && (
            <Row label="Radius line">
              <Toggle checked={c.showRadius} onChange={(v) => set({ showRadius: v })} label="Show a radius" />
            </Row>
          )}
          {k === "circle" && (
            <Row label="Diameter line">
              <Toggle checked={c.showDiameter} onChange={(v) => set({ showDiameter: v })} label="Show a diameter" />
            </Row>
          )}
          <Row label="Centre dot">
            <Toggle checked={c.showCentre} onChange={(v) => set({ showCentre: v })} label="Show the centre" />
          </Row>
        </div>
      )}
    </>
  );
}

// ---------- 3D ----------

function SolidFields({ v, set, unit, round }) {
  const u = cleanUnit(unit);
  const k = v.kind;
  return (
    <>
      <Chips label="Solid" options={SOLID_KINDS} value={k} onChange={(kind) => set({ kind })} />
      <div className={s.fields}>
        {k === "cube" && <NumField label="Edge" value={v.side} suffix={u} onChange={(x) => set({ side: x })} />}
        {k === "cuboid" && (
          <>
            <NumField label="Width" value={v.width} suffix={u} onChange={(x) => set({ width: x })} />
            <NumField label="Depth" value={v.depth} suffix={u} onChange={(x) => set({ depth: x })} />
          </>
        )}
        {k === "prism" && (
          <Stepper label="Sides on each end" value={v.prismSides} min={MIN_SIDES} max={MAX_BASE_SIDES} onChange={(x) => set({ prismSides: x })} />
        )}
        {k === "pyramid" && (
          <Stepper label="Sides on the base" value={v.pyramidSides} min={MIN_SIDES} max={MAX_BASE_SIDES} onChange={(x) => set({ pyramidSides: x })} />
        )}
        {(k === "prism" || k === "pyramid") && (
          <NumField label={k === "prism" ? "End side" : "Base side"} value={v.baseSide} suffix={u} onChange={(x) => set({ baseSide: x })} />
        )}
        {round && <NumField label="Radius" value={v.radius} suffix={u} onChange={(x) => set({ radius: x })} />}
        {k !== "cube" && k !== "sphere" && (
          <NumField label={k === "prism" && v.lying ? "Length" : "Height"} value={v.height} suffix={u} onChange={(x) => set({ height: x })} />
        )}
      </div>
      <div>
        <div className={s.label}>View</div>
        <div className={s.group}>
          {!round && <Slider name="Turn" min={-180} max={180} value={Math.round(v.yaw)} onChange={(x) => set({ yaw: x })} showValue suffix="°" />}
          <Slider name="Tilt" min={-90} max={90} value={Math.round(v.pitch)} onChange={(x) => set({ pitch: x })} showValue suffix="°" />
          {k === "prism" && (
            <Row label="Lying on its side">
              <Toggle checked={v.lying} onChange={(x) => set({ lying: x })} label="Lay the prism on its side" />
            </Row>
          )}
          <Row label="Dashed hidden edges">
            <Toggle checked={v.hidden} onChange={(x) => set({ hidden: x })} label="Show hidden edges as dashes" />
          </Row>
        </div>
      </div>
    </>
  );
}

// ---------- small controls ----------

function Chips({ label, options, value, onChange }) {
  return (
    <div className={s.chips} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`${s.chip} ${value === o.id ? s.chipOn : ""}`}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// A number box you can type freely in ("0.", "12" on the way to "120"…):
// it keeps what you've typed while you're in it, and hands back a number
// whenever what's there is one.
function NumField({ label, value, onChange, suffix, min = 0, max = 100000, step = 1 }) {
  const [draft, setDraft] = useState(null);
  return (
    <label className={s.field}>
      <div className={s.label}>{label}</div>
      <div className={s.inputWrap}>
        <input
          className={s.input}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={draft === null ? fmt(Number(value), 3) : draft}
          onChange={(e) => {
            const text = e.target.value.replace(",", ".");
            if (!/^\d*\.?\d*$/.test(text)) return;
            setDraft(text);
            const parsed = parseFloat(text);
            if (Number.isFinite(parsed)) onChange(clamp(parsed, min, max));
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            setDraft(null);
            onChange(clamp(Math.round((Number(value) + (e.key === "ArrowUp" ? step : -step)) * 1000) / 1000, min, max));
          }}
        />
        {suffix && <span className={s.suffix}>{suffix}</span>}
      </div>
    </label>
  );
}

function TextField({ label, value, onChange, suffix }) {
  return (
    <label className={s.field}>
      <div className={s.label}>{label}</div>
      <div className={s.inputWrap}>
        <input
          className={s.input}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => {
            const text = e.target.value.replace(",", ".");
            if (/^\d*\.?\d*$/.test(text)) onChange(text);
          }}
        />
        {suffix && <span className={s.suffix}>{suffix}</span>}
      </div>
    </label>
  );
}

function Stepper({ label, value, min, max, onChange }) {
  const [draft, setDraft] = useState(null);
  return (
    <div className={s.field}>
      <div className={s.label}>{label}</div>
      <div className={s.inputWrap}>
        <button type="button" className={s.stepBtn} aria-label={`Fewer: ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
          <Minus size={16} />
        </button>
        <input
          className={`${s.input} ${s.stepInput}`}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label={label}
          value={draft === null ? String(value) : draft}
          onChange={(e) => {
            const text = e.target.value;
            if (!/^\d*$/.test(text)) return;
            setDraft(text);
            const parsed = parseInt(text, 10);
            if (parsed >= min && parsed <= max) onChange(parsed);
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            setDraft(null);
            onChange(clamp(value + (e.key === "ArrowUp" ? 1 : -1), min, max));
          }}
        />
        <button type="button" className={s.stepBtn} aria-label={`More: ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className={s.row}>
      <span>{label}</span>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={label}
      className={`${s.toggle} ${checked ? s.toggleOn : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className={s.toggleDot} />
    </button>
  );
}

function Slider({ name, value, min, max, step = 1, onChange, showValue, suffix = "", color }) {
  const pct = ((clamp(value, min, max) - min) / (max - min)) * 100;
  return (
    <label className={`${s.row} ${s.slider}`}>
      <span className={s.sliderName}>{name}</span>
      <input
        type="range"
        className={`${chrome.range} ${s.sliderRange}`}
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={name}
        style={{ "--fill": `${pct}%`, "--fill-color": color || "var(--accent)" }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {showValue && <span className={s.sliderValue}>{value}{suffix}</span>}
    </label>
  );
}
