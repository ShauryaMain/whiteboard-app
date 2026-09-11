"use client";

import { useEffect, useRef, useState } from "react";
import { X, Delete } from "lucide-react";

const CALC_WIDTH = 300;

// Converts a decimal to a simplified fraction using continued fractions —
// the standard technique behind every calculator's decimal<->fraction
// button. Doesn't depend on any library internals, so it's robust
// regardless of how the Compute Engine happens to represent a value
// internally.
function decimalToFraction(value, maxDenominator = 100000) {
  if (!isFinite(value)) return null;
  const sign = value < 0 ? -1 : 1;
  const absValue = Math.abs(value);
  const wholePart = Math.floor(absValue);
  const fractional = absValue - wholePart;

  if (fractional < 1e-12) {
    return { numerator: sign * wholePart, denominator: 1 };
  }

  let h1 = 1, h2 = 0, k1 = 0, k2 = 1;
  let b = fractional;
  for (let i = 0; i < 30; i++) {
    const a = Math.floor(b);
    const h = a * h1 + h2;
    const k = a * k1 + k2;
    if (k > maxDenominator) break;
    h2 = h1;
    h1 = h;
    k2 = k1;
    k1 = k;
    const remainder = b - a;
    if (remainder < 1e-12) break;
    b = 1 / remainder;
  }

  return { numerator: sign * (wholePart * k1 + h1), denominator: k1 };
}

