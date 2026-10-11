// The maths behind plotting on the board's graph: reading an equation the
// teacher typed (from the maths keyboard, so LaTeX like "y=x^{2}-3", or
// plain text like "y = x^2 - 3"), turning it into a function that can be
// worked out thousands of times a second, and finding the things a maths
// teacher points at on a graph: roots, turning points, intercepts,
// intersections, asymptotes, gradients and areas.
//
// Everything here is plain JavaScript with no library, so it works the
// same on an old iPad, on a student's page watching the teacher's board,
// and in the tests.

// ---------- reading what was typed ----------

const FUNCTION_NAMES = [
  "arcsin", "arccos", "arctan", "arcsec", "arccsc", "arccot", "asin", "acos", "atan",
  "sinh", "cosh", "tanh", "sin", "cos", "tan", "sec", "csc", "cosec", "cot",
  "ln", "log", "exp", "sqrt", "abs",
];
const CONSTANT_WORDS = { pi: "π", theta: "θ" };
const PLAIN_WORDS = [...FUNCTION_NAMES, ...Object.keys(CONSTANT_WORDS)].sort((a, b) => b.length - a.length);

// Letters that mean something fixed (everything else that is a single
// letter is either the variable, x, or a number to be set with a slider).
export const CONSTANTS = { π: Math.PI, e: Math.E };

function normalise(input) {
  let s = String(input == null ? "" : input);
  s = s
    .replace(/\\placeholder(\[[^\]]*\])?\{[^}]*\}/g, "\u0000") // an empty box MathLive leaves for "fill this in"
    .replace(/\\(left|right|middle|big|Big|bigg|Bigg)(?![a-zA-Z])/g, "")
    .replace(/\\(displaystyle|textstyle|limits)(?![a-zA-Z])/g, "")
    .replace(/\\[,;:! ]/g, " ")
    .replace(/~/g, " ")
    .replace(/\\[dt]frac/g, "\\frac")
    // LaTeX shorthand: \frac12 is ½ and \sqrt2 is √2 (one digit each)
    .replace(/\\frac\s*(\d)\s*(\d)/g, "\\frac{$1}{$2}")
    .replace(/\\frac\s*(\d)/g, "\\frac{$1}")
    .replace(/\\sqrt\s*(\d)/g, "\\sqrt{$1}")
    .replace(/\\(operatorname|mathrm|text|mathit|textrm)\{([a-zA-Z]+)\}/g, (m, cmd, word) => (word === "e" ? "e" : `\\${word}`))
    .replace(/\\(cdot|times|ast)(?![a-zA-Z])/g, "*")
    .replace(/\\div(?![a-zA-Z])/g, "/")
    .replace(/\\(leqslant|leq|le)(?![a-zA-Z])/g, "≤")
    .replace(/\\(geqslant|geq|ge)(?![a-zA-Z])/g, "≥")
    .replace(/\\lt(?![a-zA-Z])/g, "<")
    .replace(/\\gt(?![a-zA-Z])/g, ">")
    .replace(/\\exponentialE(?![a-zA-Z])/g, "e")
    .replace(/\\(vert|lvert|rvert|mid)(?![a-zA-Z])/g, "|")
    .replace(/\\pi(?![a-zA-Z])/g, "π")
    .replace(/\\(theta|vartheta)(?![a-zA-Z])/g, "θ")
    .replace(/\\cosec(?![a-zA-Z])/g, "\\csc")
    .replace(/<=|=</g, "≤")
    .replace(/>=|=>/g, "≥")
    .replace(/\*\*/g, "^")
    .replace(/[−–]/g, "-")
    .replace(/[×·∙]/g, "*")
    .replace(/÷/g, "/")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/√/g, "\\sqrt")
    .replace(/\{,\}/g, ".");
  return s;
}

function tokenize(src) {
  const s = normalise(src);
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\n") { i++; continue; }
    if (c === "\u0000") throw new GraphError("incomplete");
    const num = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (num) {
      tokens.push({ t: "num", v: Number(num[1]) });
      i += num[1].length;
      continue;
    }
    if (c === "\\") {
      const m = /^\\([a-zA-Z]+)/.exec(s.slice(i));
      if (!m) {
        // \{ \} \| and friends
        const nextChar = s[i + 1];
        if (nextChar === "{" || nextChar === "}") { tokens.push({ t: "op", v: nextChar === "{" ? "(" : ")" }); i += 2; continue; }
        if (nextChar === "|") { tokens.push({ t: "op", v: "|" }); i += 2; continue; }
        throw new GraphError("unknown");
      }
      const name = m[1];
      i += m[0].length;
      if (name === "frac" || name === "sqrt") tokens.push({ t: "cmd", v: name });
      else if (FUNCTION_NAMES.includes(name)) tokens.push({ t: "fn", v: name });
      else if (name in CONSTANT_WORDS) tokens.push({ t: "var", v: CONSTANT_WORDS[name] });
      else throw new GraphError("unknown", name);
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      const rest = s.slice(i);
      const word = PLAIN_WORDS.find((w) => rest.startsWith(w));
      if (word) {
        if (word in CONSTANT_WORDS) tokens.push({ t: "var", v: CONSTANT_WORDS[word] });
        else if (word === "sqrt") tokens.push({ t: "cmd", v: "sqrt" });
        else tokens.push({ t: "fn", v: word });
        i += word.length;
        continue;
      }
      tokens.push({ t: "var", v: c });
      i++;
      continue;
    }
    if (c === "π" || c === "θ") { tokens.push({ t: "var", v: c }); i++; continue; }
    if ("+-*/^()[]{}|=<>≤≥_!,".includes(c)) {
      tokens.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new GraphError("unknown", c);
  }
  return tokens;
}

