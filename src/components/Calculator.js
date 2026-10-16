"use client";

import { useEffect, useRef, useState } from "react";
import { X, GripHorizontal, History, ChevronDown, ChevronUp, Copy, SquarePlus, Delete } from "lucide-react";
import "mathlive/static.css";
import PalmSafeButton from "./PalmSafeButton";
import {
  evaluateWithEngine, evaluateBasic, latexToText, capturePointer, loadCalcPosition, saveCalcPosition,
  copyText, loadMathEngine,
} from "@/lib/calcMath";
import { getSetting, setSetting } from "@/lib/settings";
import s from "./Calculator.module.css";

// Casio-style layout. Each key has what it types into the maths field
// (latex) and into the basic engine used on older iPads (text). "op" keys
// carry on from the last answer after "=", like a real calculator.
const SCI_KEYS = [
  { id: "2nd", label: "2nd", action: "second", aria: "Second functions" },
  { id: "sin", label: "sin", latex: "\\sin\\left(#0\\right)", text: "sin(", second: { label: "sin⁻¹", latex: "\\sin^{-1}\\left(#0\\right)", text: "asin(" } },
  { id: "cos", label: "cos", latex: "\\cos\\left(#0\\right)", text: "cos(", second: { label: "cos⁻¹", latex: "\\cos^{-1}\\left(#0\\right)", text: "acos(" } },
  { id: "tan", label: "tan", latex: "\\tan\\left(#0\\right)", text: "tan(", second: { label: "tan⁻¹", latex: "\\tan^{-1}\\left(#0\\right)", text: "atan(" } },
  { id: "pi", label: "π", latex: "\\pi", text: "π", aria: "Pi", second: { label: "e", latex: "e", text: "e", aria: "e" } },

  { id: "sqrt", label: "√", latex: "\\sqrt{#0}", text: "√(", aria: "Square root", second: { label: "∛", latex: "\\sqrt[3]{#0}", text: "∛(", aria: "Cube root" } },
  { id: "sq", label: "x²", latex: "^{2}", text: "²", op: true, aria: "Squared", second: { label: "x³", latex: "^{3}", text: "³", op: true, aria: "Cubed" } },
  { id: "pow", label: "xʸ", latex: "^{#0}", text: "^(", op: true, aria: "Power", second: { label: "ʸ√x", latex: "\\sqrt[#0]{#?}", text: "", basicOff: true, aria: "Nth root" } },
  { id: "log", label: "log", latex: "\\log\\left(#0\\right)", text: "log(", aria: "Log base 10", second: { label: "10ˣ", latex: "10^{#0}", text: "10^(", aria: "Ten to the power" } },
  { id: "ln", label: "ln", latex: "\\ln\\left(#0\\right)", text: "ln(", aria: "Natural log", second: { label: "eˣ", latex: "e^{#0}", text: "e^(", aria: "e to the power" } },

  { id: "(", label: "(", latex: "(", text: "(", aria: "Open bracket" },
  { id: ")", label: ")", latex: ")", text: ")", aria: "Close bracket" },
  { id: "frac", label: "a/b", latex: "\\frac{#0}{#?}", text: "÷", aria: "Fraction", second: { label: "x⁻¹", latex: "^{-1}", text: "⁻¹", op: true, aria: "Reciprocal" } },
  { id: "fact", label: "x!", latex: "!", text: "!", op: true, aria: "Factorial", second: { label: "nCr", latex: "\\binom{#0}{#?}", text: "", basicOff: true, aria: "Combinations" } },
  { id: "abs", label: "|x|", latex: "\\left|#0\\right|", text: "abs(", aria: "Absolute value", second: { label: "%", latex: "\\%", text: "%", op: true, aria: "Percent" } },
];

