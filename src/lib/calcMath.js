// Maths helpers for the calculator: number formatting, fractions, turning
// results into plain text for the board, and a small built-in evaluator
// used when the full maths engine can't load (older iPads).

// ---------- numbers ----------

// Decimal → simplified fraction by continued fractions (what a
// calculator's S⇔D / a/b key does).
export function decimalToFraction(value, maxDenominator = 10000) {
  if (!Number.isFinite(value)) return null;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const whole = Math.floor(abs);
  const frac = abs - whole;
  if (frac < 1e-12) return { numerator: sign * whole, denominator: 1 };
  let h1 = 1, h2 = 0, k1 = 0, k2 = 1;
  let b = frac;
  for (let i = 0; i < 30; i++) {
    const a = Math.floor(b);
    const h = a * h1 + h2;
    const k = a * k1 + k2;
    if (k > maxDenominator) break;
    h2 = h1; h1 = h; k2 = k1; k1 = k;
    const rem = b - a;
    if (rem < 1e-12) break;
    b = 1 / rem;
  }
  const numerator = sign * (whole * k1 + h1);
  // Only call it a fraction if it really is one (not an approximation).
  if (Math.abs(numerator / k1 - value) > 1e-10 * Math.max(1, Math.abs(value))) return null;
  return { numerator, denominator: k1 };
}

// Rounds away floating-point noise (0.1 + 0.2, sin 30° …) and chooses
// between normal and ×10ⁿ notation. Returns { text, latex }.
export function formatNumber(x) {
  if (!Number.isFinite(x)) return null;
  if (Math.abs(x) < 1e-13) return { text: "0", latex: "0" };
  const abs = Math.abs(x);
  if (abs >= 1e12 || abs < 1e-6) {
    const exp = Math.floor(Math.log10(abs));
    let mant = x / Math.pow(10, exp);
    mant = Number(mant.toPrecision(10));
    const m = String(mant);
    return { text: `${m}×10^${exp}`, latex: `${m}\\times10^{${exp}}` };
  }
  const s = String(Number(x.toPrecision(12)));
  return { text: s, latex: s };
}

export function fractionLatex(f) {
  if (!f || f.denominator === 1) return null;
  const neg = f.numerator < 0;
  return `${neg ? "-" : ""}\\frac{${Math.abs(f.numerator)}}{${f.denominator}}`;
}

// ---------- LaTeX → readable plain text (for "Add to board") ----------

const SUPERSCRIPT = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "-": "⁻" };

function readGroup(s, i) {
  // Returns [content, indexAfter] for "{...}" — or for a single-token
  // argument, which MathLive writes without braces (\sqrt8, \frac12).
  while (s[i] === " ") i++;
  if (s[i] !== "{") {
    if (s[i] === "\\") {
      const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i));
      const len = m ? m[0].length : 1;
      return [s.slice(i, i + len), i + len];
    }
    return [s.slice(i, i + 1), i + 1];
  }
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "{") depth++;
    else if (s[j] === "}") {
      depth--;
      if (depth === 0) return [s.slice(i + 1, j), j + 1];
    }
  }
  return [s.slice(i + 1), s.length];
}

function wrapIfNeeded(t) {
  return /^[\w.π√∛]+$/.test(t) ? t : `(${t})`;
}

