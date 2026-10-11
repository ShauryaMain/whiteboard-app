"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { PLOT_COLORS } from "@/lib/graphPlot";
import { readPointList, formatValue } from "@/lib/graphMath";
import { histogramClasses, usesDensity, fiveNumbers, readList, sampleChart, num, MAX_CLASSES, MAX_RAW_TEXT } from "@/lib/graphCharts";
import g from "./GraphTool.module.css";

// The "Data" side of the graph dialog for a statistics chart: what's typed
// in is kept as typed (see src/lib/graphCharts.js), and the chart and its
// axes follow it.

export default function GraphChartEditor({ chart: chartIn, onChange }) {
  const chart = chartIn && chartIn.kind ? chartIn : sampleChart("bar");
  const set = (patch) => onChange({ ...chart, ...patch });
  const color = chart.color || "#1E88E5";

  return (
    <div className={g.editor}>
      {chart.kind === "bar" && <BarData chart={chart} set={set} />}
      {chart.kind === "histogram" && <HistogramData chart={chart} set={set} />}
      {chart.kind === "scatter" && <ScatterData chart={chart} set={set} />}
      {chart.kind === "box" && <BoxData chart={chart} set={set} />}
      <section className={g.section}>
        <div className={g.sectionHead}>
          <h3 className={g.sectionTitle}>Colour</h3>
        </div>
        <div className={g.rowBtns} role="radiogroup" aria-label="Chart colour">
          {PLOT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={`Chart colour ${c}`}
              className={g.colorDot}
              style={{ background: c, boxShadow: color === c ? "0 0 0 3px #fff, 0 0 0 5px var(--ink-line)" : "none" }}
              onClick={() => set({ color: c })}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function RowButtons({ onAdd, addLabel, disabled }) {
  return (
    <div className={g.rowBtns}>
      <button type="button" className={g.addBtn} onClick={onAdd} disabled={disabled}>
        <Plus size={15} /> {addLabel}
      </button>
    </div>
  );
}

function Cell({ value, label, onChange, wide }) {
  return (
    <input
      className={g.ptInput}
      style={wide ? { textAlign: "left" } : undefined}
      value={value == null ? "" : value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function BarData({ chart, set }) {
  const bars = Array.isArray(chart.bars) ? chart.bars : [];
  const update = (k, patch) => set({ bars: bars.map((b, i) => (i === k ? { ...b, ...patch } : b)) });
  return (
    <section className={g.section} aria-labelledby="chart-bars-title">
      <div className={g.sectionHead}>
        <h3 id="chart-bars-title" className={g.sectionTitle}>Bars</h3>
        <span className={g.hint}>A name and a value for each bar.</span>
      </div>
      <div className={g.dataTable} role="table" aria-label="Bars">
        <div className={g.dataHead} role="row">
          <span role="columnheader">Name</span>
          <span role="columnheader">Value</span>
          <span />
        </div>
        {bars.map((b, k) => (
          <div key={k} className={g.dataRow} role="row">
            <Cell value={b.label} label={`Bar ${k + 1} name`} wide onChange={(v) => update(k, { label: v })} />
            <Cell value={b.value} label={`Bar ${k + 1} value`} onChange={(v) => update(k, { value: v })} />
            <button type="button" className={g.iconBtn} aria-label={`Remove bar ${k + 1}`} onClick={() => set({ bars: bars.filter((_, i) => i !== k) })}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      <RowButtons onAdd={() => set({ bars: [...bars, { label: "", value: "" }] })} addLabel="Add a bar" disabled={bars.length >= 40} />
      <label className={g.check}>
        <input type="checkbox" checked={!!chart.showValues} onChange={(e) => set({ showValues: e.target.checked })} />
        Write each value on its bar
      </label>
    </section>
  );
}

function HistogramData({ chart, set }) {
  const classes = Array.isArray(chart.classes) ? chart.classes : [];
  const update = (k, patch) => set({ classes: classes.map((c, i) => (i === k ? { ...c, ...patch } : c)) });
  const read = histogramClasses(chart);
  const density = usesDensity(chart, read);
  const raw = chart.mode === "raw";
  return (
    <section className={g.section} aria-labelledby="chart-hist-title">
      <div className={g.sectionHead}>
        <h3 id="chart-hist-title" className={g.sectionTitle}>Classes</h3>
      </div>
      <div className={g.angleRow} role="radiogroup" aria-label="Histogram data">
        <button type="button" role="radio" aria-checked={!raw} className={`${g.seg} ${!raw ? g.segOn : ""}`} onClick={() => set({ mode: "table" })}>
          Grouped table
        </button>
        <button type="button" role="radio" aria-checked={raw} className={`${g.seg} ${raw ? g.segOn : ""}`} onClick={() => set({ mode: "raw" })}>
          List of values
        </button>
      </div>
      {raw ? (
        <>
          <textarea
            className={g.dataText}
            value={chart.raw || ""}
            rows={4}
            maxLength={MAX_RAW_TEXT}
            aria-label="Values"
            placeholder="e.g. 12, 15, 17, 23, 31, 34, 38…"
            onChange={(e) => set({ raw: e.target.value })}
          />
          <div className={g.tableFields}>
            <label className={g.miniField}>
              classes of width
              <input className={g.smallInput} value={chart.width || ""} aria-label="Class width" onChange={(e) => set({ width: e.target.value })} />
            </label>
            <label className={g.miniField}>
              starting at
              <input className={g.smallInput} value={chart.start || ""} placeholder="auto" aria-label="First class starts at" onChange={(e) => set({ start: e.target.value })} />
            </label>
          </div>
          {readList(chart.raw).length > 0 && !read.length && num(chart.width) > 0 ? (
            <div className={g.problem} style={{ marginLeft: 0 }} role="alert">
              Those values need more than {MAX_CLASSES} classes of width {chart.width}. Make the classes wider.
            </div>
          ) : (
            <div className={g.hint}>{readList(chart.raw).length} values in {read.length} classes. A value on a boundary goes in the class above.</div>
          )}
        </>
      ) : (
        <>
          <div className={g.dataTable} role="table" aria-label="Classes">
            <div className={`${g.dataHead} ${g.dataThree}`} role="row">
              <span role="columnheader">From</span>
              <span role="columnheader">To</span>
              <span role="columnheader">Frequency</span>
              <span />
            </div>
            {classes.map((c, k) => (
              <div key={k} className={`${g.dataRow} ${g.dataThree}`} role="row">
                <Cell value={c.from} label={`Class ${k + 1} from`} onChange={(v) => update(k, { from: v })} />
                <Cell value={c.to} label={`Class ${k + 1} to`} onChange={(v) => update(k, { to: v })} />
                <Cell value={c.freq} label={`Class ${k + 1} frequency`} onChange={(v) => update(k, { freq: v })} />
                <button type="button" className={g.iconBtn} aria-label={`Remove class ${k + 1}`} onClick={() => set({ classes: classes.filter((_, i) => i !== k) })}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <RowButtons
            onAdd={() => {
              const last = read[read.length - 1];
              const w = last ? last.to - last.from : 10;
              set({ classes: [...classes, { from: last ? String(last.to) : "0", to: last ? String(last.to + w) : "10", freq: "" }] });
            }}
            addLabel="Add a class"
            disabled={classes.length >= 100}
          />
        </>
      )}
      <label className={g.miniField}>
        Bar heights
        <select className={g.select} value={chart.yMode || "auto"} onChange={(e) => set({ yMode: e.target.value })} aria-label="Bar heights">
          <option value="auto">Frequency density if the widths differ</option>
          <option value="frequency">Frequency</option>
          <option value="density">Frequency density</option>
        </select>
      </label>
      <div className={g.note} style={{ marginLeft: 0 }}>
        {density ? "The bars show frequency density (frequency ÷ class width), so their areas are the frequencies." : "The bars show frequency."}
      </div>
    </section>
  );
}

function ScatterData({ chart, set }) {
  const pts = Array.isArray(chart.pts) ? chart.pts : [];
  const update = (k, col, v) => set({ pts: pts.map((p, i) => (i === k ? (col === 0 ? [v, p[1]] : [p[0], v]) : p)) });
  return (
    <section className={g.section} aria-labelledby="chart-scatter-title">
      <div className={g.sectionHead}>
        <h3 id="chart-scatter-title" className={g.sectionTitle}>Points</h3>
      </div>
      <div className={g.dataTable} role="table" aria-label="Points">
        <div className={g.dataHead} role="row">
          <span role="columnheader">x</span>
          <span role="columnheader">y</span>
          <span />
        </div>
        {pts.map((p, k) => (
          <div key={k} className={g.dataRow} role="row">
            <Cell value={p[0]} label={`Point ${k + 1} x`} onChange={(v) => update(k, 0, v)} />
            <Cell value={p[1]} label={`Point ${k + 1} y`} onChange={(v) => update(k, 1, v)} />
            <button type="button" className={g.iconBtn} aria-label={`Remove point ${k + 1}`} onClick={() => set({ pts: pts.filter((_, i) => i !== k) })}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      <RowButtons onAdd={() => set({ pts: [...pts, ["", ""]] })} addLabel="Add a point" disabled={pts.length >= 500} />
      <QuickPairs
        onAdd={(read) => set({ pts: [...pts.filter((p) => String(p[0]).trim() || String(p[1]).trim()), ...read.map((q) => [String(q[0]), String(q[1])])].slice(0, 500) })}
      />
      <label className={g.check}>
        <input type="checkbox" checked={!!chart.fit} onChange={(e) => set({ fit: e.target.checked })} />
        Line of best fit
      </label>
      {chart.fit && (
        <label className={g.check}>
          <input type="checkbox" checked={chart.showR !== false} onChange={(e) => set({ showR: e.target.checked })} />
          Show the correlation (r)
        </label>
      )}
    </section>
  );
}

function BoxData({ chart, set }) {
  const sets = Array.isArray(chart.sets) ? chart.sets : [];
  const update = (k, patch) => set({ sets: sets.map((s, i) => (i === k ? { ...s, ...patch } : s)) });
  return (
    <section className={g.section} aria-labelledby="chart-box-title">
      <div className={g.sectionHead}>
        <h3 id="chart-box-title" className={g.sectionTitle}>Data</h3>
        <span className={g.hint}>One box plot for each list (up to 6), to compare them.</span>
      </div>
      {sets.map((s, k) => {
        const f = fiveNumbers(readList(s.raw));
        return (
          <div key={k} className={g.pointSet}>
            <div className={g.fnLine}>
              <input
                className={g.textBox}
                value={s.label || ""}
                placeholder={`List ${k + 1}`}
                aria-label={`Box plot ${k + 1} name`}
                onChange={(e) => update(k, { label: e.target.value })}
              />
              <button type="button" className={g.iconBtn} aria-label={`Remove box plot ${k + 1}`} onClick={() => set({ sets: sets.filter((_, i) => i !== k) })}>
                <Trash2 size={15} />
              </button>
            </div>
            <textarea
              className={g.dataText}
              rows={2}
              maxLength={MAX_RAW_TEXT}
              value={s.raw || ""}
              aria-label={`Box plot ${k + 1} values`}
              placeholder="e.g. 12, 15, 17, 18, 20…"
              onChange={(e) => update(k, { raw: e.target.value })}
            />
            {f && (
              <div className={g.hint}>
                {f.n} values · lowest {formatValue(f.min)} · Q1 {formatValue(f.q1)} · median {formatValue(f.median)} · Q3 {formatValue(f.q3)} · highest {formatValue(f.max)} · IQR {formatValue(f.iqr)}
                {f.outliers.length ? ` · outliers ${f.outliers.map((v) => formatValue(v)).join(", ")}` : ""}
              </div>
            )}
          </div>
        );
      })}
      <RowButtons onAdd={() => set({ sets: [...sets, { label: "", raw: "" }] })} addLabel="Add a list" disabled={sets.length >= 6} />
      <label className={g.check}>
        <input type="checkbox" checked={!!chart.showValues} onChange={(e) => set({ showValues: e.target.checked })} />
        Write the five numbers under each box
      </label>
      <div className={g.hint}>Quartiles are the medians of the lower and upper halves. Values more than 1.5 × IQR beyond them are outliers (circles).</div>
    </section>
  );
}

// Pairs typed or pasted in one go: "(1, 2) (3, 4)", or two columns.
function QuickPairs({ onAdd }) {
  const [text, setText] = useState("");
  const read = readPointList(text) || [];
  return (
    <div className={g.quick} style={{ flexWrap: "wrap" }}>
      <textarea
        className={g.dataText}
        rows={2}
        value={text}
        aria-label="Type or paste points"
        placeholder="Or type or paste pairs: (1, 2.1) (2, 3.9)…"
        onChange={(e) => setText(e.target.value)}
      />
      <button
        type="button"
        className={g.addBtn}
        disabled={!read.length}
        onClick={() => {
          onAdd(read);
          setText("");
        }}
      >
        Add these{read.length ? ` (${read.length})` : ""}
      </button>
    </div>
  );
}