const MAIN_KEYS = [
  { id: "7", label: "7", latex: "7", text: "7" },
  { id: "8", label: "8", latex: "8", text: "8" },
  { id: "9", label: "9", latex: "9", text: "9" },
  { id: "del", label: "DEL", action: "del", aria: "Delete", style: "del" },
  { id: "ac", label: "AC", action: "ac", aria: "Clear all", style: "ac" },
  { id: "4", label: "4", latex: "4", text: "4" },
  { id: "5", label: "5", latex: "5", text: "5" },
  { id: "6", label: "6", latex: "6", text: "6" },
  { id: "times", label: "×", latex: "\\times", text: "×", op: true, aria: "Times", style: "op" },
  { id: "div", label: "÷", latex: "\\div", text: "÷", op: true, aria: "Divide", style: "op" },
  { id: "1", label: "1", latex: "1", text: "1" },
  { id: "2", label: "2", latex: "2", text: "2" },
  { id: "3", label: "3", latex: "3", text: "3" },
  { id: "plus", label: "+", latex: "+", text: "+", op: true, aria: "Plus", style: "op" },
  { id: "minus", label: "−", latex: "-", text: "−", op: true, aria: "Minus", style: "op" },
  { id: "0", label: "0", latex: "0", text: "0" },
  { id: "dot", label: ".", latex: ".", text: ".", aria: "Decimal point" },
  { id: "exp", label: "×10ˣ", latex: "\\times10^{#0}", text: "×10^(", aria: "Times ten to the power", style: "small" },
  { id: "ans", label: "Ans", action: "ans", aria: "Previous answer", style: "small" },
  { id: "eq", label: "=", action: "eq", aria: "Equals", style: "equals" },
];

