// The text box editor's side of richText.js: turning a text box into
// editable HTML and back, and the "maths as you type" changes
// (x^2, x_2, 3/4). Browser only. Used by TextEditor.js.
//
// The editor shows a text box at its real size on the board (the editor
// is scaled with the board), so sizes here are board sizes.

import { BASE_FONT, scaleSizes } from "./richText";
import { inkOn, LIGHT_INK } from "./inkColor";

export const ZW = "​"; // keeps an empty power or fraction part open for the caret
const FAMILY = /^[A-Za-z0-9 _\-]{1,60}$/;
const BASE_FIRST = "-apple-system";

// ---------- doc -> HTML ----------

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function rgbaOf(hex, a) {
  const n = parseInt(String(hex).slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function styleAttr(n, dark, isRun) {
  const css = [];
  // the colour as written, for when it's shown differently on this page
  const keep = n.c && inkOn(n.c, dark) !== n.c ? ` data-c="${esc(n.c)}"` : "";
  if (n.b) css.push("font-weight:700");
  if (n.i) css.push("font-style:italic");
  if (isRun && n.u) css.push("text-decoration:underline");
  if (n.c) css.push(`color:${inkOn(n.c, dark)}`);
  if (isRun && n.h) css.push(`background-color:${rgbaOf(n.h, 0.55)}`);
  if (n.f) css.push(`font-family:&quot;${esc(n.f)}&quot;, ${BASE_FONT}`);
  if (n.z) css.push(`font-size:${n.z}px`);
  return css.length ? ` style="${css.join(";")}"${keep}` : "";
}

function nodesHtml(nodes, dark) {
  let out = "";
  for (const n of nodes) {
    if (typeof n === "string") {
      out += esc(n);
    } else if (n.s !== undefined) {
      const st = styleAttr(n, dark, true);
      out += st ? `<span${st}>${esc(n.s)}</span>` : esc(n.s);
    } else if (n.k) {
      let atom;
      if (n.k === "frac") {
        atom = `<span class="rt-frac"><span class="rt-num">${nodesHtml(n.n, dark) || ZW}</span><span class="rt-den">${nodesHtml(n.d, dark) || ZW}</span></span>`;
      } else {
        const tag = n.k === "sup" ? "sup" : "sub";
        atom = `<${tag}>${nodesHtml(n.n, dark) || ZW}</${tag}>`;
      }
      const st = styleAttr(n, dark, false);
      out += st ? `<span${st}>${atom}</span>` : atom;
    }
  }
  return out;
}

export function docToHtml(raw, dark, size) {
  const doc = scaleSizes(raw, size);
  return doc.b
    .map((bl) => {
      const align = bl.a === "c" ? ' style="text-align:center"' : bl.a === "r" ? ' style="text-align:right"' : "";
      return `<div${align}>${nodesHtml(bl.n, dark) || "<br>"}</div>`;
    })
    .join("");
}

// ---------- HTML -> doc ----------

// "rgb(1, 2, 3)" -> "#010203" (null when see-through)
export function cssHex(value) {
  const m = /rgba?\(([^)]+)\)/.exec(value || "");
  if (!m) return null;
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (p.length < 3 || p.slice(0, 3).some((x) => !Number.isFinite(x))) return null;
  if (p.length >= 4 && p[3] === 0) return null;
  return "#" + p.slice(0, 3).map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");
}

export function firstFamily(value) {
  const first = String(value || "").split(",")[0] || "";
  return first.trim().replace(/^["']|["']$/g, "");
}

function clean(s) {
  return String(s).replace(/​/g, "").replace(/ /g, " ");
}

function isAtomEl(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.tagName === "SUP" || el.tagName === "SUB") return true;
  return !!(el.classList && el.classList.contains("rt-frac") && el.querySelector(":scope > .rt-num") && el.querySelector(":scope > .rt-den"));
}

// Reads the editor back into a doc. base: { size, color (as shown), raw (the box's colour), dark }
export function htmlToDoc(root, base) {
  const lines = [];
  let cur = null;

  const readStyle = (el, { inAtom = false, context = false } = {}) => {
    const cs = getComputedStyle(el);
    const out = {};
    if ((parseInt(cs.fontWeight, 10) || 400) >= 600) out.b = 1;
    if (cs.fontStyle && cs.fontStyle !== "normal") out.i = 1;
    if (!inAtom && !context) {
      for (let e = el; e && e !== root; e = e.parentElement) {
        if (String(getComputedStyle(e).textDecorationLine || "").includes("underline") || e.tagName === "U") {
          out.u = 1;
          break;
        }
      }
      for (let e = el; e && e !== root; e = e.parentElement) {
        const bg = getComputedStyle(e).backgroundColor;
        if (bg === NO_HIGHLIGHT) break;
        const h = cssHex(bg);
        if (h) {
          out.h = h;
          break;
        }
      }
    }
    const c = cssHex(cs.color);
    // shown differently on this page? then the colour as written
    let written = null;
    for (let e = el; e && e !== root; e = e.parentElement) {
      if (e.style && e.style.color) {
        const dc = e.getAttribute("data-c");
        if (dc && inkOn(dc, base.dark) === c) written = dc.toLowerCase();
        break;
      }
    }
    if (written) {
      if (written !== String(base.raw || "").toLowerCase()) out.c = written;
    } else if (c && c !== base.color) {
      out.c = base.dark && c === LIGHT_INK ? "#1a1a1a" : c;
    }
    const fam = firstFamily(cs.fontFamily);
    if (fam && fam !== BASE_FIRST && fam !== "BlinkMacSystemFont" && fam !== "sans-serif" && FAMILY.test(fam)) out.f = fam;
    if (!inAtom) {
      const z = parseFloat(cs.fontSize);
      if (Number.isFinite(z) && Math.abs(z - base.size) > 0.5) out.z = Math.round(z * 10) / 10;
    }
    return out;
  };

  const run = (s, el, inAtom) => {
    const st = readStyle(el, { inAtom });
    return Object.keys(st).length ? { s, ...st } : s;
  };

  const inline = (el) => {
    const out = [];
    for (const ch of el.childNodes) {
      if (ch.nodeType === 3) {
        const s = clean(ch.data).replace(/\n/g, " ");
        if (s) out.push(run(s, ch.parentElement, true));
      } else if (ch.nodeType === 1) {
        if (isAtomEl(ch)) {
          const a = atomOf(ch);
          if (a) out.push(a);
        } else if (ch.tagName !== "BR") {
          out.push(...inline(ch));
        }
      }
    }
    return merge(out);
  };

  const atomOf = (el) => {
    let atom;
    if (el.tagName === "SUP" || el.tagName === "SUB") {
      const n = inline(el);
      if (!n.length) return null;
      atom = { k: el.tagName === "SUP" ? "sup" : "sub", n };
    } else {
      const n = inline(el.querySelector(":scope > .rt-num"));
      const d = inline(el.querySelector(":scope > .rt-den"));
      if (!n.length && !d.length) return null;
      atom = { k: "frac", n, d };
    }
    const parent = el.parentElement || root;
    const ctx = readStyle(parent, { context: true });
    // inside another piece of maths, its size is that piece's
    if (parent !== root && parent.closest && parent.closest("sup, sub, .rt-frac") && root.contains(parent.closest("sup, sub, .rt-frac"))) {
      const z = parseFloat(getComputedStyle(parent).fontSize);
      if (Number.isFinite(z)) ctx.z = Math.round(z * 10) / 10;
    }
    return { ...atom, ...ctx };
  };

  const alignOf = (el) => {
    const a = getComputedStyle(el || root).textAlign;
    return a === "center" ? "c" : a === "right" || a === "end" ? "r" : undefined;
  };
  const ensure = (el) => {
    if (!cur) {
      cur = { n: [] };
      const a = alignOf(el);
      if (a) cur.a = a;
      lines.push(cur);
    }
    return cur;
  };

  const walk = (node) => {
    for (const ch of node.childNodes) {
      if (ch.nodeType === 3) {
        // (a line break typed or pasted as a character)
        clean(ch.data).split("\n").forEach((s, i) => {
          if (i > 0) {
            ensure(ch.parentElement);
            cur = null;
          }
          if (s) ensure(ch.parentElement).n.push(run(s, ch.parentElement, false));
        });
        continue;
      }
      if (ch.nodeType !== 1) continue;
      if (ch.tagName === "BR") {
        ensure(ch.parentElement);
        cur = null;
        continue;
      }
      if (isAtomEl(ch)) {
        const a = atomOf(ch);
        ensure(ch.parentElement);
        if (a) cur.n.push(a);
        continue;
      }
      if (/^(DIV|P|LI|H[1-6]|BLOCKQUOTE|PRE)$/.test(ch.tagName)) {
        cur = null;
        walk(ch);
        cur = null;
        continue;
      }
      walk(ch);
    }
  };
  walk(root);

  for (const ln of lines) ln.n = merge(ln.n);
  // empty lines at the end are dropped
  while (lines.length > 1 && !lines[lines.length - 1].n.length) lines.pop();
  return { b: lines.length ? lines : [{ n: [] }] };
}

function sameStyle(a, b) {
  const ka = Object.keys(a).filter((k) => k !== "s");
  const kb = Object.keys(b).filter((k) => k !== "s");
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

function merge(nodes) {
  const out = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (typeof n === "string" && typeof last === "string") out[out.length - 1] = last + n;
    else if (n && typeof n === "object" && n.s !== undefined && last && typeof last === "object" && last.s !== undefined && sameStyle(n, last)) out[out.length - 1] = { ...last, s: last.s + n.s };
    else out.push(n);
  }
  return out;
}

// ---------- taking a highlight off ----------

// "No highlight" is applied as this marker colour, then the marked words
// are lifted out of any highlighted words around them (a see-through
// background inside a yellow one would still look yellow).
export const NO_HIGHLIGHT = "rgb(1, 2, 3)";
const INLINE_STOP = /^(DIV|P|LI|SUP|SUB)$/;

function splitAround(parent, el) {
  const after = parent.cloneNode(false);
  while (el.nextSibling) after.appendChild(el.nextSibling);
  const mid = parent.cloneNode(false);
  mid.style.backgroundColor = "";
  if (!mid.getAttribute("style")) mid.removeAttribute("style");
  mid.appendChild(el);
  parent.after(mid);
  mid.after(after);
  if (!parent.childNodes.length) parent.remove();
  if (!after.childNodes.length) after.remove();
  return mid;
}

function highlighted(el) {
  return !!(el.style && el.style.backgroundColor && cssHex(el.style.backgroundColor) && el.style.backgroundColor !== NO_HIGHLIGHT);
}

export function clearHighlightMarks(root) {
  const marks = [...root.querySelectorAll("[style]")].filter((n) => n.style.backgroundColor === NO_HIGHLIGHT);
  if (!marks.length) return false;
  const sel = window.getSelection();
  const keep = sel && sel.rangeCount ? [sel.anchorNode, sel.anchorOffset, sel.focusNode, sel.focusOffset] : null;
  for (const mark of marks) {
    mark.style.backgroundColor = "";
    let el = mark;
    // the highest highlighted (or fraction-part) inline element it sits in
    let top = null;
    for (let p = el.parentElement; p && p !== root && !INLINE_STOP.test(p.tagName) && !(p.classList && (p.classList.contains("rt-num") || p.classList.contains("rt-den") || p.classList.contains("rt-frac"))); p = p.parentElement) {
      if (highlighted(p)) top = p;
    }
    if (top) {
      const stopAt = top.parentElement;
      while (el.parentElement && el.parentElement !== stopAt) el = splitAround(el.parentElement, el);
    }
    for (const inner of mark.querySelectorAll("[style]")) if (highlighted(inner)) inner.style.backgroundColor = "";
    if (!mark.getAttribute("style")) mark.removeAttribute("style");
  }
  if (keep && keep[0] && root.contains(keep[0]) && keep[2] && root.contains(keep[2])) {
    try {
      sel.setBaseAndExtent(keep[0], keep[1], keep[2], keep[3]);
    } catch (err) {
      // the caret stays wherever it ended up
    }
  }
  return true;
}

// ---------- maths as you type ----------

// The piece of maths the caret is in: { el, kind: "sup" | "sub" | "num" | "den", box }
export function mathAt(root, node) {
  for (let e = node && node.nodeType === 3 ? node.parentElement : node; e && e !== root; e = e.parentElement) {
    if (e.tagName === "SUP" || e.tagName === "SUB") return { el: e, kind: e.tagName === "SUP" ? "sup" : "sub", box: e };
    if (e.classList && (e.classList.contains("rt-num") || e.classList.contains("rt-den")) && e.parentElement && e.parentElement.classList.contains("rt-frac")) {
      return { el: e, kind: e.classList.contains("rt-num") ? "num" : "den", box: e.parentElement };
    }
  }
  return null;
}

// Is the caret at the very end of el (ignoring the invisible keep-open marks)?
export function atEnd(el, node, offset) {
  const r = document.createRange();
  r.setStart(node, offset);
  r.setEnd(el, el.childNodes.length);
  return clean(r.toString()) === "";
}

function balanced(s) {
  let d = 0;
  for (const ch of s) {
    if (ch === "(") d++;
    else if (ch === ")") d--;
  }
  return d <= 0;
}

function caretAfter(sel, node) {
  const r = document.createRange();
  r.setStartAfter(node);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

function caretIn(sel, text) {
  const r = document.createRange();
  r.setStart(text, text.length);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

// Moves the caret just past a piece of maths, typing `ch` there.
export function leaveMath(sel, box, ch) {
  const t = document.createTextNode(ch || ZW);
  box.parentNode.insertBefore(t, box.nextSibling);
  caretIn(sel, t);
  return t;
}

// What a fraction's top is made from, typed just before "/": a number
// (3, 2.5, 12x), a letter or two (x, dy, a2), or a bracket (a+b).
const OPERAND = /(\d+(?:\.\d+)?[A-Za-z]?|[A-Za-z]{1,2}\d*|\([^()]*\))$/;

// Handles one typed character. Returns null (type it as usual) or what
// was changed, for Backspace to undo straight after: { kind, el, text }.
export function typeMaths(root, sel, ch) {
  if (!sel.rangeCount || !sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  const offset = range.startOffset;
  if (!root.contains(node)) return null;
  const at = mathAt(root, node);

  // leaving a power or the bottom of a fraction
  if (at && at.kind !== "num" && atEnd(at.el, node, offset)) {
    const inside = clean(at.el.textContent);
    if (ch === ")" && inside.startsWith("(") && balanced(inside.slice(1)) && !balanced(inside)) {
      // x^(n+1) shows as x with n+1 raised: the brackets were only for typing
      const first = firstText(at.el);
      if (first) first.data = first.data.replace("(", "");
      leaveMath(sel, at.box, "");
      return { kind: "close" };
    }
    if (inside && balanced(inside) && /^[\s+\-=<>,;:×÷·*≤≥≠]$/.test(ch)) {
      leaveMath(sel, at.box, ch);
      return { kind: "leave" };
    }
  }

  if (ch === "^" || ch === "_") {
    if (at && (at.kind === "sup" || at.kind === "sub")) return null;
    const before = charBefore(node, offset);
    if (!before || !/[A-Za-z0-9)\]}.!'′]/.test(before)) return null;
    const el = document.createElement(ch === "^" ? "sup" : "sub");
    const t = document.createTextNode(ZW);
    el.appendChild(t);
    range.insertNode(el);
    caretIn(sel, t);
    return { kind: ch, el, text: ch };
  }

  if (ch === "/") {
    if (at || node.nodeType !== 3) return null;
    const textBefore = node.data.slice(0, offset);
    const m = OPERAND.exec(textBefore);
    if (!m) return null;
    const prev = textBefore[m.index - 1];
    if (prev && /[A-Za-z0-9.]/.test(prev)) return null;
    const top = m[1].startsWith("(") ? m[1].slice(1, -1) : m[1];
    if (!top.trim()) return null;
    const r = document.createRange();
    r.setStart(node, m.index);
    r.setEnd(node, offset);
    r.deleteContents();
    const frac = document.createElement("span");
    frac.className = "rt-frac";
    const num = document.createElement("span");
    num.className = "rt-num";
    num.textContent = top;
    const den = document.createElement("span");
    den.className = "rt-den";
    const t = document.createTextNode(ZW);
    den.appendChild(t);
    frac.append(num, den);
    r.insertNode(frac);
    caretIn(sel, t);
    return { kind: "/", el: frac, text: m[1] + "/" };
  }
  return null;
}

// Backspace straight after a change: back to what was typed.
export function undoMaths(root, sel, change) {
  if (!change || !change.el || !change.el.isConnected || !root.contains(change.el)) return false;
  const part = change.kind === "/" ? change.el.querySelector(":scope > .rt-den") : change.el;
  if (!part || clean(part.textContent) !== "") return false;
  if (!sel.rangeCount || !part.contains(sel.getRangeAt(0).startContainer)) return false;
  const t = document.createTextNode(change.text);
  change.el.replaceWith(t);
  caretIn(sel, t);
  return true;
}

// Arrow right at the end of a power or fraction: out of it.
export function arrowOut(root, sel) {
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  const at = mathAt(root, r.startContainer);
  if (!at) return false;
  if (at.kind === "num") {
    // from the top of a fraction to its bottom
    const den = at.box.querySelector(":scope > .rt-den");
    if (!den || !atEnd(at.el, r.startContainer, r.startOffset)) return false;
    let t = lastText(den);
    if (!t) {
      t = document.createTextNode(ZW);
      den.appendChild(t);
    }
    caretIn(sel, t);
    return true;
  }
  if (!atEnd(at.el, r.startContainer, r.startOffset)) return false;
  const next = at.box.nextSibling;
  if (next && next.nodeType === 3 && clean(next.data)) {
    const rr = document.createRange();
    rr.setStart(next, 0);
    rr.collapse(true);
    sel.removeAllRanges();
    sel.addRange(rr);
  } else {
    leaveMath(sel, at.box, "");
  }
  return true;
}

function firstText(el) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) if (clean(n.data)) return n;
  return null;
}

function lastText(el) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let last = null;
  for (let n = w.nextNode(); n; n = w.nextNode()) last = n;
  return last;
}

function charBefore(node, offset) {
  if (node.nodeType === 3) {
    const s = clean(node.data.slice(0, offset));
    if (s) return s[s.length - 1];
    let prev = node.previousSibling;
    while (prev && prev.nodeType === 3 && !clean(prev.data)) prev = prev.previousSibling;
    if (prev && prev.nodeType === 3) return clean(prev.data).slice(-1);
    if (prev && isAtomEl(prev)) return ")";
    if (prev && prev.nodeType === 1) return clean(prev.textContent).slice(-1) || null;
    return null;
  }
  const prev = node.childNodes[offset - 1];
  if (!prev) return null;
  if (isAtomEl(prev)) return ")";
  return clean(prev.textContent).slice(-1) || null;
}

export { caretAfter };