export class GraphError extends Error {
  constructor(kind, detail) {
    super(kind);
    this.kind = kind;
    this.detail = detail;
  }
}

// The tree a typed expression is read into:
//   { t: "num", v } | { t: "var", n } | { t: "neg", a } |
//   { t: "bin", op: "+-*/^", a, b } | { t: "fn", f, a, base?, power? } |
//   { t: "root", n, a } | { t: "abs", a }
function parse(src) {
  const tokens = tokenize(src);
  let pos = 0;
  let absDepth = 0;
  const peek = (k = 0) => tokens[pos + k];
  const isOp = (tk, v) => tk && tk.t === "op" && tk.v === v;
  const next = () => {
    const tk = tokens[pos++];
    if (!tk) throw new GraphError("incomplete");
    return tk;
  };
  const expectClose = (open) => {
    const close = open === "(" ? ")" : open === "[" ? "]" : "}";
    const tk = peek();
    if (!tk) return; // a bracket left open at the very end is forgiven
    if (tk.t === "op" && (tk.v === close || (close === ")" && tk.v === "]") || (close === "]" && tk.v === ")"))) {
      pos++;
      return;
    }
    throw new GraphError("bracket");
  };

  const startsFactor = (tk) => {
    if (!tk) return false;
    if (tk.t === "num" || tk.t === "var" || tk.t === "fn" || tk.t === "cmd") return true;
    if (tk.t === "op" && (tk.v === "(" || tk.v === "[" || tk.v === "{")) return true;
    if (tk.t === "op" && tk.v === "|" && absDepth === 0) return true;
    return false;
  };

  function relation() {
    const left = sum();
    const tk = peek();
    if (tk && tk.t === "op" && "=<>≤≥".includes(tk.v)) {
      pos++;
      const right = sum();
      const again = peek();
      if (again && again.t === "op" && "=<>≤≥".includes(again.v)) throw new GraphError("chain");
      return { rel: tk.v, left, right };
    }
    return { rel: null, left };
  }

  function sum() {
    let v = term();
    for (;;) {
      const tk = peek();
      if (isOp(tk, "+") || isOp(tk, "-")) {
        pos++;
        const r = term();
        v = { t: "bin", op: tk.v, a: v, b: r };
      } else break;
    }
    return v;
  }

  function term() {
    let v = unary();
    for (;;) {
      const tk = peek();
      if (isOp(tk, "*") || isOp(tk, "/")) {
        pos++;
        const r = unary();
        v = { t: "bin", op: tk.v, a: v, b: r };
      } else if (startsFactor(tk)) {
        v = { t: "bin", op: "*", a: v, b: power() };
      } else break;
    }
    return v;
  }

  function unary() {
    const tk = peek();
    if (isOp(tk, "-")) {
      pos++;
      return { t: "neg", a: unary() };
    }
    if (isOp(tk, "+")) {
      pos++;
      return unary();
    }
    return power();
  }

  // What follows "^": a braced group, or a single (possibly negative) item.
  function exponent() {
    const tk = peek();
    if (isOp(tk, "{") || isOp(tk, "(")) {
      pos++;
      const v = sum();
      expectClose(tk.v);
      return v;
    }
    if (isOp(tk, "-")) {
      pos++;
      return { t: "neg", a: exponent() };
    }
    return postfix();
  }

  function power() {
    const base = postfix();
    if (isOp(peek(), "^")) {
      pos++;
      const exps = [exponent()];
      while (isOp(peek(), "^")) {
        pos++;
        exps.push(exponent());
      }
      // right to left: a^b^c = a^(b^c)
      let e = exps.pop();
      while (exps.length) e = { t: "bin", op: "^", a: exps.pop(), b: e };
      return { t: "bin", op: "^", a: base, b: e };
    }
    return base;
  }

  function postfix() {
    const v = primary();
    if (isOp(peek(), "!")) throw new GraphError("unsupported", "!");
    return v;
  }

  // The argument of sin, ln… written without brackets: "\sin 2x" is
  // sin(2x), but "\sin x\cos x" is sin(x)·cos(x).
  function bareArgument() {
    let v = power();
    while (startsFactor(peek()) && peek().t !== "fn" && peek().t !== "cmd") {
      v = { t: "bin", op: "*", a: v, b: power() };
    }
    return v;
  }

  function groupOrItem() {
    const tk = peek();
    if (isOp(tk, "{") || isOp(tk, "(") || isOp(tk, "[")) {
      pos++;
      const v = sum();
      expectClose(tk.v);
      return v;
    }
    return primary();
  }

  function primary() {
    const tk = next();
    if (tk.t === "num") return { t: "num", v: tk.v };
    if (tk.t === "var") return { t: "var", n: tk.v };
    if (tk.t === "op" && (tk.v === "(" || tk.v === "[" || tk.v === "{")) {
      if (peek() && peek().t === "op" && ")]}".includes(peek().v)) throw new GraphError("incomplete");
      const v = sum();
      expectClose(tk.v);
      return v;
    }
    if (tk.t === "op" && tk.v === "|") {
      absDepth++;
      const v = sum();
      absDepth--;
      if (!isOp(peek(), "|")) throw new GraphError(peek() ? "bracket" : "incomplete");
      pos++;
      return { t: "abs", a: v };
    }
    if (tk.t === "cmd" && tk.v === "frac") {
      const a = groupOrItem();
      const b = groupOrItem();
      return { t: "bin", op: "/", a, b };
    }
    if (tk.t === "cmd" && tk.v === "sqrt") {
      let n = null;
      if (isOp(peek(), "[")) {
        pos++;
        n = sum();
        expectClose("[");
      }
      const a = groupOrItem();
      return n ? { t: "root", n, a } : { t: "fn", f: "sqrt", a };
    }
    if (tk.t === "fn") {
      let f = tk.v;
      let base = null;
      let fnPower = null;
      // log_{2}, log_2
      if (isOp(peek(), "_")) {
        pos++;
        base = groupOrItem();
      }
      // sin^{-1} (inverse) or sin^{2} (squared)
      if (isOp(peek(), "^")) {
        pos++;
        const p = exponent();
        const inverse = p.t === "neg" && p.a.t === "num" && p.a.v === 1;
        if (inverse && INVERSE[f]) f = INVERSE[f];
        else fnPower = p;
      }
      if (!peek()) throw new GraphError("incomplete");
      const a = isOp(peek(), "(") || isOp(peek(), "[") || isOp(peek(), "{") ? groupOrItem() : bareArgument();
      const node = { t: "fn", f: ALIASES[f] || f, a, base };
      return fnPower ? { t: "bin", op: "^", a: node, b: fnPower } : node;
    }
    if (tk.t === "op" && "+*/^)]}=<>≤≥".includes(tk.v)) throw new GraphError("incomplete");
    throw new GraphError("unknown", tk.v);
  }

  const out = relation();
  if (pos < tokens.length) {
    const tk = tokens[pos];
    if (tk.t === "op" && ")]}".includes(tk.v)) throw new GraphError("bracket");
    throw new GraphError("unknown", tk.v);
  }
  return out;
}