export function latexToText(latex) {
  let s = String(latex || "");
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s.startsWith("\\frac", i) || s.startsWith("\\dfrac", i)) {
      i += s.startsWith("\\dfrac", i) ? 6 : 5;
      const [a, i2] = readGroup(s, i);
      const [b, i3] = readGroup(s, i2);
      out += `${wrapIfNeeded(latexToText(a))}/${wrapIfNeeded(latexToText(b))}`;
      i = i3;
      continue;
    }
    if (s.startsWith("\\sqrt", i)) {
      i += 5;
      let root = "";
      if (s[i] === "[") {
        const end = s.indexOf("]", i);
        root = s.slice(i + 1, end);
        i = end + 1;
      }
      const [a, i2] = readGroup(s, i);
      const inner = wrapIfNeeded(latexToText(a));
      out += root === "3" ? `∛${inner}` : root ? `${root}√${inner}` : `√${inner}`;
      i = i2;
      continue;
    }
    if (s.startsWith("\\binom", i)) {
      i += 6;
      const [a, i2] = readGroup(s, i);
      const [b, i3] = readGroup(s, i2);
      out += `C(${latexToText(a)}, ${latexToText(b)})`;
      i = i3;
      continue;
    }
    if (s[i] === "^") {
      i++;
      let sup;
      if (s[i] === "{") {
        const [a, i2] = readGroup(s, i);
        sup = latexToText(a);
        i = i2;
      } else {
        sup = s[i];
        i++;
      }
      out += /^-?\d+$/.test(sup) ? sup.split("").map((c) => SUPERSCRIPT[c]).join("") : `^(${sup})`;
      continue;
    }
    if (s[i] === "_") {
      i++;
      let sub;
      if (s[i] === "{") {
        const [a, i2] = readGroup(s, i);
        sub = latexToText(a);
        i = i2;
      } else {
        sub = s[i];
        i++;
      }
      out += `_${sub}`;
      continue;
    }
    if (s[i] === "{" || s[i] === "}") {
      i++;
      continue;
    }
    if (s[i] === "\\") {
      const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i));
      const cmd = m ? m[1] : "";
      i += 1 + cmd.length;
      const map = {
        times: "×", div: "÷", cdot: "·", pi: "π", exponentialE: "e", imaginaryI: "i", infty: "∞",
        left: "", right: "", ",": "", ";": " ", "!": "", " ": " ", "%": "%", degree: "°", circ: "°",
        sin: "sin", cos: "cos", tan: "tan", ln: "ln", log: "log", arcsin: "sin⁻¹", arccos: "cos⁻¹", arctan: "tan⁻¹",
        operatorname: "", mathrm: "", text: "", pm: "±", le: "≤", ge: "≥", ne: "≠", approx: "≈", lbrace: "{", rbrace: "}",
      };
      out += cmd in map ? map[cmd] : cmd;
      continue;
    }
    out += s[i] === "*" ? "×" : s[i];
    i++;
  }
  return out.replace(/\s+/g, " ").trim();
}

// ---------- built-in evaluator (fallback when the engine can't load) ----------

const FUNCS = {
  sin: (x, deg) => Math.sin(deg ? (x * Math.PI) / 180 : x),
  cos: (x, deg) => Math.cos(deg ? (x * Math.PI) / 180 : x),
  tan: (x, deg) => {
    const r = deg ? (x * Math.PI) / 180 : x;
    if (deg && Math.abs(((x % 180) + 180) % 180 - 90) < 1e-12) return Infinity;
    return Math.tan(r);
  },
  asin: (x, deg) => (deg ? (Math.asin(x) * 180) / Math.PI : Math.asin(x)),
  acos: (x, deg) => (deg ? (Math.acos(x) * 180) / Math.PI : Math.acos(x)),
  atan: (x, deg) => (deg ? (Math.atan(x) * 180) / Math.PI : Math.atan(x)),
  log: (x) => Math.log10(x),
  ln: (x) => Math.log(x),
  abs: (x) => Math.abs(x),
  "√": (x) => Math.sqrt(x),
  "∛": (x) => Math.cbrt(x),
};

