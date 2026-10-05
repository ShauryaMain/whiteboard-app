// How the student's class page is laid out: the size of the screen (which
// decides whether there is room to show the teacher's board and their own
// board together) and what they chose last time. Tiny stores, read with
// useSyncExternalStore: the server render gets fixed defaults and the real
// values take over once the page is in the browser.

const VIEW_KEY = "cleanslate_class_view"; // "both" when they last used both boards together
const SPLIT_KEY = "cleanslate_class_split_"; // + "side" | "stacked": the teacher's share of the space

// The teacher's board gets a little under half: the student's own board
// has a toolbar to fit in (at this share the whole tool row fits on a
// 1024-wide tablet).
export const DEFAULT_CLASS_SPLIT = 0.44;

// ---------- screen size ----------

function measure() {
  return `${window.innerWidth}x${window.innerHeight}`;
}

export function subscribeScreen(listener) {
  window.addEventListener("resize", listener);
  window.addEventListener("orientationchange", listener);
  return () => {
    window.removeEventListener("resize", listener);
    window.removeEventListener("orientationchange", listener);
  };
}

// Measured every time it is asked for (it is a short piece of text, so two
// readings of the same size are equal): never out of date, even if the
// window was resized while nothing was listening.
export function getScreen() {
  return measure();
}

export function getServerScreen() {
  return "1024x768";
}

// Is there room for both boards at once, and which way round?
//   "side"     next to each other (laptops, tablets held sideways)
//   "stacked"  one above the other (tablets held upright)
//   null       not enough room (phones): one board at a time
export function splitModeFor(screen) {
  const [width, height] = String(screen).split("x").map(Number);
  if (width >= 900 && height >= 480) return "side";
  if (width >= 600 && height >= 820) return "stacked";
  return null;
}

// ---------- what they chose ----------

const memory = {};
const listeners = new Set();

function recall(key) {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored !== null) return stored;
  } catch (err) {
    // storage switched off: this visit's choice still works
  }
  return memory[key] === undefined ? null : memory[key];
}

function remember(key, value) {
  memory[key] = value;
  try {
    window.localStorage.setItem(key, value);
  } catch (err) {
    // as above
  }
  listeners.forEach((l) => l());
}

export function subscribeClassLayout(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPrefersBoth() {
  return recall(VIEW_KEY) === "both";
}

export function getServerPrefersBoth() {
  return false;
}

export function setPrefersBoth(both) {
  remember(VIEW_KEY, both ? "both" : "one");
}

function splitOf(mode) {
  const value = Number(recall(SPLIT_KEY + mode));
  return Number.isFinite(value) && value > 0.1 && value < 0.9 ? value : DEFAULT_CLASS_SPLIT;
}

export function getClassSplitSide() {
  return splitOf("side");
}

export function getClassSplitStacked() {
  return splitOf("stacked");
}

export function getServerClassSplit() {
  return DEFAULT_CLASS_SPLIT;
}

export function setClassSplit(mode, value) {
  remember(SPLIT_KEY + mode, String(value));
}
