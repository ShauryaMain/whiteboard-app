// Keyboard shortcuts and touch gestures on a board.
//
// Keys are written as small strings: "p", "shift+p", "mod+z" (mod is Ctrl,
// or ⌘ on a Mac), "mod+shift+z", "space", "=", "?". Everyone starts with
// DEFAULT_KEYS; Settings ▸ Shortcuts keeps only the ones a person changed
// (the "shortcuts" setting: { action: key, or "" for none }).
//
// They never fire while someone is typing (a text box, the calculator…):
// see the keyboard handler in Whiteboard.js.
//
// Gestures (touch screens, the way Notability does it): tap the board with
// two fingers or with three, without moving them. What each does is in
// Settings too ("gesture2" / "gesture3").

export const SHORTCUT_ACTIONS = [
  { id: "pen", label: "Pen", key: "p", group: "Tools" },
  { id: "highlighter", label: "Highlighter", key: "h", group: "Tools" },
  { id: "eraser", label: "Eraser", key: "e", group: "Tools" },
  { id: "select", label: "Select", key: "v", group: "Tools" },
  { id: "text", label: "Text", key: "t", group: "Tools" },
  { id: "move", label: "Move tool", key: "m", group: "Tools" },
  { id: "holdMove", label: "Hold to move the board", key: "space", group: "Tools" },
  { id: "ruler", label: "Ruler on / off", key: "r", group: "Tools" },
  { id: "undo", label: "Undo", key: "mod+z", group: "Edit" },
  { id: "redo", label: "Redo", key: "mod+shift+z", group: "Edit" },
  { id: "zoomIn", label: "Zoom in", key: "=", group: "View" },
  { id: "zoomOut", label: "Zoom out", key: "-", group: "View" },
  { id: "zoomReset", label: "Back to 100%", key: "0", group: "View" },
  { id: "help", label: "Show the shortcuts", key: "?", group: "View" },
  { id: "goto", label: "Go to a notebook or board", key: "mod+k", group: "View" },
];

export const ACTION_IDS = SHORTCUT_ACTIONS.map((a) => a.id);
export const DEFAULT_KEYS = Object.fromEntries(SHORTCUT_ACTIONS.map((a) => [a.id, a.key]));

// Always there, not changeable (what everyone expects from any app).
export const FIXED_SHORTCUTS = [
  ["mod+c", "Copy"],
  ["mod+x", "Cut"],
  ["mod+v", "Paste"],
  ["mod+d", "Duplicate"],
  ["mod+a", "Select everything"],
  ["delete", "Delete what's selected"],
  ["escape", "Deselect"],
  ["1–7", "Pen colours (black, red, orange, green, blue, purple, teal)"],
];

// Keys that can't be given to an action: the fixed ones above, the colour
// digits, and ones the browser keeps for itself.
const RESERVED = new Set([
  "mod+c", "mod+x", "mod+v", "mod+d", "mod+a", "delete", "backspace", "escape", "tab", "enter",
  "1", "2", "3", "4", "5", "6", "7",
  "mod+w", "mod+t", "mod+n", "mod+q", "mod+r", "mod+l", "mod+p", "mod+s", "mod+f", "mod+shift+t", "mod+shift+n",
]);

const NAMED = { " ": "space", spacebar: "space", arrowleft: "left", arrowright: "right", arrowup: "up", arrowdown: "down", del: "delete", esc: "escape" };
const MODIFIER_KEYS = new Set(["shift", "control", "alt", "meta", "os", "capslock", "fn", "altgraph", "dead", "process", "unidentified"]);

// The key a keydown means, as a shortcut string (null for a lone Shift etc.).
export function keyFromEvent(e) {
  let k = String(e.key || "").toLowerCase();
  if (NAMED[k]) k = NAMED[k];
  if (k === "+") k = "="; // Shift+= (and the keypad +): zoom in, like =
  if (!k || MODIFIER_KEYS.has(k)) return null;
  // keypad and shifted symbols: "+" on its own means zoom in, like "="
  const letter = /^[a-z]$/.test(k);
  const named = k.length > 1; // space, left, f2…
  const parts = [];
  if (e.metaKey || e.ctrlKey) parts.push("mod");
  if (e.altKey) parts.push("alt");
  // Shift only counts with letters and named keys: "?" is already Shift+/
  if (e.shiftKey && (letter || named)) parts.push("shift");
  parts.push(k);
  return parts.join("+");
}