const INVERSE = { sin: "arcsin", cos: "arccos", tan: "arctan", sec: "arcsec", csc: "arccsc", cot: "arccot" };
const ALIASES = { asin: "arcsin", acos: "arccos", atan: "arctan", cosec: "csc" };

// ---------- turning the tree into a fast function ----------

function realPower(a, b) {
  if (a >= 0 || Number.isInteger(b)) return Math.pow(a, b);
  // (-8)^(1/3) = -2, as on a calculator: an odd root of a negative number.
  for (let q = 3; q <= 15; q += 2) {
    const p = Math.round(b * q);
    if (Math.abs(b * q - p) < 1e-9) {
      const r = Math.pow(-a, p / q);
      return p % 2 === 0 ? r : -r;
    }
  }
  return NaN;
}

function makeFunctions(deg) {
  const k = deg ? Math.PI / 180 : 1;
  const back = deg ? 180 / Math.PI : 1;
  // sin 180° is exactly 0, not 1.2e-16 (which would turn into a "root" twice)
  const tidy = (v) => (Math.abs(v) < 1e-15 ? 0 : v);
  return {
    sin: (x) => tidy(Math.sin(x * k)),
    cos: (x) => tidy(Math.cos(x * k)),
    tan: (x) => {
      const c = Math.cos(x * k);
      return Math.abs(c) < 1e-15 ? NaN : Math.sin(x * k) / c;
    },
    sec: (x) => 1 / Math.cos(x * k),
    csc: (x) => 1 / Math.sin(x * k),
    cot: (x) => Math.cos(x * k) / Math.sin(x * k),
    arcsin: (x) => Math.asin(x) * back,
    arccos: (x) => Math.acos(x) * back,
    arctan: (x) => Math.atan(x) * back,
    arcsec: (x) => Math.acos(1 / x) * back,
    arccsc: (x) => Math.asin(1 / x) * back,
    arccot: (x) => Math.atan(1 / x) * back,
    sinh: Math.sinh,
    cosh: Math.cosh,
    tanh: Math.tanh,
    ln: Math.log,
    log: Math.log10,
    exp: Math.exp,
    sqrt: Math.sqrt,
    abs: Math.abs,
  };
}
const FUNCS_RAD = makeFunctions(false);
const FUNCS_DEG = makeFunctions(true);

function compileNode(node, F) {
  switch (node.t) {
    case "num": {
      const v = node.v;
      return () => v;
    }
    case "var": {
      const n = node.n;
      if (n in CONSTANTS) {
        const v = CONSTANTS[n];
        return () => v;
      }
      return (s) => s[n];
    }
    case "neg": {
      const a = compileNode(node.a, F);
      return (s) => -a(s);
    }
    case "abs": {
      const a = compileNode(node.a, F);
      return (s) => Math.abs(a(s));
    }
    case "root": {
      const n = compileNode(node.n, F);
      const a = compileNode(node.a, F);
      return (s) => {
        const nv = n(s);
        const av = a(s);
        if (av < 0 && Number.isInteger(nv) && nv % 2 === 1) return -Math.pow(-av, 1 / nv);
        return Math.pow(av, 1 / nv);
      };
    }
    case "bin": {
      const a = compileNode(node.a, F);
      const b = compileNode(node.b, F);
      switch (node.op) {
        case "+": return (s) => a(s) + b(s);
        case "-": return (s) => a(s) - b(s);
        case "*": return (s) => a(s) * b(s);
        case "/": return (s) => a(s) / b(s);
        default: return (s) => realPower(a(s), b(s));
      }
    }
    case "fn": {
      const a = compileNode(node.a, F);
      if (node.f === "log" && node.base) {
        const base = compileNode(node.base, F);
        return (s) => Math.log(a(s)) / Math.log(base(s));
      }
      const f = F[node.f];
      if (!f) throw new GraphError("unknown", node.f);
      return (s) => f(a(s));
    }
    default:
      throw new GraphError("unknown");
  }
}