const BASIC_TOKEN = /(asin\(|acos\(|atan\(|sin\(|cos\(|tan\(|log\(|ln\(|abs\(|√\(|∛\(|⁻¹|×10\^\(|10\^\(|e\^\(|\^\(|.)$/u;

export default function Calculator({ position, setPosition, onClose, onInsertToBoard }) {
  const rootRef = useRef(null);
  const mfRef = useRef(null);
  const dragRef = useRef(null);
  const toastTimer = useRef(null);
  const justEvaluated = useRef(false);
  const lastAnswer = useRef(null);
  const handlersRef = useRef(null);
  const idRef = useRef(0);

  const [status, setStatus] = useState("loading"); // loading | full | basic
  const [engine, setEngine] = useState(null);
  // starts in the teacher's setting (Settings, or the last one chosen here)
  const [angle, setAngle] = useState(() => getSetting("calcAngle"));
  const [second, setSecond] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState("keys"); // keys | history
  const [exprLatex, setExprLatex] = useState("");
  const [basicExpr, setBasicExpr] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [showAlt, setShowAlt] = useState(false);
  const [history, setHistory] = useState([]);
  const [toast, setToast] = useState("");
  const [dragging, setDragging] = useState(false);
  const [hasAnswer, setHasAnswer] = useState(false);

  const degrees = angle === "deg";

  function evaluateNow(latex, text, deg) {
    if (status === "full" && engine) return evaluateWithEngine(engine.ce, latex, deg);
    if (status === "basic") return evaluateBasic(text, deg);
    return { ok: false, kind: "empty" };
  }

  function markup(latex, inline) {
    if (!engine) return { __html: "" };
    return { __html: engine.mathlive.convertLatexToMarkup(latex, { defaultMode: inline ? "inline-math" : "math" }) };
  }

  function flash(message) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1600);
  }

  function resetAfterEdit() {
    justEvaluated.current = false;
    setResult(null);
    setError("");
    setShowAlt(false);
  }

  function answerLatex(res) {
    const l = res.primary.latex;
    return /^-?[\d.]+$/.test(l) ? l : `\\left(${l}\\right)`;
  }

  function answerText(res) {
    const t = res.primary.text;
    return /^-?[\d.]+$/.test(t) ? t : `(${t})`;
  }

  // After "=", an operator carries on from the answer; anything else
  // starts a fresh calculation.
  function startFrom(continueWithAnswer) {
    if (!justEvaluated.current) return;
    const ans = lastAnswer.current;
    if (status === "full" && mfRef.current) {
      mfRef.current.value = continueWithAnswer && ans ? answerLatex(ans) : "";
      mfRef.current.executeCommand("moveToMathfieldEnd");
    } else if (status === "basic") {
      setBasicExpr(continueWithAnswer && ans ? answerText(ans) : "");
    }
  }

  function typeLatex(latex, text, continues) {
    if (status === "full") {
      const mf = mfRef.current;
      if (!mf) return;
      startFrom(continues);
      mf.insert(latex, { format: "latex", focus: true, selectionMode: "placeholder", scrollIntoView: true });
      setExprLatex(mf.value);
    } else if (status === "basic") {
      const base = justEvaluated.current
        ? continues && lastAnswer.current
          ? answerText(lastAnswer.current)
          : ""
        : basicExpr;
      setBasicExpr(base + text);
    }
    resetAfterEdit();
  }

  function equals() {
    const latex = mfRef.current ? mfRef.current.value : "";
    const res = evaluateNow(latex, basicExpr, degrees);
    if (!res.ok) {
      if (res.kind !== "empty") setError(res.message);
      return;
    }
    const entry = {
      id: (idRef.current += 1),
      exprLatex: status === "full" ? latex : null,
      exprText: status === "full" ? latexToText(latex) : basicExpr,
      res,
    };
    lastAnswer.current = res;
    justEvaluated.current = true;
    setHasAnswer(true);
    setResult(entry);
    setError("");
    setShowAlt(false);
    setHistory((prev) => [entry, ...prev].slice(0, 30));
  }

  function deleteBack() {
    if (justEvaluated.current) {
      // Like DEL on a Casio: after "=", go back to editing the sum.
      resetAfterEdit();
      return;
    }
    if (status === "full" && mfRef.current) {
      mfRef.current.executeCommand("deleteBackward");
      setExprLatex(mfRef.current.value);
    } else if (status === "basic") {
      setBasicExpr((v) => v.replace(BASIC_TOKEN, ""));
    }
    setError("");
  }

  function clearAll() {
    if (mfRef.current) {
      mfRef.current.value = "";
      setExprLatex("");
    }
    setBasicExpr("");
    resetAfterEdit();
  }

  function insertAnswer(res) {
    if (!res) return;
    if (status === "full") typeLatex(answerLatex(res), "", false);
    else typeLatex("", answerText(res), false);
  }

  function press(key) {
    const k = second && key.second ? key.second : key;
    if (key.action === "second") {
      setSecond((v) => !v);
      return;
    }
    if (second && key.second) setSecond(false);
    if (k.action === "del") return deleteBack();
    if (k.action === "ac") return clearAll();
    if (k.action === "eq") return equals();
    if (k.action === "ans") return insertAnswer(lastAnswer.current);
    typeLatex(k.latex, k.text, !!k.op);
  }

  function chooseAngle(mode) {
    if (mode === angle) return;
    setAngle(mode);
    setSetting("calcAngle", mode);
    // Re-work the shown answer in the new unit.
    if (result) {
      const res = evaluateNow(result.exprLatex || "", result.exprText, mode === "deg");
      if (res.ok) {
        // Update the same history line rather than adding a new one.
        const entry = { ...result, res };
        lastAnswer.current = res;
        setResult(entry);
        setHistory((prev) => prev.map((h) => (h.id === entry.id ? entry : h)));
      }
    }
  }

  function shownAnswer() {
    if (!result) return null;
    return showAlt && result.res.alternate ? result.res.alternate : result.res.primary;
  }

  async function handleCopy() {
    const a = shownAnswer();
    if (!a) return;
    flash((await copyText(a.text)) ? "Answer copied" : "Couldn't copy");
  }

  function handleAddToBoard() {
    const a = shownAnswer();
    if (!a || !onInsertToBoard) return;
    onInsertToBoard(`${result.exprText} = ${a.text}`);
    flash("Added to the board");
  }

  // Cmd/Ctrl+A anywhere in the calculator selects the calculation, even
  // when one of its buttons has the focus rather than the maths box.
  function onCalcKeyDown(e) {
    if (!(e.metaKey || e.ctrlKey) || String(e.key).toLowerCase() !== "a") return;
    const mf = mfRef.current;
    if (!mf || status !== "full") {
      e.preventDefault(); // nothing to select: at least don't select the page
      return;
    }
    if (e.target === mf) return; // the maths box handles it itself
    e.preventDefault();
    mf.focus();
    mf.executeCommand("selectAll");
  }

  // ---------- dragging (anywhere on the header) ----------

  function onHeaderPointerDown(e) {
    if (e.target.closest && e.target.closest("button")) return;
    const el = rootRef.current;
    if (!el) return;
    const pane = (el.closest("[data-board-pane]") || el.parentElement).getBoundingClientRect();
    dragRef.current = {
      id: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      ox: position.x,
      oy: position.y,
      x: position.x,
      y: position.y,
      w: el.offsetWidth,
      h: el.offsetHeight,
      pw: pane.width,
      ph: pane.height,
    };
    capturePointer(e.currentTarget, e.pointerId);
    setDragging(true);
  }

  function onHeaderPointerMove(e) {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    d.x = Math.min(Math.max(8, d.ox + e.clientX - d.sx), Math.max(8, d.pw - d.w - 8));
    d.y = Math.min(Math.max(8, d.oy + e.clientY - d.sy), Math.max(8, d.ph - d.h - 8));
    // Move the element directly while dragging (smooth on old iPads);
    // React state is updated once, on release.
    rootRef.current.style.left = d.x + "px";
    rootRef.current.style.top = d.y + "px";
  }

  function onHeaderPointerUp(e) {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    let { x, y } = d;
    // Snap to an edge when dropped close to it.
    if (x < 40) x = 8;
    if (x > d.pw - d.w - 40) x = Math.max(8, d.pw - d.w - 8);
    if (y < 40) y = 8;
    const next = { x, y };
    setPosition(next);
    saveCalcPosition(next);
  }

  // Keeps the whole calculator on the board (after opening, showing the
  // keys again, or the window getting smaller).
  function keepOnScreen() {
    const el = rootRef.current;
    if (!el || dragRef.current) return;
    const pane = (el.closest("[data-board-pane]") || el.parentElement).getBoundingClientRect();
    const x = Math.min(Math.max(8, position.x), Math.max(8, pane.width - el.offsetWidth - 8));
    const y = Math.min(Math.max(8, position.y), Math.max(8, pane.height - el.offsetHeight - 8));
    if (x !== position.x || y !== position.y) setPosition({ x, y });
  }

  // ---------- effects ----------

  useEffect(() => {
    let cancelled = false;
    loadMathEngine().then((loaded) => {
      if (cancelled) return;
      if (loaded) {
        setEngine(loaded);
        setStatus("full");
      } else {
        setStatus("basic");
      }
    });
    return () => {
      cancelled = true;
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(keepOnScreen);
    window.addEventListener("resize", keepOnScreen);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", keepOnScreen);
    };
  });

  // Latest handlers for the maths field's own events.
  useEffect(() => {
    handlersRef.current = { equals, resetAfterEdit, exprLatex };
  });

  useEffect(() => {
    if (status !== "full") return undefined;
    const mf = mfRef.current;
    if (!mf) return undefined;
    // Never pop up MathLive's own keyboard or the iPad keyboard — the
    // calculator's keys are the keyboard. Typing on a real keyboard works.
    mf.mathVirtualKeyboardPolicy = "manual";
    mf.menuItems = [];
    mf.popoverPolicy = "off";
    mf.smartFence = true;
    mf.placeholder = "0";
    function onInput() {
      // MathLive also fires "input" for keys that don't change anything
      // (like Enter) — only a real edit should clear the answer.
      if (mf.value === handlersRef.current.exprLatex) return;
      setExprLatex(mf.value);
      handlersRef.current.resetAfterEdit();
    }
    function onKeyDown(ev) {
      if (ev.key === "Enter" || ev.key === "=") {
        ev.preventDefault();
        ev.stopPropagation();
        handlersRef.current.equals();
      }
    }
    mf.addEventListener("input", onInput);
    // Capture phase: runs before MathLive's own handling inside the field.
    mf.addEventListener("keydown", onKeyDown, true);
    const canHover = window.matchMedia && window.matchMedia("(hover: hover)").matches;
    if (canHover) mf.focus();
    return () => {
      mf.removeEventListener("input", onInput);
      mf.removeEventListener("keydown", onKeyDown, true);
    };
  }, [status]);

  // ---------- render ----------

  const live = !result && !error ? evaluateNow(exprLatex, basicExpr, degrees) : null;
  const shown = shownAnswer();
  const ready = status !== "loading";

  function keyClass(key) {
    const k = second && key.second ? key.second : key;
    const cls = [s.key];
    if (key.action === "second") cls.push(s.second, second ? s.secondOn : "");
    else if (SCI_KEYS.includes(key)) cls.push(s.fn, second && key.second ? s.fnSecond : "");
    if (key.style === "op") cls.push(s.op);
    if (key.style === "del") cls.push(s.del);
    if (key.style === "ac") cls.push(s.ac);
    if (key.style === "small") cls.push(s.small);
    if (key.style === "equals") cls.push(s.equals);
    if (k.label && k.label.length > 3 && !key.style) cls.push(s.small);
    return cls.filter(Boolean).join(" ");
  }

  function renderKey(key) {
    const k = second && key.second ? key.second : key;
    const off = !ready || (status === "basic" && k.basicOff) || (key.action === "ans" && !hasAnswer);
    return (
      <PalmSafeButton
        key={key.id}
        className={keyClass(key)}
        aria-label={k.aria || k.label}
        aria-pressed={key.action === "second" ? second : undefined}
        disabled={off}
        onMouseDown={(e) => e.preventDefault()}
        onPress={() => press(key)}
      >
        {key.id === "del" ? <Delete size={20} strokeWidth={2} aria-hidden="true" /> : k.label}
      </PalmSafeButton>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`${s.calc} ${dragging ? s.dragging : ""}`}
      style={{ left: position.x, top: position.y }}
      role="dialog"
      aria-label="Calculator"
      // Keyboard shortcuts typed anywhere in here are the calculator's,
      // not the board's (see isTypingTarget in Whiteboard.js).
      data-board-shortcuts="off"
      onKeyDown={onCalcKeyDown}
    >
      <div
        className={s.header}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
        title="Drag to move"
      >
        <div className={s.grip}>
          <GripHorizontal size={18} aria-hidden="true" />
          <span>Calculator</span>
        </div>
        <div className={s.segment} role="group" aria-label="Angle unit">
          <button type="button" className={`${s.segBtn} ${angle === "deg" ? s.segOn : ""}`} aria-pressed={angle === "deg"} title="Angles in degrees" onClick={() => chooseAngle("deg")}>
            DEG
          </button>
          <button type="button" className={`${s.segBtn} ${angle === "rad" ? s.segOn : ""}`} aria-pressed={angle === "rad"} title="Angles in radians" onClick={() => chooseAngle("rad")}>
            RAD
          </button>
        </div>
        <button
          type="button"
          className={`${s.iconBtn} ${view === "history" ? s.iconOn : ""}`}
          aria-label="History"
          aria-pressed={view === "history"}
          title="Earlier answers"
          onClick={() => {
            setView((v) => (v === "history" ? "keys" : "history"));
            setCollapsed(false);
          }}
        >
          <History size={18} />
        </button>
        <button
          type="button"
          className={s.iconBtn}
          aria-label={collapsed ? "Show keys" : "Hide keys"}
          title={collapsed ? "Show keys" : "Hide keys (keep the answer on screen)"}
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
        <button type="button" className={s.iconBtn} aria-label="Close calculator" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      <div className={s.display} aria-live="polite">
        <div className={s.expr}>
          {status === "full" ? (
            <math-field ref={mfRef} aria-label="Calculation"></math-field>
          ) : status === "basic" ? (
            basicExpr ? <span className={s.exprText}>{basicExpr}</span> : <span className={s.placeholderText}>0</span>
          ) : (
            <span className={s.placeholderText}>Loading…</span>
          )}
        </div>
        <div className={s.answer}>
          {shown ? (
            <>
              <span className={s.answerEq}>=</span>
              {status === "full" ? (
                <span className={s.answerBig} dangerouslySetInnerHTML={markup(shown.latex, false)} />
              ) : (
                <span className={s.answerBig}>{shown.text}</span>
              )}
            </>
          ) : error ? (
            <span className={s.errorText} role="alert">{error}</span>
          ) : live && live.ok ? (
            status === "full" ? (
              <span className={s.preview}>
                = <span dangerouslySetInnerHTML={markup(live.primary.latex, true)} />
              </span>
            ) : (
              <span className={s.preview}>= {live.primary.text}</span>
            )
          ) : null}
        </div>
        {shown && (
          <div className={s.tools}>
            {result.res.alternate && (
              <button type="button" className={s.toolBtn} onClick={() => setShowAlt((v) => !v)} title="Switch between fraction and decimal">
                S⇔D
              </button>
            )}
            <button type="button" className={s.toolBtn} onClick={handleCopy}>
              <Copy size={14} aria-hidden="true" /> Copy
            </button>
            {onInsertToBoard && (
              <button type="button" className={`${s.toolBtn} ${s.toolPrimary}`} onClick={handleAddToBoard} title="Write this answer on the board as text">
                <SquarePlus size={14} aria-hidden="true" /> Add to board
              </button>
            )}
          </div>
        )}
      </div>

      {!collapsed && view === "history" && (
        <div className={s.history}>
          <div className={s.historyHead}>
            <span>Earlier answers</span>
            {history.length > 0 && (
              <button type="button" className={s.linkBtn} onClick={() => setHistory([])}>
                Clear
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <div className={s.historyEmpty}>Your calculations will appear here. Tap one to use its answer again.</div>
          ) : (
            <div className={s.historyList}>
              {history.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className={s.historyItem}
                  title="Use this answer"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    insertAnswer(h.res);
                    setView("keys");
                  }}
                >
                  <span className={s.historyExpr}>{h.exprText}</span>
                  <span className={s.historyAns}>= {h.res.primary.text}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!collapsed && view === "keys" && (
        <div className={s.pad}>
          <div className={s.grid}>{SCI_KEYS.map(renderKey)}</div>
          <div className={s.grid}>{MAIN_KEYS.map(renderKey)}</div>
        </div>
      )}

      {toast && <div className={s.toast} role="status">{toast}</div>}
    </div>
  );
}
