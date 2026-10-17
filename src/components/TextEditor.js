"use client";

// The text box editor: type straight onto the board, with a small bar
// above for the font, size, bold / italic / underline, colour, highlight
// and alignment (like a document). Select some words to style just those.
// Ctrl/⌘+B, I and U work too. With "maths as you type" on (Settings),
// x^2 raises the 2, x_2 lowers it and 3/4 stacks a fraction; Backspace
// straight after puts back what was typed (for dates like 10/17).
//
// The board passes the box (info) and gets the finished text back through
// onDone(raw): "" when the box was left empty. raw is richText.js's format.
// handleRef.current = { place(x, y, scale), commit() }.

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { BASE_FONT, decodeText, encodeText, docPlain, familiesIn } from "@/lib/richText";
import { docToHtml, htmlToDoc, typeMaths, undoMaths, arrowOut, rgbaOf, cssHex, firstFamily, mathAt, clearHighlightMarks, NO_HIGHLIGHT } from "@/lib/richTextDom";
import { GOOGLE_FONTS, ensureFont, ensureCustomFonts, subscribeFonts, MAX_CUSTOM_FONTS } from "@/lib/fonts";
import { inkOn } from "@/lib/inkColor";
import { PEN_COLORS, useSetting, setSetting } from "@/lib/settings";
import s from "./TextEditor.module.css";

const SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 80, 96];
const HIGHLIGHTS = [
  ["Yellow", "#ffe066"],
  ["Green", "#b2f2bb"],
  ["Blue", "#a5d8ff"],
  ["Pink", "#fcc2d7"],
  ["Orange", "#ffd8a8"],
];
const EMPTY_BAR = { b: false, i: false, u: false, align: "l", size: 24, font: "", color: "" };

function nextSize(size, dir) {
  if (dir > 0) return SIZES.find((x) => x > size + 0.5) || Math.min(300, Math.round(size * 1.25));
  const smaller = SIZES.filter((x) => x < size - 0.5);
  return smaller.length ? smaller[smaller.length - 1] : Math.max(6, Math.round(size * 0.8));
}