function varsIn(node, out = new Set()) {
  if (!node) return out;
  if (node.t === "var" && !(node.n in CONSTANTS)) out.add(node.n);
  for (const key of ["a", "b", "n", "base"]) if (node[key]) varsIn(node[key], out);
  return out;
}

// ---------- equations ----------

const FLIP = { "<": ">", ">": "<", "≤": "≥", "≥": "≤", "=": "=" };

const MESSAGES = {
  incomplete: "Finish the equation",
  bracket: "A bracket doesn't match",
  chain: "Use one = or < at a time",
  unsupported: "That can't be plotted here",
  unknown: "There's something here that can't be read",
  noVariable: "Use x (and y) in the equation",
  bothSides: "Put y on its own on one side, or use both x and y",
};

// Reads one typed line ("y = x^2 - 3", "y > 2x + 1", "x = 2",
// "x^2 + y^2 = 25", "r = 2cos θ", or just "x^2 - 3").
// Returns
//   { ok: true, kind, op, params, evaluate(scope) } where kind is
//     "y"        y (op) f(x): evaluate gives f(x) (scope.x)
//     "x"        x (op) c: evaluate gives c
//     "polar"    r = f(θ): evaluate gives r (scope.θ)
//     "implicit" F(x, y) (op) 0: evaluate gives F (scope.x, scope.y)
//   or { ok: false, empty?, message }.
const equationCache = new Map();

export function readEquation(input, { degrees = false } = {}) {
  const key = `${degrees ? "d" : "r"}|${input}`;
  const cached = equationCache.get(key);
  if (cached) return cached;
  const result = readEquationUncached(input, degrees);
  if (equationCache.size > 400) equationCache.clear();
  equationCache.set(key, result);
  return result;
}

function onlyVar(node, name) {
  return node && node.t === "var" && node.n === name;
}

function readEquationUncached(input, degrees) {
  const raw = String(input == null ? "" : input);
  // "f(x) = …" means "y = …"
  const text = normalise(raw).replace(/^\s*[fghpq]\s*\(\s*x\s*\)\s*=/, "y=");
  if (!text.trim()) return { ok: false, empty: true, message: "" };
  let tree;
  try {
    tree = parse(text);
  } catch (err) {
    const kind = err instanceof GraphError ? err.kind : "unknown";
    return { ok: false, message: MESSAGES[kind] || MESSAGES.unknown };
  }
  const F = degrees ? FUNCS_DEG : FUNCS_RAD;
  let kind;
  let op = tree.rel || "=";
  let expr;
  let fixedVars;
  const left = tree.left;
  const right = tree.right;
  if (!tree.rel) {
    // Just an expression: "x^2 - 3" means y = x^2 - 3.
    if (varsIn(left).has("y")) return { ok: false, message: MESSAGES.incomplete };
    kind = "y";
    expr = left;
  } else if (onlyVar(left, "y") && !varsIn(right).has("y")) {
    kind = "y";
    expr = right;
  } else if (onlyVar(right, "y") && !varsIn(left).has("y")) {
    kind = "y";
    expr = left;
    op = FLIP[op];
  } else if (onlyVar(left, "x") && !varsIn(right).has("x") && !varsIn(right).has("y")) {
    kind = "x";
    expr = right;
  } else if (onlyVar(right, "x") && !varsIn(left).has("x") && !varsIn(left).has("y")) {
    kind = "x";
    expr = left;
    op = FLIP[op];
  } else if (onlyVar(left, "r") && !["r", "x", "y"].some((v) => varsIn(right).has(v))) {
    kind = "polar";
    expr = right;
  } else {
    const vars = new Set([...varsIn(left), ...varsIn(right)]);
    if (!vars.has("x") && !vars.has("y")) return { ok: false, message: MESSAGES.noVariable };
    kind = "implicit";
    expr = { t: "bin", op: "-", a: left, b: right };
  }
  if (kind === "polar" && op !== "=") return { ok: false, message: "Polar curves use =" };
  if (kind === "y") fixedVars = ["x", "θ"];
  else if (kind === "polar") fixedVars = ["θ"];
  else if (kind === "implicit") fixedVars = ["x", "y"];
  else fixedVars = [];
  let evaluate;
  try {
    evaluate = compileNode(expr, F);
  } catch (err) {
    return { ok: false, message: MESSAGES.unknown };
  }
  const params = [...varsIn(expr)].filter((v) => !fixedVars.includes(v)).sort();
  if (kind === "y" && params.includes("y")) return { ok: false, message: MESSAGES.bothSides };
  return { ok: true, kind, op, params, evaluate, strict: op === "<" || op === ">" };
}

// A number typed by the teacher, which may be written as maths: "π/2",
// "-1.5", "\frac{3}{4}", "2√3". NaN if it isn't one.
export function readNumber(input, params = {}) {
  const s = String(input == null ? "" : input).trim();
  if (!s) return NaN;
  if (/^-?\d*\.?\d+$/.test(s)) return Number(s);
  try {
    const tree = parse(normalise(s));
    if (tree.rel) return NaN;
    const vars = varsIn(tree.left);
    for (const v of vars) if (!(v in params)) return NaN;
    return compileNode(tree.left, FUNCS_RAD)({ ...params });
  } catch (err) {
    return NaN;
  }
}