function factorial(n) {
  if (n < 0 || !Number.isInteger(n)) return NaN;
  if (n > 170) return Infinity;
  let r = 1;
  for (let k = 2; k <= n; k++) r *= k;
  return r;
}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " ") { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      tokens.push({ t: "num", v: src.slice(i, j) });
      i = j;
      continue;
    }
    const word = /^(asin|acos|atan|sin|cos|tan|log|ln|abs)/.exec(src.slice(i));
    if (word) { tokens.push({ t: "fn", v: word[1] }); i += word[1].length; continue; }
    if (c === "√" || c === "∛") { tokens.push({ t: "fn", v: c }); i++; continue; }
    if (c === "π") { tokens.push({ t: "num", v: String(Math.PI) }); i++; continue; }
    if (c === "e") { tokens.push({ t: "num", v: String(Math.E) }); i++; continue; }
    if (src.startsWith("⁻¹", i)) { tokens.push({ t: "post", v: "inv" }); i += 2; continue; }
    if (c === "²" || c === "³" || c === "!" || c === "%") { tokens.push({ t: "post", v: c }); i++; continue; }
    if ("+−-×÷*/^()".includes(c)) { tokens.push({ t: "op", v: c === "-" ? "−" : c === "*" ? "×" : c === "/" ? "÷" : c }); i++; continue; }
    throw new Error("bad");
  }
  return tokens;
}