export function isValidKey(key) {
  if (typeof key !== "string" || key.length > 24) return false;
  if (key === "") return true;
  const parts = key.split("+");
  const last = key.endsWith("++") ? "+" : parts[parts.length - 1];
  if (!last) return false;
  const mods = key.endsWith("++") ? parts.slice(0, -2) : parts.slice(0, -1);
  if (!mods.every((m) => m === "mod" || m === "alt" || m === "shift")) return false;
  return last.length === 1 || /^[a-z][a-z0-9]{1,9}$/.test(last);
}

export function isReserved(key) {
  return RESERVED.has(key);
}

// A person's changes, tidied (for the settings check).
export function isValidOverrides(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const entries = Object.entries(v);
  return entries.length <= ACTION_IDS.length && entries.every(([id, key]) => ACTION_IDS.includes(id) && isValidKey(key) && !isReserved(key));
}

// action -> key, with a person's changes on top of the defaults
export function keysWith(overrides) {
  const out = { ...DEFAULT_KEYS };
  for (const [id, key] of Object.entries(overrides || {})) if (ACTION_IDS.includes(id)) out[id] = key;
  return out;
}

export function actionForKey(key, keys) {
  if (!key) return null;
  const alias = key === "+" ? "=" : key === "shift+=" ? "=" : key;
  for (const id of ACTION_IDS) if (keys[id] && (keys[id] === key || keys[id] === alias)) return id;
  return null;
}

// Gives an action a new key (or "" for none). Whatever had that key before
// loses it. Returns the new changes, and which action lost its key.
export function assignKey(overrides, action, key) {
  const keys = keysWith(overrides);
  const next = { ...(overrides || {}) };
  let displaced = null;
  if (key) {
    for (const id of ACTION_IDS) {
      if (id !== action && keys[id] === key) {
        displaced = id;
        next[id] = "";
      }
    }
  }
  next[action] = key;
  // keep only real changes
  for (const id of Object.keys(next)) if (next[id] === DEFAULT_KEYS[id]) delete next[id];
  return { overrides: next, displaced };
}

export function isMacLike() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || "") || /Mac OS X/.test(navigator.userAgent || "");
}

// How a key is shown: "⌘⇧Z" on a Mac, "Ctrl+Shift+Z" elsewhere, "Space", "P".
export function keyLabel(key, mac = isMacLike()) {
  if (!key) return "";
  if (key === "1–7") return "1–7";
  const plus = key.endsWith("++");
  const parts = plus ? [...key.slice(0, -2).split("+").filter(Boolean), "+"] : key.split("+");
  const last = parts.pop();
  const names = { space: "Space", left: "←", right: "→", up: "↑", down: "↓", delete: "Delete", backspace: "Backspace", escape: "Esc", enter: "Enter", tab: "Tab" };
  const main = names[last] || (last.length === 1 ? last.toUpperCase() : last.charAt(0).toUpperCase() + last.slice(1));
  if (mac) {
    const sym = { mod: "⌘", alt: "⌥", shift: "⇧" };
    return parts.map((p) => sym[p] || p).join("") + main;
  }
  const word = { mod: "Ctrl", alt: "Alt", shift: "Shift" };
  return [...parts.map((p) => word[p] || p), main].join("+");
}

// ---------- gestures ----------

export const GESTURE_ACTIONS = [
  ["none", "Nothing"],
  ["undo", "Undo"],
  ["redo", "Redo"],
  ["swap", "Pen ⇄ eraser"],
];
export const GESTURE_IDS = GESTURE_ACTIONS.map(([id]) => id);
export const GESTURE_WORDS = { undo: "Undo", redo: "Redo", swap: "Swapped tool" };

// Spots a quick tap with two or more fingers: every finger down and up
// again within `maxMs`, none of them moving more than `slop` pixels.
// onTap(fingers) is called when the last finger lifts.
export function createTapGesture({ onTap = null, maxMs = 350, slop = 14 } = {}) {
  let s = null;
  let handler = onTap;
  return {
    setHandler(fn) {
      handler = fn;
    },
    down(id, x, y, t) {
      if (!s) s = { start: t, max: 0, pts: new Map(), active: new Set(), moved: false };
      s.pts.set(id, { x, y });
      s.active.add(id);
      s.max = Math.max(s.max, s.active.size);
    },
    move(id, x, y) {
      if (!s) return;
      const p = s.pts.get(id);
      if (p && Math.hypot(x - p.x, y - p.y) > slop) s.moved = true;
    },
    up(id, t) {
      if (!s || !s.active.has(id)) return;
      s.active.delete(id);
      if (s.active.size) return;
      const done = s;
      s = null;
      if (!done.moved && done.max >= 2 && t - done.start <= maxMs && handler) handler(done.max);
    },
    cancel() {
      s = null;
    },
    active() {
      return !!s;
    },
  };
}