// What's marked on a number line: "x = 2" (or just "2") is a point;
// "x > 2", "x ≤ −1", "2 < x" and "−1 ≤ x < 3" are inequalities.
//   { ok, kind: "point" | "interval", lo, hi, loClosed, hiClosed }
// (lo / hi are ±Infinity where it carries on for ever.)
export function readInterval(input) {
  const text = normalise(String(input == null ? "" : input)).trim();
  if (!text) return { ok: false, empty: true, message: "" };
  if (text.includes("\u0000")) return { ok: false, message: MESSAGES.incomplete };
  const parts = text.split(/(≤|≥|<|>|=)/);
  const sides = parts.filter((_, i) => i % 2 === 0).map((t) => t.trim());
  const ops = parts.filter((_, i) => i % 2 === 1);
  const isX = (t) => t === "x";
  const bad = { ok: false, message: "Use x and numbers, like x > 2, x = −1 or −1 ≤ x < 3" };
  const point = (v) => ({ ok: true, kind: "point", lo: v, hi: v, loClosed: true, hiClosed: true });
  if (sides.some((t) => !t)) return { ok: false, message: MESSAGES.incomplete };
  if (ops.length === 0) {
    const v = readNumber(sides[0]);
    return Number.isFinite(v) ? point(v) : bad;
  }
  if (ops.length === 1) {
    let [l, r] = sides;
    let op = ops[0];
    if (isX(r) && !isX(l)) {
      [l, r] = [r, l];
      op = FLIP[op] || op;
    }
    if (!isX(l)) return bad;
    const v = readNumber(r);
    if (!Number.isFinite(v)) return bad;
    if (op === "=") return point(v);
    if (op === ">" || op === "≥") return { ok: true, kind: "interval", lo: v, hi: Infinity, loClosed: op === "≥", hiClosed: false };
    return { ok: true, kind: "interval", lo: -Infinity, hi: v, loClosed: false, hiClosed: op === "≤" };
  }
  if (ops.length === 2 && isX(sides[1]) && !ops.includes("=")) {
    const a = readNumber(sides[0]), b = readNumber(sides[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return bad;
    const up = (o) => o === "<" || o === "≤";
    if (up(ops[0]) && up(ops[1])) {
      if (!(a < b)) return { ok: false, message: "The smaller number goes on the left" };
      return { ok: true, kind: "interval", lo: a, hi: b, loClosed: ops[0] === "≤", hiClosed: ops[1] === "≤" };
    }
    if (!up(ops[0]) && !up(ops[1])) {
      if (!(a > b)) return { ok: false, message: "The bigger number goes on the left" };
      return { ok: true, kind: "interval", lo: b, hi: a, loClosed: ops[1] === "≥", hiClosed: ops[0] === "≥" };
    }
    return bad;
  }
  return bad;
}

// The letters in an equation that get a slider (everything that isn't x,
// y, π, e or, in a polar equation, r and θ).
export function paramsOf(input) {
  const r = readEquation(input);
  return r.ok ? r.params : [];
}

export const DEFAULT_PARAM = { value: 1, min: -10, max: 10, step: 0.1 };

// A slider's settings as they can be used: numbers everywhere (a blank or
// missing one takes the default), the smallest below the largest, and a
// step above 0.
export function sliderOf(p) {
  const d = DEFAULT_PARAM;
  const num = (v, fallback) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? fallback : Number(v));
  let min = num(p && p.min, d.min), max = num(p && p.max, d.max);
  if (!(min < max)) {
    min = d.min;
    max = d.max;
  }
  const step = num(p && p.step, d.step);
  return { value: num(p && p.value, d.value), min, max, step: step > 0 ? step : d.step };
}

// ---------- plotting y = f(x) ----------

// Samples f across [x0, x1] and returns the curve as separate pieces
// ([[x, y], …] each): a piece ends wherever the curve isn't defined
// (√x for x < 0) or jumps (an asymptote, as in tan x or 1/x). The ends of
// each piece are found accurately, so √x starts exactly at 0 and 1/x
// runs right up the asymptote.
export function sampleCurve(f, x0, x1, n, yRange) {
  const pieces = [];
  let piece = null;
  const span = x1 - x0;
  if (!(span > 0) || !(n > 1)) return pieces;
  const dx = span / n;
  const jump = Math.max(1e-9, (yRange || 1) * 0.2);
  const finite = Number.isFinite;
  const close = () => {
    if (piece && piece.length > 0) pieces.push(piece);
    piece = null;
  };
  // the edge of where f is defined, between a (defined) and b (not)
  const edge = (a, b) => {
    let fa = f(a);
    for (let i = 0; i < 40; i++) {
      const m = (a + b) / 2;
      const fm = f(m);
      if (finite(fm)) {
        a = m;
        fa = fm;
      } else b = m;
    }
    return [a, fa];
  };
  // is there a break (rather than a steep climb) between a and b?
  const breaksBetween = (xa, ya, xb, yb) => {
    let lo = xa, hi = xb, flo = ya, fhi = yb;
    for (let i = 0; i < 24; i++) {
      const m = (lo + hi) / 2;
      const fm = f(m);
      if (!finite(fm)) return true;
      const inside = (fm - flo) * (fm - fhi) <= 0;
      if (!inside) return true;
      // keep the half with the bigger jump
      if (Math.abs(fm - flo) > Math.abs(fhi - fm)) {
        hi = m;
        fhi = fm;
      } else {
        lo = m;
        flo = fm;
      }
      if (Math.abs(fhi - flo) < jump * 0.25) return false;
    }
    return Math.abs(fhi - flo) > jump;
  };
  // narrows a break down to a tiny gap [lo, hi]
  const locateBreak = (xa, ya, xb, yb) => {
    let lo = xa, hi = xb, flo = ya, fhi = yb;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (m <= lo || m >= hi) break;
      const fm = f(m);
      if (!finite(fm)) {
        hi = m;
        fhi = fm;
        continue;
      }
      if (!finite(fhi) || Math.abs(fm - flo) <= Math.abs(fhi - fm)) {
        lo = m;
        flo = fm;
      } else {
        hi = m;
        fhi = fm;
      }
    }
    return [lo, hi];
  };
  // points running up to the break from one side (so 1/x climbs right up
  // its asymptote instead of stopping a pixel short)
  const runUp = (from, to) => {
    const out = [];
    const d = to - from;
    for (let k = 1; k <= 40; k++) {
      const x = to - d * Math.pow(2, -k);
      const y = f(x);
      if (!finite(y)) break;
      out.push([x, y]);
      if (Math.abs(y) > (yRange || 1) * 50) break;
    }
    const y = f(to);
    if (finite(y)) out.push([to, y]);
    return out;
  };

  let px = null, py = null;
  for (let i = 0; i <= n; i++) {
    const x = i === n ? x1 : x0 + i * dx;
    const y = f(x);
    if (!finite(y)) {
      if (piece && px !== null && finite(py)) {
        const e = edge(px, x);
        if (e[0] > px) piece.push(e);
      }
      close();
      px = x;
      py = y;
      continue;
    }
    if (!piece) {
      piece = [];
      if (px !== null && !finite(py)) {
        // coming back into where f is defined: start exactly at the edge
        const e = edge(x, px);
        if (e[0] < x) piece.push(e);
      }
      piece.push([x, y]);
    } else if (Math.abs(y - py) > jump && breaksBetween(px, py, x, y)) {
      // an asymptote or a jump: finish this piece at it and start again
      const [lo, hi] = locateBreak(px, py, x, y);
      for (const p of runUp(px, lo)) if (p[0] > piece[piece.length - 1][0]) piece.push(p);
      close();
      piece = [];
      const after = runUp(x, hi).reverse();
      for (const p of after) if (p[0] < x) piece.push(p);
      piece.push([x, y]);
    } else {
      piece.push([x, y]);
    }
    px = x;
    py = y;
  }
  close();
  return pieces;
}