export default function TextEditor({ info, raw = "", dark = false, canUpload = false, onUpload, onDone, handleRef }) {
  const rootRef = useRef(null);
  const editRef = useRef(null);
  const barRef = useRef(null);
  const savedRangeRef = useRef(null);
  const doneRef = useRef(false);
  const changeRef = useRef(null); // the last maths change (Backspace undoes it)
  const pendingSizeRef = useRef(null);
  const placeRef = useRef({ x: 0, y: 0, scale: 1 });
  const fileRef = useRef(null);
  const colorInputRef = useRef(null);
  const mathOn = useSetting("mathText");
  const customFonts = useSetting("customFonts");
  const mathOnRef = useRef(mathOn);
  const fontsRef = useRef(customFonts);
  const [bar, setBar] = useState(EMPTY_BAR);
  const [menu, setMenu] = useState(null); // "font" | "size" | "color" | "highlight"
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [, setFontTick] = useState(0);

  const baseColor = inkOn(info.color || "#1a1a1a", dark);

  useEffect(() => {
    mathOnRef.current = mathOn;
    fontsRef.current = customFonts;
  }, [mathOn, customFonts]);

  // ---------- reading back ----------

  function currentRaw() {
    const el = editRef.current;
    if (!el) return "";
    const doc = htmlToDoc(el, { size: info.fontSize || 24, color: cssHex(getComputedStyle(el).color) || baseColor, raw: info.color, dark });
    if (!docPlain(doc).trim()) return "";
    // uploaded fonts travel with the box, so everyone sees them (the box's
    // own ones first: someone else's font can share a name with one of yours)
    const known = {};
    for (const f of fontsRef.current || []) known[f.name] = f.url;
    Object.assign(known, decodeText(raw).fx || {});
    const fx = {};
    for (const fam of familiesIn(doc)) if (known[fam]) fx[fam] = known[fam];
    if (Object.keys(fx).length) doc.fx = fx;
    doc.s = info.fontSize || 24;
    return encodeText(doc);
  }

  function commit() {
    if (doneRef.current) return;
    doneRef.current = true;
    let out = "";
    try {
      out = currentRaw();
    } catch (err) {
      out = raw;
    }
    onDone(out);
  }

  // ---------- where it sits ----------

  // The bar goes above the box, or below it when there's no room above
  // (it never covers the app's own toolbar), and stays on the screen. An
  // open menu opens upwards when there's no room under the bar.
  function placeBar() {
    const root = rootRef.current;
    const el = editRef.current;
    const b = barRef.current;
    if (!root || !el || !b) return;
    const pane = root.closest('[data-board-pane="true"]');
    const area = pane ? pane.getBoundingClientRect() : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const r = root.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    const bw = b.offsetWidth;
    const bh = b.offsetHeight;
    const left = Math.max(area.left + 8, Math.min(r.left, area.right - bw - 8));
    let top = e.top - bh - 12;
    if (top < area.top + 8) top = Math.min(e.bottom + 12, area.bottom - bh - 8);
    if (top < area.top + 8) top = area.top + 8;
    b.style.left = left - r.left + "px";
    b.style.top = top - r.top + "px";
    const m = b.querySelector("[data-menu]");
    if (m) {
      const list = m.querySelector("[data-menu-list]") || m;
      m.style.top = "";
      m.style.bottom = "";
      list.style.maxHeight = "";
      const mr = m.getBoundingClientRect();
      if (mr.bottom > area.bottom - 8) {
        const roomBelow = area.bottom - 8 - mr.top;
        const roomAbove = top - 8 - area.top;
        const extra = mr.height - list.getBoundingClientRect().height;
        if (roomAbove > roomBelow) {
          m.style.top = "auto";
          m.style.bottom = "calc(100% + 8px)";
          if (mr.height > roomAbove) list.style.maxHeight = Math.max(100, roomAbove - extra) + "px";
        } else {
          list.style.maxHeight = Math.max(100, roomBelow - extra) + "px";
        }
      }
    }
  }

  function place(x, y, scale) {
    placeRef.current = { x, y, scale };
    const root = rootRef.current;
    const el = editRef.current;
    if (!root || !el) return;
    root.style.left = x + "px";
    root.style.top = y + "px";
    root.style.visibility = "visible";
    el.style.transform = `scale(${scale})`;
    el.style.outlineWidth = 1.5 / scale + "px";
    el.style.outlineOffset = 3 / scale + "px";
    placeBar();
  }

  // ---------- the bar ----------

  function readBar() {
    const el = editRef.current;
    const sel = window.getSelection();
    if (!el || !sel || !sel.rangeCount) return;
    let node = sel.getRangeAt(0).startContainer;
    if (!el.contains(node)) return;
    let at = node.nodeType === 3 ? node.parentElement : node;
    // inside a piece of maths, the writing it sits in
    const m = mathAt(el, node);
    if (m) at = m.box.parentElement || el;
    const cs = getComputedStyle(at);
    let b = false, i = false, u = false;
    try {
      b = document.queryCommandState("bold");
      i = document.queryCommandState("italic");
      u = document.queryCommandState("underline");
    } catch (err) {
      // not supported: leave them off
    }
    const a = cs.textAlign === "center" ? "c" : cs.textAlign === "right" || cs.textAlign === "end" ? "r" : "l";
    const fam = firstFamily(cs.fontFamily);
    const font = fam === "-apple-system" || fam === "BlinkMacSystemFont" || fam === "sans-serif" ? "" : fam;
    const next = { b, i, u, align: a, size: Math.round(parseFloat(cs.fontSize) || info.fontSize || 24), font, color: cssHex(cs.color) || "" };
    setBar((prev) => (Object.keys(next).every((k) => prev[k] === next[k]) ? prev : next));
  }

  // Back to where the caret was. (Left alone when it's still there:
  // re-setting it would forget a style picked for the next words typed.)
  function restore() {
    const el = editRef.current;
    if (!el) return;
    const sel = window.getSelection();
    if (document.activeElement === el && sel.rangeCount && el.contains(sel.getRangeAt(0).startContainer)) return;
    el.focus({ preventScroll: true });
    const r = savedRangeRef.current;
    if (r && el.contains(r.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }

  function exec(cmd, value) {
    restore();
    try {
      document.execCommand("styleWithCSS", false, true);
      document.execCommand(cmd, false, value);
    } catch (err) {
      // nothing happened: fine
    }
    tidy();
    readBar();
  }

  // execCommand's font sizes are 1 to 7: "7" is used as a marker, then
  // swapped for the real size.
  function setSize(size) {
    const z = Math.max(6, Math.min(300, Math.round(size)));
    pendingSizeRef.current = z;
    exec("fontSize", "7");
  }

  function tidy() {
    const el = editRef.current;
    if (!el) return;
    clearHighlightMarks(el);
    const z = pendingSizeRef.current;
    if (!z) return;
    const marked = [...el.querySelectorAll('font[size="7"], span, font')].filter((n) => {
      if (n.tagName === "FONT" && n.getAttribute("size") === "7") return true;
      const fs = n.style && n.style.fontSize;
      return fs === "xxx-large" || fs === "-webkit-xxx-large";
    });
    for (const n of marked) {
      let target = n;
      if (n.tagName === "FONT") {
        target = document.createElement("span");
        if (n.getAttribute("color")) target.style.color = n.getAttribute("color");
        if (n.getAttribute("face")) target.style.fontFamily = n.getAttribute("face");
        while (n.firstChild) target.appendChild(n.firstChild);
        n.replaceWith(target);
      }
      target.style.fontSize = z + "px";
      for (const inner of target.querySelectorAll("[style]")) {
        if (inner.style.fontSize && !inner.closest("sup, sub, .rt-frac")) inner.style.fontSize = "";
      }
    }
  }

  function applyFont(name) {
    if (name) ensureFont(name, (fontsRef.current || []).find((f) => f.name === name)?.url);
    exec("fontName", name || BASE_FONT);
    setMenu(null);
    setQuery("");
  }

  async function pickFontFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file || !onUpload) return;
    const list = fontsRef.current || [];
    if (list.length >= MAX_CUSTOM_FONTS) {
      setNote(`You can keep ${MAX_CUSTOM_FONTS} fonts. Remove one in Settings first.`);
      return;
    }
    setBusy(true);
    setNote("Uploading…");
    try {
      const font = await onUpload(file, list.map((f) => f.name));
      setSetting("customFonts", [...list, font]);
      fontsRef.current = [...list, font];
      setNote("");
      applyFont(font.name);
      setBusy(false);
    } catch (err) {
      setNote((err && err.message) || "The font couldn't be uploaded.");
      setBusy(false);
    }
  }

  // ---------- typing ----------

  function onKeyDown(e) {
    const el = editRef.current;
    const sel = window.getSelection();
    if (e.key === "Escape") {
      e.preventDefault();
      if (menu) setMenu(null);
      else commit();
      return;
    }
    if (e.key === "Backspace" && changeRef.current) {
      const change = changeRef.current;
      changeRef.current = null;
      if (undoMaths(el, sel, change)) {
        e.preventDefault();
        readBar();
        return;
      }
    }
    if (e.key === "ArrowRight" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (arrowOut(el, sel)) {
        e.preventDefault();
        changeRef.current = null;
        return;
      }
    }
    if (e.key === "Tab") e.preventDefault();
    if (!e.key.startsWith("Arrow")) return;
    changeRef.current = null;
  }

  function onPaste(e) {
    e.preventDefault();
    const text = (e.clipboardData && e.clipboardData.getData("text/plain")) || "";
    if (text) document.execCommand("insertText", false, text.slice(0, 5000));
  }

  function onInput() {
    tidy();
    readBar();
    placeBar();
  }

  // Leaving the box (but not for its own bar, or while a file picker or the
  // colour picker has the screen) finishes it.
  function onBlur() {
    setTimeout(() => {
      if (doneRef.current || !document.hasFocus()) return;
      const root = rootRef.current;
      if (root && root.contains(document.activeElement)) return;
      commit();
    }, 0);
  }

  useImperativeHandle(handleRef, () => ({ place, commit }));

  // ---------- start ----------

  useEffect(() => {
    const el = editRef.current;
    if (!el) return;
    el.innerHTML = docToHtml(decodeText(raw), dark, info.fontSize || 24);
    ensureCustomFonts(fontsRef.current);
    const doc = decodeText(raw);
    if (doc.fx) for (const [fam, url] of Object.entries(doc.fx)) ensureFont(fam, url);
    for (const fam of familiesIn(doc)) ensureFont(fam);
    // The tap that opened this box is still being handled by the browser;
    // focusing straight away would lose to it, so a moment later.
    const timer = setTimeout(() => {
      el.focus();
      try {
        document.execCommand("defaultParagraphSeparator", false, "div");
        document.execCommand("styleWithCSS", false, true);
      } catch (err) {
        // older browsers: fine without
      }
      const sel = window.getSelection();
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
      readBar();
      placeBar();
    }, 0);
    const offFonts = subscribeFonts(() => setFontTick((n) => n + 1));
    return () => {
      clearTimeout(timer);
      offFonts();
    };
  }, []);

  // What the bar shows follows the caret / selection.
  useEffect(() => {
    function onSel() {
      const el = editRef.current;
      const sel = window.getSelection();
      if (!el || !sel || !sel.rangeCount) return;
      const r = sel.getRangeAt(0);
      if (!el.contains(r.startContainer)) return;
      savedRangeRef.current = r.cloneRange();
      readBar();
    }
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  // The bar's size changes with what it shows (and the screen with the keyboard).
  useEffect(() => {
    placeBar();
  });
  useEffect(() => {
    const vv = window.visualViewport;
    const on = () => placeBar();
    window.addEventListener("resize", on);
    if (vv) vv.addEventListener("resize", on);
    return () => {
      window.removeEventListener("resize", on);
      if (vv) vv.removeEventListener("resize", on);
    };
  }, []);

  // Maths as you type (a real "beforeinput", so phones' keyboards count too).
  useEffect(() => {
    const el = editRef.current;
    if (!el) return;
    function onBeforeInput(e) {
      if (e.inputType !== "insertText" || !e.data || e.isComposing || e.data.length !== 1 || !mathOnRef.current) {
        if (e.inputType !== "deleteContentBackward") changeRef.current = null;
        return;
      }
      const sel = window.getSelection();
      const change = typeMaths(el, sel, e.data);
      if (change) {
        e.preventDefault();
        changeRef.current = change.el ? change : null;
        readBar();
      } else {
        changeRef.current = null;
      }
    }
    el.addEventListener("beforeinput", onBeforeInput);
    return () => el.removeEventListener("beforeinput", onBeforeInput);
  }, []);

  // "Any colour": used once the colour picker is closed ("change", not
  // every step while choosing, which would close the picker).
  useEffect(() => {
    const input = colorInputRef.current;
    if (menu !== "color" || !input) return;
    function onChange() {
      exec("foreColor", inkOn(input.value, dark));
      setMenu(null);
    }
    input.addEventListener("change", onChange);
    return () => input.removeEventListener("change", onChange);
  }, [menu, dark]);

  // Bar buttons keep the caret in the text.
  const keep = (e) => e.preventDefault();

  const q = query.trim().toLowerCase();
  const groups = GOOGLE_FONTS.map(([label, names]) => [label, names.filter((n) => !q || n.toLowerCase().includes(q))]).filter(([, names]) => names.length);
  const mine = (customFonts || []).filter((f) => !q || f.name.toLowerCase().includes(q));
  const fontItem = (name, label) => (
    <button
      key={name || "default"}
      type="button"
      role="option"
      aria-selected={bar.font === name}
      className={`${s.item} ${bar.font === name ? s.itemOn : ""}`}
      style={name ? { fontFamily: `"${name}", ${BASE_FONT}` } : undefined}
      onPointerDown={keep}
      onPointerEnter={() => name && ensureFont(name, (customFonts || []).find((f) => f.name === name)?.url)}
      onFocus={() => name && ensureFont(name, (customFonts || []).find((f) => f.name === name)?.url)}
      onClick={() => applyFont(name)}
    >
      {label || name}
    </button>
  );

  return (
    <div ref={rootRef} className={s.root} style={{ visibility: "hidden" }} onBlur={onBlur} data-board-shortcuts="off">
      <div
        ref={editRef}
        className={s.edit}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Text box"
        spellCheck
        data-dark={dark ? "1" : "0"}
        style={{ width: info.width || 240, fontSize: info.fontSize || 24, color: baseColor, fontFamily: BASE_FONT }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onDrop={(e) => e.preventDefault()}
        onInput={onInput}
        onPointerDown={() => {
          changeRef.current = null;
          setMenu(null);
        }}
      />
      <div ref={barRef} className={s.bar}>
        <div className={s.row} role="toolbar" aria-label="Text style">
        <div className={s.group}>
          <button
            type="button"
            className={`${s.btn} ${s.fontBtn}`}
            aria-haspopup="listbox"
            aria-expanded={menu === "font"}
            aria-label={`Font: ${bar.font || "Default"}`}
            title="Font"
            onPointerDown={keep}
            onClick={() => setMenu(menu === "font" ? null : "font")}
            style={bar.font ? { fontFamily: `"${bar.font}", ${BASE_FONT}` } : undefined}
          >
            <span className={s.fontName}>{bar.font || "Default"}</span>
            <Chevron />
          </button>
        </div>
        <div className={s.group}>
          <button type="button" className={s.btn} title="Smaller" aria-label="Smaller" onPointerDown={keep} onClick={() => setSize(nextSize(bar.size, -1))}>
            <span aria-hidden="true">−</span>
          </button>
          <button
            type="button"
            className={`${s.btn} ${s.sizeBtn}`}
            title="Size"
            aria-label={`Size ${bar.size}`}
            aria-haspopup="listbox"
            aria-expanded={menu === "size"}
            onPointerDown={keep}
            onClick={() => setMenu(menu === "size" ? null : "size")}
          >
            {bar.size}
          </button>
          <button type="button" className={s.btn} title="Bigger" aria-label="Bigger" onPointerDown={keep} onClick={() => setSize(nextSize(bar.size, 1))}>
            <span aria-hidden="true">+</span>
          </button>
        </div>
        <div className={s.group}>
          <button type="button" className={`${s.btn} ${bar.b ? s.on : ""}`} aria-pressed={bar.b} aria-label="Bold" title="Bold (Ctrl/⌘+B)" onPointerDown={keep} onClick={() => exec("bold")}>
            <b>B</b>
          </button>
          <button type="button" className={`${s.btn} ${bar.i ? s.on : ""}`} aria-pressed={bar.i} aria-label="Italic" title="Italic (Ctrl/⌘+I)" onPointerDown={keep} onClick={() => exec("italic")}>
            <i style={{ fontFamily: "Georgia, serif" }}>I</i>
          </button>
          <button type="button" className={`${s.btn} ${bar.u ? s.on : ""}`} aria-pressed={bar.u} aria-label="Underline" title="Underline (Ctrl/⌘+U)" onPointerDown={keep} onClick={() => exec("underline")}>
            <u>U</u>
          </button>
        </div>
        <div className={s.group}>
          <button
            type="button"
            className={s.btn}
            title="Text colour"
            aria-label="Text colour"
            aria-expanded={menu === "color"}
            onPointerDown={keep}
            onClick={() => setMenu(menu === "color" ? null : "color")}
          >
            <span className={s.colorA}>
              A<span className={s.colorBar} style={{ background: bar.color || baseColor }} />
            </span>
          </button>
          <button
            type="button"
            className={s.btn}
            title="Highlight colour"
            aria-label="Highlight colour"
            aria-expanded={menu === "highlight"}
            onPointerDown={keep}
            onClick={() => setMenu(menu === "highlight" ? null : "highlight")}
          >
            <HighlightIcon />
          </button>
        </div>
        <div className={s.group}>
          {[
            ["l", "justifyLeft", "Align left"],
            ["c", "justifyCenter", "Centre"],
            ["r", "justifyRight", "Align right"],
          ].map(([a, cmd, label]) => (
            <button key={a} type="button" className={`${s.btn} ${bar.align === a ? s.on : ""}`} aria-pressed={bar.align === a} title={label} aria-label={label} onPointerDown={keep} onClick={() => exec(cmd)}>
              <AlignIcon a={a} />
            </button>
          ))}
        </div>
        <div className={s.group}>
          <button
            type="button"
            className={`${s.btn} ${s.mathBtn} ${mathOn ? s.on : ""}`}
            aria-pressed={!!mathOn}
            aria-label={mathOn ? "Maths as you type is on" : "Maths as you type is off"}
            title={mathOn ? "Maths as you type is on: x^2, x_2, 3/4" : "Maths as you type is off"}
            onPointerDown={keep}
            onClick={() => setSetting("mathText", !mathOn)}
          >
            x<sup>2</sup>
          </button>
        </div>
        </div>

        {menu === "font" && (
          <div data-menu className={`${s.menu} ${s.fontMenu}`}>
            <input
              className={s.search}
              type="search"
              placeholder="Search fonts"
              aria-label="Search fonts"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMenu(null);
                  restore();
                }
              }}
            />
            <div className={s.list} data-menu-list role="listbox" aria-label="Fonts">
              {!q && fontItem("", "Default")}
              {(mine.length > 0 || (canUpload && !q)) && <div className={s.groupLabel}>Your fonts</div>}
              {mine.map((f) => fontItem(f.name))}
              {canUpload && !q && (
                <button type="button" className={`${s.item} ${s.upload}`} disabled={busy} onPointerDown={keep} onClick={() => fileRef.current && fileRef.current.click()}>
                  + Upload a font (.ttf, .otf, .woff)
                </button>
              )}
              {note && <div className={s.note} role="status">{note}</div>}
              {groups.map(([label, names]) => (
                <div key={label}>
                  <div className={s.groupLabel}>{label}</div>
                  {names.map((n) => fontItem(n))}
                </div>
              ))}
              {!groups.length && !mine.length && <div className={s.note}>No fonts match.</div>}
            </div>
            <input ref={fileRef} type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" hidden onChange={pickFontFile} />
          </div>
        )}
        {menu === "size" && (
          <div data-menu className={`${s.menu} ${s.sizeMenu}`} role="listbox" aria-label="Sizes">
            {SIZES.map((z) => (
              <button
                key={z}
                type="button"
                role="option"
                aria-selected={bar.size === z}
                className={`${s.item} ${bar.size === z ? s.itemOn : ""}`}
                onPointerDown={keep}
                onClick={() => {
                  setSize(z);
                  setMenu(null);
                }}
              >
                {z}
              </button>
            ))}
          </div>
        )}
        {menu === "color" && (
          <div data-menu className={`${s.menu} ${s.swatchMenu}`}>
            {PEN_COLORS.map(([name, hex]) => {
              const shown = inkOn(hex, dark);
              return (
                <button
                  key={hex}
                  type="button"
                  className={s.swatch}
                  style={{ background: shown }}
                  title={shown !== hex && dark ? "White" : name}
                  aria-label={shown !== hex && dark ? "White" : name}
                  onPointerDown={keep}
                  onClick={() => {
                    exec("foreColor", shown);
                    setMenu(null);
                  }}
                />
              );
            })}
            <label className={s.custom} title="Any colour" onPointerDown={() => restore()}>
              <span aria-hidden="true">+</span>
              <input ref={colorInputRef} type="color" aria-label="Any colour" defaultValue={bar.color || "#1E88E5"} />
            </label>
          </div>
        )}
        {menu === "highlight" && (
          <div data-menu className={`${s.menu} ${s.swatchMenu}`}>
            {HIGHLIGHTS.map(([name, hex]) => (
              <button
                key={hex}
                type="button"
                className={s.swatch}
                style={{ background: hex }}
                title={name}
                aria-label={`${name} highlight`}
                onPointerDown={keep}
                onClick={() => {
                  exec("hiliteColor", rgbaOf(hex, 0.55));
                  setMenu(null);
                }}
              />
            ))}
            <button
              type="button"
              className={`${s.swatch} ${s.none}`}
              title="No highlight"
              aria-label="No highlight"
              onPointerDown={keep}
              onClick={() => {
                exec("hiliteColor", NO_HIGHLIGHT);
                setMenu(null);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function HighlightIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 11-6 6v3h9l3-3" />
      <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
    </svg>
  );
}

function AlignIcon({ a }) {
  const rows = a === "c" ? [[4, 20], [7, 17], [4, 20], [7, 17]] : a === "r" ? [[4, 20], [9, 20], [4, 20], [9, 20]] : [[4, 20], [4, 15], [4, 20], [4, 15]];
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      {rows.map(([x1, x2], k) => (
        <path key={k} d={`M${x1} ${6 + k * 4}H${x2}`} />
      ))}
    </svg>
  );
}