export default function Calculator({ position, setPosition, onClose }) {
  const dragState = useRef(null);
  const mathFieldRef = useRef(null);
  const ceRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [resultText, setResultText] = useState("");
  const [resultValue, setResultValue] = useState(null);
  const [showFraction, setShowFraction] = useState(false);
  const [degMode, setDegMode] = useState(true);
  const degModeRef = useRef(true);

  useEffect(() => {
    degModeRef.current = degMode;
  }, [degMode]);

  // Both libraries only load once the calculator is actually opened —
  // neither is needed by anyone who never touches this feature.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const mathliveModule = await import("mathlive");
      // By default MathLive looks for its font files relative to wherever
      // its own JS chunk ended up after bundling — which doesn't match
      // where Next.js actually serves it from, hence "fonts could not be
      // loaded". Pointing this at a CDN copy (a fully supported option,
      // per MathLive's own docs) sidesteps needing any build-config
      // changes, matching how we handled the same situation for pdf.js's
      // worker earlier. Version pinned to match what actually installed.
      // Checked the actual current file listing on unpkg rather than
      // trust the (apparently outdated) docs — recent MathLive versions
      // moved the fonts folder to the package root, not nested under
      // dist/ like older versions and the docs text still describe.
      mathliveModule.MathfieldElement.fontsDirectory = "https://unpkg.com/mathlive@0.110.0/fonts";
      const { ComputeEngine } = await import("@cortex-js/compute-engine");
      if (cancelled) return;
      ceRef.current = new ComputeEngine();
      setReady(true);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const mf = mathFieldRef.current;
    if (!mf) return;

    function handleInput() {
      evaluateExpression();
    }
    mf.addEventListener("input", handleInput);
    mf.focus();
    return () => mf.removeEventListener("input", handleInput);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  function evaluateExpression() {
    const mf = mathFieldRef.current;
    const ce = ceRef.current;
    if (!mf || !ce) return;
    const latex = mf.value;
    if (!latex || !latex.trim()) {
      setResultText("");
      setResultValue(null);
      setShowFraction(false);
      return;
    }
    try {
      ce.angularUnit = degModeRef.current ? "deg" : "rad";
      const boxed = ce.parse(latex);
      const numeric = boxed.N();
      const val = numeric.value;
      if (val === undefined || val === null) {
        setResultText("");
        setResultValue(null);
      } else {
        // Rather than require val to already be typeof "number" (the
        // Compute Engine apparently hands back something else for most
        // results, even simple ones — that's what was silently starving
        // the a/b button of a usable value), actively coerce it. This
        // works whether val is already a number, a numeric string, or an
        // object with a sensible numeric conversion.
        const asNumber = Number(val);
        if (Number.isFinite(asNumber)) {
          const rounded = Math.round(asNumber * 1e10) / 1e10;
          setResultText(String(rounded));
          setResultValue(rounded);
        } else {
          // Genuinely not convertible to a plain number (e.g. a complex
          // or symbolic result) — still show it as text, just can't
          // drive the fraction button from it.
          setResultText(String(val));
          setResultValue(null);
        }
      }
      setShowFraction(false);
    } catch (err) {
      setResultText("");
      setResultValue(null);
      setShowFraction(false);
    }
  }

  useEffect(() => {
    if (ready) evaluateExpression();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [degMode]);

  function insertLatex(snippet) {
    const mf = mathFieldRef.current;
    if (!mf) return;
    mf.insert(snippet);
    mf.focus();
    evaluateExpression();
  }

  function handleEquals() {
    const mf = mathFieldRef.current;
    if (!mf || !resultText) return;
    mf.value = resultText;
    evaluateExpression();
  }

  function handleClear() {
    const mf = mathFieldRef.current;
    if (!mf) return;
    mf.value = "";
    setResultText("");
    mf.focus();
  }

  function handleBackspace() {
    const mf = mathFieldRef.current;
    if (!mf) return;
    mf.executeCommand("deleteBackward");
    mf.focus();
    evaluateExpression();
  }

  function handleHeaderPointerDown(e) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origin: { ...position },
    };
  }

  function handleHeaderPointerMove(e) {
    const drag = dragState.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    setPosition({ x: drag.origin.x + dx, y: drag.origin.y + dy });
  }

  function handleHeaderPointerUp(e) {
    const drag = dragState.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    dragState.current = null;
  }

  const funcButtons = [
    { label: "sin", latex: "\\sin(#0)" },
    { label: "cos", latex: "\\cos(#0)" },
    { label: "tan", latex: "\\tan(#0)" },
    { label: "√", latex: "\\sqrt{#0}" },
    { label: "log", latex: "\\log(#0)" },
    { label: "ln", latex: "\\ln(#0)" },
    { label: "x²", latex: "^2" },
    { label: "x^y", latex: "^{#0}" },
    { label: "π", latex: "\\pi" },
    { label: "e", latex: "e" },
    { label: "1/x", latex: "\\frac{1}{#0}" },
    { label: "x!", latex: "!" },
    { label: "|x|", latex: "\\left|#0\\right|" },
    { label: "%", latex: "\\%" },
  ];

  const numPad = [
    ["7", "8", "9", "÷"],
    ["4", "5", "6", "×"],
    ["1", "2", "3", "−"],
    ["0", ".", "±", "+"],
  ];

  function numPadInsert(label) {
    const map = { "÷": "\\div", "×": "\\times", "−": "-", "+": "+", "±": "\\pm" };
    insertLatex(map[label] || label);
  }

  return (
    <div
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        width: CALC_WIDTH,
        background: "#f2f3f5",
        borderRadius: 16,
        boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
        overflow: "hidden",
        zIndex: 25,
        WebkitUserSelect: "none",
        userSelect: "none",
      }}
    >
      <div
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
        onPointerCancel={handleHeaderPointerUp}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px",
          background: "#1a1a1a",
          color: "#fff",
          cursor: "grab",
          touchAction: "none",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>Calculator</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => setDegMode((d) => !d)}
            style={{
              border: "1px solid rgba(255,255,255,0.4)",
              background: "transparent",
              color: "#fff",
              borderRadius: 6,
              fontSize: 11,
              padding: "3px 7px",
              cursor: "pointer",
            }}
          >
            {degMode ? "DEG" : "RAD"}
          </button>
          <button
            onClick={onClose}
            style={{ border: "none", background: "transparent", color: "#fff", cursor: "pointer", display: "flex" }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div style={{ padding: 12, background: "#fff" }}>
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 8,
            padding: "8px 10px",
            minHeight: 40,
            display: "flex",
            alignItems: "center",
          }}
        >
          {ready ? (
            <math-field
              ref={mathFieldRef}
              style={{ width: "100%", border: "none", fontSize: 18 }}
              virtual-keyboard-mode="off"
            ></math-field>
          ) : (
            <span style={{ color: "#999", fontSize: 13 }}>Loading…</span>
          )}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            color: "#1E88E5",
            minHeight: 34,
            padding: "4px 4px",
            overflow: "hidden",
          }}
        >
          {showFraction && resultValue !== null ? (
            (() => {
              const frac = decimalToFraction(resultValue);
              if (!frac || frac.denominator === 1) {
                return <span style={{ fontSize: 20, fontWeight: 600 }}>{resultText}</span>;
              }
              return (
                <FractionDisplay numerator={frac.numerator} denominator={frac.denominator} />
              );
            })()
          ) : (
            <span
              style={{
                fontSize: 20,
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {resultText}
            </span>
          )}
        </div>
      </div>

      <div style={{ padding: "0 10px 10px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        {funcButtons.map((b) => (
          <CalcBtn key={b.label} onClick={() => insertLatex(b.latex)} small>
            {b.label}
          </CalcBtn>
        ))}
        <CalcBtn
          onClick={() => setShowFraction((s) => !s)}
          small
          accent={showFraction ? "op" : undefined}
        >
          a/b
        </CalcBtn>
      </div>

      <div style={{ padding: "0 10px 14px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        <CalcBtn onClick={handleClear} accent="clear">
          AC
        </CalcBtn>
        <CalcBtn onClick={handleBackspace} accent="clear">
          <Delete size={16} />
        </CalcBtn>
        <CalcBtn onClick={() => insertLatex("(")}>(</CalcBtn>
        <CalcBtn onClick={() => insertLatex(")")}>)</CalcBtn>

        {numPad.map((row, ri) =>
          row.map((label, ci) => (
            <CalcBtn
              key={`${ri}-${ci}`}
              onClick={() => numPadInsert(label)}
              accent={["÷", "×", "−", "+"].includes(label) ? "op" : "num"}
            >
              {label}
            </CalcBtn>
          ))
        )}

        <CalcBtn onClick={handleEquals} accent="equals" wide>
          =
        </CalcBtn>
      </div>
    </div>
  );
}

function FractionDisplay({ numerator, denominator }) {
  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        fontSize: 16,
        fontWeight: 600,
        lineHeight: 1.15,
      }}
    >
      <span>{numerator}</span>
      <span style={{ borderTop: "1.5px solid currentColor", width: "100%", minWidth: 22 }} />
      <span>{denominator}</span>
    </span>
  );
}

function CalcBtn({ children, onClick, small, accent, wide }) {
  let bg = "#fff";
  let color = "#1a1a1a";
  if (accent === "op") {
    bg = "#eef3fc";
    color = "#1E88E5";
  }
  if (accent === "equals") {
    bg = "#1E88E5";
    color = "#fff";
  }
  if (accent === "clear") {
    bg = "#fdecea";
    color = "#c62828";
  }

  return (
    <button
      onClick={onClick}
      style={{
        gridColumn: wide ? "span 4" : undefined,
        border: "none",
        borderRadius: 8,
        background: bg,
        color,
        padding: small ? "8px 4px" : "12px 4px",
        fontSize: small ? 12 : 15,
        fontWeight: 500,
        cursor: "pointer",
        minHeight: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        touchAction: "manipulation",
        boxShadow: accent === "equals" ? "none" : "0 1px 2px rgba(0,0,0,0.08)",
      }}
    >
      {children}
    </button>
  );
}