// ---------- the things a teacher points at ----------

const SAMPLE_N = 1200;

function bisect(g, a, b, ga, iterations = 70) {
  let lo = a, hi = b, glo = ga;
  for (let i = 0; i < iterations; i++) {
    const m = (lo + hi) / 2;
    const gm = g(m);
    if (!Number.isFinite(gm)) return null;
    if (gm === 0) return m;
    if ((gm < 0) === (glo < 0)) {
      lo = m;
      glo = gm;
    } else hi = m;
  }
  return (lo + hi) / 2;
}

function minimiseAbs(g, a, b) {
  // golden section on |g|
  const r = (Math.sqrt(5) - 1) / 2;
  let x1 = b - r * (b - a), x2 = a + r * (b - a);
  let f1 = Math.abs(g(x1)), f2 = Math.abs(g(x2));
  for (let i = 0; i < 80; i++) {
    if (f1 < f2) {
      b = x2; x2 = x1; f2 = f1;
      x1 = b - r * (b - a); f1 = Math.abs(g(x1));
    } else {
      a = x1; x1 = x2; f1 = f2;
      x2 = a + r * (b - a); f2 = Math.abs(g(x2));
    }
  }
  return (a + b) / 2;
}

function uniqueSorted(xs, tol) {
  const out = [];
  for (const x of xs.sort((p, q) => p - q)) if (!out.length || Math.abs(x - out[out.length - 1]) > tol) out.push(x);
  return out;
}

// Where g crosses or touches zero in [x0, x1] (g continuous there).
export function zerosOf(g, x0, x1, n = SAMPLE_N, scaleHint = 1) {
  const dx = (x1 - x0) / n;
  const xs = [];
  const tol = 1e-9 * Math.max(1, Math.abs(scaleHint));
  // samples where g is exactly 0. A run of them is g sitting on zero (y = 0,
  // or two curves that are the same): that's no particular point, so it
  // isn't marked.
  const exact = new Map();
  let pxv = x0, pg = g(x0), ppg = NaN;
  if (pg === 0) exact.set(0, x0);
  for (let i = 1; i <= n; i++) {
    const x = i === n ? x1 : x0 + i * dx;
    const gx = g(x);
    if (Number.isFinite(gx) && Number.isFinite(pg)) {
      if (gx === 0) exact.set(i, x);
      else if (pg !== 0 && (gx < 0) !== (pg < 0)) {
        // a real crossing, unless g jumps here (1/x crosses "through" infinity)
        const m = bisect(g, pxv, x, pg);
        if (m !== null && Math.abs(g(m)) < Math.max(tol * 1e3, 1e-6 * (Math.abs(pg) + Math.abs(gx)))) xs.push(m);
      } else if (Number.isFinite(ppg) && Math.abs(pg) < Math.abs(ppg) && Math.abs(pg) < Math.abs(gx) && (pg < 0) === (gx < 0)) {
        // |g| dips without crossing: a root that only touches (x² at 0)
        const m = minimiseAbs(g, pxv - dx, x);
        if (Math.abs(g(m)) < tol * 1e2 + 1e-10) xs.push(m);
      }
    }
    ppg = pg;
    pg = gx;
    pxv = x;
  }
  for (const [i, x] of exact) if (!exact.has(i - 1) && !exact.has(i + 1)) xs.push(x);
  const found = uniqueSorted(xs, (x1 - x0) * 1e-6);
  // hundreds of "roots" means g is wobbling about on zero, not crossing it
  return found.length > n / 6 ? [] : found;
}