// Evaluates a typed expression like "2×sin(30)+√(9)". Missing closing
// brackets at the end are allowed, like on a real calculator.
export function evaluatePlain(src, degrees) {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const startsPrimary = (tk) => tk && (tk.t === "num" || tk.t === "fn" || (tk.t === "op" && tk.v === "("));

  function expr() {
    let v = term();
    while (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "−")) {
      const op = next().v;
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function term() {
    let v = unary();
    for (;;) {
      const tk = peek();
      if (tk && tk.t === "op" && (tk.v === "×" || tk.v === "÷")) {
        next();
        const r = unary();
        v = tk.v === "×" ? v * r : v / r;
      } else if (startsPrimary(tk)) {
        v *= unary(); // implicit multiplication: 2π, 3(4), 2sin(30)
      } else break;
    }
    return v;
  }
  function unary() {
    const tk = peek();
    if (tk && tk.t === "op" && (tk.v === "−" || tk.v === "+")) {
      next();
      const v = unary();
      return tk.v === "−" ? -v : v;
    }
    return power();
  }
  function power() {
    const base = postfix();
    if (peek() && peek().t === "op" && peek().v === "^") {
      next();
      return Math.pow(base, unary());
    }
    return base;
  }
  function postfix() {
    let v = primary();
    while (peek() && peek().t === "post") {
      const p = next().v;
      if (p === "²") v = v * v;
      else if (p === "³") v = v * v * v;
      else if (p === "!") v = factorial(v);
      else if (p === "%") v = v / 100;
      else if (p === "inv") v = 1 / v;
    }
    return v;
  }
  function group() {
    // after "(" — closing bracket optional at the very end
    const v = expr();
    if (peek() && peek().t === "op" && peek().v === ")") next();
    else if (peek()) throw new Error("bracket");
    return v;
  }
  function primary() {
    const tk = next();
    if (!tk) throw new Error("incomplete");
    if (tk.t === "num") {
      if ((tk.v.match(/\./g) || []).length > 1) throw new Error("bad number");
      return Number(tk.v);
    }
    if (tk.t === "op" && tk.v === "(") return group();
    if (tk.t === "fn") {
      let arg;
      if (peek() && peek().t === "op" && peek().v === "(") {
        next();
        arg = group();
      } else {
        arg = postfix();
      }
      return FUNCS[tk.v](arg, degrees);
    }
    throw new Error("unexpected");
  }

  const value = expr();
  if (pos < tokens.length) throw new Error("trailing");
  return value;
}

// ---------- evaluation (shared shape for both engines) ----------
// Returns { ok: true, value, primary: {latex, text}, alternate: {latex, text} | null }
// or { ok: false, kind: "empty" | "incomplete" | "error", message }.

function fractionForm(value) {
  const f = decimalToFraction(value);
  if (!f || f.denominator === 1 || f.denominator > 1000) return null;
  return { latex: fractionLatex(f), text: `${f.numerator}/${f.denominator}` };
}

function problem(value, im) {
  if (Number.isNaN(value)) return { ok: false, kind: "error", message: "Can't work that out" };
  if (!Number.isFinite(value)) return { ok: false, kind: "error", message: "Undefined (dividing by zero?)" };
  if (im && Math.abs(im) > 1e-12) return { ok: false, kind: "error", message: "No real answer" };
  return null;
}

export function evaluateWithEngine(ce, latex, degrees) {
  if (!latex || !latex.trim()) return { ok: false, kind: "empty" };
  try {
    ce.angularUnit = degrees ? "deg" : "rad";
    const boxed = ce.parse(latex);
    if (!boxed.isValid) return { ok: false, kind: "incomplete", message: "Finish the calculation first" };
    const n = boxed.N();
    const value = typeof n.re === "number" ? n.re : Number(n.value);
    const bad = problem(value, typeof n.im === "number" ? n.im : 0);
    if (bad) return bad;
    const dec = formatNumber(value);
    let exact = null;
    try {
      const l = boxed.evaluate().latex;
      // Only show a "natural" answer when it's a finished value (½, 2√2,
      // π/4 …), not an unsolved expression like cos(π).
      if (
        l && l.length < 90 &&
        /\\frac|\\sqrt|\\pi|\\exponentialE/.test(l) &&
        !/\\error|\\tilde|\\imaginaryI|\\operatorname|\\mathrm|\\sin|\\cos|\\tan|\\arc|\\log|\\ln|\\exp|\\lb|\\lg/.test(l)
      ) {
        exact = { latex: l, text: latexToText(l) };
      }
    } catch (err) {
      exact = null;
    }
    if (exact) return { ok: true, value, primary: exact, alternate: dec };
    return { ok: true, value, primary: dec, alternate: fractionForm(value) };
  } catch (err) {
    return { ok: false, kind: "error", message: "Can't work that out" };
  }
}

export function evaluateBasic(src, degrees) {
  if (!src || !src.trim()) return { ok: false, kind: "empty" };
  let value;
  try {
    value = evaluatePlain(src, degrees);
  } catch (err) {
    return { ok: false, kind: "incomplete", message: "Finish the calculation first" };
  }
  const bad = problem(value, 0);
  if (bad) return bad;
  return { ok: true, value, primary: formatNumber(value), alternate: fractionForm(value) };
}

// ---------- small browser helpers ----------

export function capturePointer(el, id) {
  try {
    el.setPointerCapture(id);
  } catch (err) {
    // synthetic pointers can't be captured; dragging still works over the handle
  }
}

const POS_KEY = "cleanslate_calc_pos";
const ANGLE_KEY = "cleanslate_calc_angle";

export function loadCalcPosition() {
  try {
    const p = JSON.parse(window.localStorage.getItem(POS_KEY) || "null");
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  } catch (err) {
    return null;
  }
}

export function saveCalcPosition(p) {
  try {
    window.localStorage.setItem(POS_KEY, JSON.stringify({ x: Math.round(p.x), y: Math.round(p.y) }));
  } catch (err) {
    // storage blocked — position just isn't remembered
  }
}

export function loadAngleMode() {
  try {
    return window.localStorage.getItem(ANGLE_KEY) === "rad" ? "rad" : "deg";
  } catch (err) {
    return "deg";
  }
}

export function saveAngleMode(mode) {
  try {
    window.localStorage.setItem(ANGLE_KEY, mode);
  } catch (err) {
    // ignore
  }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    return false;
  }
}

// Loads the maths libraries. Resolves to { mathlive, ce } or null when
// this browser can't run them (e.g. iPadOS 15), so the calculator can
// switch to its built-in basic engine instead.
export async function loadMathEngine() {
  try {
    const mathlive = await import("mathlive");
    mathlive.MathfieldElement.fontsDirectory = "https://unpkg.com/mathlive@0.110.0/fonts";
    const { ComputeEngine } = await import("@cortex-js/compute-engine");
    return { mathlive, ce: new ComputeEngine() };
  } catch (err) {
    console.warn("Calculator: using the basic engine —", err && err.message);
    return null;
  }
}
