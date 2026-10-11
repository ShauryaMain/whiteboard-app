"use client";

import { useState, useSyncExternalStore } from "react";
import { Pin, X, Minus, SlidersHorizontal, Trash2 } from "lucide-react";
import { sliderOf, formatValue } from "@/lib/graphMath";
import { sliderParams, readoutValues } from "@/lib/graphPlot";
import g from "./GraphTool.module.css";

// The parts of the graphs that sit on the board itself, over the drawing:
// the sliders for the letters in each graph's equations, and the little
// bar beside a point being read off a curve. The board positions them
// (see repositionGraphBits in Whiteboard.js); these just show what's in
// the graph store: { graphs: [...], trace: { graphId, fnId, x, … } | null }.

const NO_STATE = { graphs: [], trace: null };

function useGraphs(store) {
  return useSyncExternalStore(store.subscribe, store.get, () => NO_STATE);
}

const geomOf = (graph) => ({ cellPx: graph.size / graph.cols, originXPx: graph.x, originYPx: graph.y, lineScale: 1 });

// One panel of sliders beside each graph that has letters in its equations.
export function GraphSliderPanels({ store, panelRefs, onParam, onPlace }) {
  const { graphs } = useGraphs(store);
  const [folded, setFolded] = useState({});
  return (graphs || []).map((graph) => {
    const names = sliderParams(graph);
    if (!names.length) return null;
    const params = graph.plot.params;
    const isFolded = !!folded[graph.id];
    return (
      <div
        key={graph.id}
        ref={(el) => {
          if (el) panelRefs.current[graph.id] = el;
          else delete panelRefs.current[graph.id];
          // placed beside its graph as soon as it appears (and when it changes size)
          if (el) onPlace();
        }}
        className={g.sliderPanel}
        data-graph-sliders="true"
        data-graph-id={graph.id}
        style={{ width: isFolded ? "auto" : undefined }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <SlidersHorizontal size={14} aria-hidden="true" />
          <span className={g.panelTitle} style={{ flex: 1 }}>Sliders</span>
          <button
            type="button"
            className={g.iconBtn}
            style={{ width: 26, height: 26 }}
            aria-label={isFolded ? "Show the sliders" : "Fold the sliders away"}
            aria-expanded={!isFolded}
            onClick={() => setFolded((prev) => ({ ...prev, [graph.id]: !prev[graph.id] }))}
          >
            {isFolded ? <SlidersHorizontal size={13} /> : <Minus size={13} />}
          </button>
        </div>
        {!isFolded &&
          names.map((name) => {
            const p = sliderOf(params[name]);
            return (
              <div key={name} className={g.panelRow}>
                <span className={g.paramName}>{name}</span>
                <input
                  type="range"
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  value={p.value}
                  aria-label={`Slider ${name}`}
                  onChange={(e) => onParam(graph.id, name, Number(e.target.value))}
                />
                <span className={g.paramValue}>{formatValue(p.value, 3)}</span>
              </div>
            );
          })}
      </div>
    );
  });
}

export function GraphReadoutBar({ store, barRef, onPin, onTangent, onRemovePin, onClose, onPlace }) {
  const { graphs, trace } = useGraphs(store);
  if (!trace) return null;
  const graph = (graphs || []).find((x) => x.id === trace.graphId);
  if (!graph) return null;
  const v = readoutValues(graph, geomOf(graph), trace.fnId, trace.x);
  if (!v || !Number.isFinite(v.y)) return null;
  return (
    <div
      ref={(el) => {
        barRef.current = el;
        if (el) onPlace();
      }}
      className={g.readout} role="group" aria-label="Point on the curve" data-graph-readout="true">
      <span className={g.readoutText} style={{ color: v.color }} aria-live="polite">
        {v.text}
      </span>
      <button
        type="button"
        className={`${g.readoutBtn} ${trace.tangent ? g.readoutBtnOn : ""}`}
        aria-pressed={!!trace.tangent}
        onClick={onTangent}
        title="Draw the tangent here and show its gradient"
      >
        Tangent
      </button>
      {trace.pinId ? (
        <button type="button" className={g.readoutBtn} onClick={onRemovePin}>
          <Trash2 size={14} /> Unpin
        </button>
      ) : (
        <button type="button" className={`${g.readoutBtn} ${g.readoutBtnPrimary}`} onClick={onPin}>
          <Pin size={14} /> Pin
        </button>
      )}
      <button type="button" className={g.iconBtn} style={{ width: 30, height: 30 }} aria-label="Close" onClick={onClose}>
        <X size={14} />
      </button>
    </div>
  );
}