function derivative(f, x, span) {
  const h = Math.max(1e-7, Math.abs(span) * 1e-6, Math.abs(x) * 1e-8);
  return (f(x + h) - f(x - h)) / (2 * h);
}

export function gradientAt(f, x, span = 1) {
  return derivative(f, x, span);
}

// Turning points of f in [x0, x1]: { x, y, kind: "max" | "min" }.
export function turningPointsOf(f, x0, x1, yRange = 1) {
  const span = x1 - x0;
  const d = (x) => derivative(f, x, span);
  const n = SAMPLE_N;
  const dx = span / n;
  const out = [];
  let px = x0, pd = d(x0);
  for (let i = 1; i <= n; i++) {
    const x = i === n ? x1 : x0 + i * dx;
    const dv = d(x);
    if (Number.isFinite(dv) && Number.isFinite(pd) && pd !== 0 && (dv < 0) !== (pd < 0) || dv === 0) {
      const m = dv === 0 ? x : bisect(d, px, x, pd);
      if (m !== null) {
        const y = f(m);
        const yl = f(m - dx / 4), yr = f(m + dx / 4);
        // not where f breaks (tan x's asymptotes look like a sign change in f')
        if (Number.isFinite(y) && Number.isFinite(yl) && Number.isFinite(yr) && Math.abs(yl - y) < yRange && Math.abs(yr - y) < yRange) {
          if (yl < y && yr < y) out.push({ x: m, y, kind: "max" });
          else if (yl > y && yr > y) out.push({ x: m, y, kind: "min" });
        }
      }
    }
    px = x;
    pd = dv;
  }
  const seen = [];
  return out.filter((p) => {
    if (seen.some((q) => Math.abs(q - p.x) < span * 1e-5)) return false;
    seen.push(p.x);
    return true;
  });
}

// Vertical asymptotes in [x0, x1] (where f runs off to ±∞), and
// horizontal ones (what f settles to far out to the left / right).
export function asymptotesOf(f, x0, x1, yRange = 1) {
  const vertical = [];
  const pieces = sampleCurve(f, x0, x1, SAMPLE_N, yRange);
  const huge = Math.max(1e6, yRange * 1e3);
  for (let i = 0; i + 1 < pieces.length; i++) {
    const a = pieces[i][pieces[i].length - 1];
    const b = pieces[i + 1][0];
    // the curve runs off towards ±∞ at the gap (not just a step, as in a
    // staircase graph)
    if (b[0] - a[0] < (x1 - x0) * 1e-3 && Math.max(Math.abs(a[1]), Math.abs(b[1])) > huge) {
      const x = Math.abs(a[1]) >= Math.abs(b[1]) ? a[0] : b[0];
      vertical.push(Math.abs(x - Math.round(x)) < 1e-7 ? Math.round(x) : x);
    }
  }
  const horizontal = [];
  // f far out, at uneven places (so a repeating curve like sin x, which can
  // land on the same value at round numbers, isn't mistaken for settling)
  const FAR = [11003.7, 73019.3, 291234.57, 612345.913, 1712345.67, 8312345.271];
  for (const sign of [-1, 1]) {
    const v = FAR.map((x) => f(sign * x));
    const d = f(sign * 1e8);
    const near = (y, tol) => Math.abs(y - d) < tol * (1 + Math.abs(d));
    if ([...v, d].every(Number.isFinite) && v.every((y) => near(y, 1e-2)) && v.slice(2).every((y) => near(y, 1e-4))) {
      const L = Math.abs(d) < 1e-6 ? 0 : Number(d.toPrecision(6));
      if (!horizontal.some((h) => Math.abs(h - L) < 1e-4 * (1 + Math.abs(L)))) horizontal.push(L);
    }
  }
  return { vertical: uniqueSorted(vertical, (x1 - x0) * 1e-6), horizontal };
}

// ∫ f from a to b (adaptive Simpson). NaN if f isn't defined all the way.
export function integrate(f, a, b) {
  if (!(Number.isFinite(a) && Number.isFinite(b))) return NaN;
  if (a === b) return 0;
  if (a > b) return -integrate(f, b, a);
  const simpson = (l, r, fl, fm, fr) => ((r - l) / 6) * (fl + 4 * fm + fr);
  let budget = 200000;
  const step = (l, r, fl, fm, fr, whole, eps, depth) => {
    const m = (l + r) / 2;
    const lm = (l + m) / 2, rm = (m + r) / 2;
    const flm = f(lm), frm = f(rm);
    budget -= 2;
    if (!Number.isFinite(flm) || !Number.isFinite(frm)) return NaN;
    const left = simpson(l, m, fl, flm, fm);
    const right = simpson(m, r, fm, frm, fr);
    if (depth <= 0 || budget <= 0 || Math.abs(left + right - whole) <= 15 * eps) return left + right + (left + right - whole) / 15;
    return step(l, m, fl, flm, fm, left, eps / 2, depth - 1) + step(m, r, fm, frm, fr, right, eps / 2, depth - 1);
  };
  // in pieces, so a wiggly function isn't misjudged from three points
  const parts = 64;
  let total = 0;
  for (let i = 0; i < parts; i++) {
    const l = a + ((b - a) * i) / parts, r = a + ((b - a) * (i + 1)) / parts;
    const fl = f(l), fr = f(r), fm = f((l + r) / 2);
    if (![fl, fm, fr].every(Number.isFinite)) return NaN;
    const v = step(l, r, fl, fm, fr, simpson(l, r, fl, fm, fr), 1e-10, 40);
    if (!Number.isFinite(v)) return NaN;
    total += v;
  }
  return total;
}

// The area between f and the x-axis from a to b (parts below the axis
// counted as positive), and the integral.
export function areaUnder(f, a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const none = { integral: NaN, area: NaN, crosses: false };
  // across an asymptote (1/x from −1 to 2) there's no area to give, and the
  // sum would come out as a made-up number
  if (!(hi > lo)) return none;
  const mags = [];
  for (let i = 0; i <= 64; i++) {
    const y = f(lo + ((hi - lo) * i) / 64);
    if (Number.isFinite(y)) mags.push(Math.abs(y));
  }
  mags.sort((p, q) => p - q);
  const typical = mags.length ? mags[Math.floor(mags.length / 2)] : 1;
  if (asymptotesOf(f, lo, hi, Math.max(1, typical * 10)).vertical.length) return none;
  const integral = integrate(f, a, b);
  if (!Number.isFinite(integral)) return none;
  const cuts = zerosOf(f, lo, hi, 400).filter((x) => x > lo && x < hi);
  if (!cuts.length) return { integral, area: Math.abs(integral), crosses: false };
  const edges = [lo, ...cuts, hi];
  let area = 0;
  for (let i = 0; i + 1 < edges.length; i++) area += Math.abs(integrate(f, edges[i], edges[i + 1]));
  return { integral, area, crosses: true };
}

// Line of best fit (least squares): { m, c, r } or null.
export function bestFitLine(points) {
  const pts = (points || []).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  const n = pts.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) {
    sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y;
  }
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-12) return null;
  const m = (n * sxy - sx * sy) / den;
  const c = (sy - m * sx) / n;
  const rDen = Math.sqrt(den * (n * syy - sy * sy));
  const r = rDen > 0 ? (n * sxy - sx * sy) / rDen : 1;
  return { m, c, r };
}

// "(1, 2) (3, -4.5)" or "1,2; 3,-4.5" → [[1, 2], [3, -4.5]]
export function readPointList(text) {
  const s = String(text || "").replace(/[−–]/g, "-");
  const out = [];
  const re = /\(?\s*(-?\d*\.?\d+(?:e-?\d+)?)\s*[,;\s]\s*(-?\d*\.?\d+(?:e-?\d+)?)\s*\)?/gi;
  let m;
  while ((m = re.exec(s))) out.push([Number(m[1]), Number(m[2])]);
  return out;
}

// x values for a table: from, to, step (at most `max` of them).
export function tableXs(from, to, step, max = 25) {
  if (![from, to, step].every(Number.isFinite) || step === 0) return [];
  const s = to >= from ? Math.abs(step) : -Math.abs(step);
  const out = [];
  for (let i = 0; i < max; i++) {
    const x = from + i * s;
    if ((s > 0 && x > to + Math.abs(s) * 1e-9) || (s < 0 && x < to - Math.abs(s) * 1e-9)) break;
    out.push(Math.abs(x) < 1e-12 ? 0 : Number(x.toPrecision(12)));
  }
  return out;
}

// ---------- writing numbers ----------

const MINUS = "−";

export function formatValue(v, places = 2) {
  if (!Number.isFinite(v)) return "undefined";
  if (Math.abs(v) < 1e-9) return "0";
  const r = Math.round(v);
  if (Math.abs(v - r) < 1e-9 * Math.max(1, Math.abs(v))) return r < 0 ? MINUS + Math.abs(r) : String(r);
  const abs = Math.abs(v);
  let s;
  if (abs >= 1e6 || abs < 1e-4) s = abs.toExponential(2);
  else s = String(Number(abs.toFixed(places)));
  if (s === "0") return "0";
  return v < 0 ? MINUS + s : s;
}

// A multiple of π, written as a fraction of π when it is close to one
// ("π/2", "3π/4"); otherwise null.
export function asPiMultiple(v) {
  if (!Number.isFinite(v)) return null;
  const k = v / Math.PI;
  for (let den = 1; den <= 12; den++) {
    const num = Math.round(k * den);
    if (num !== 0 && Math.abs(k * den - num) < 1e-7) {
      let a = Math.abs(num), b = den;
      while (b) [a, b] = [b, a % b];
      const n = num / a, d = den / a;
      const head = Math.abs(n) === 1 ? "π" : `${Math.abs(n)}π`;
      return `${n < 0 ? MINUS : ""}${head}${d === 1 ? "" : `/${d}`}`;
    }
  }
  return Math.abs(v) < 1e-12 ? "0" : null;
}
