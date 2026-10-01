// Per-device ink preferences (same tiny-store pattern as pencilPrefs.js):
// - eraserMode: "precise" rubs out only where you drag; "stroke" removes
//   any whole line it touches.
// - scribbleErase: scribbling back and forth over ink erases it.

const KEY_ERASER_MODE = "cleanslate_eraser_mode";
const KEY_SCRIBBLE = "cleanslate_scribble_erase";

const memory = {};
const listeners = new Set();

function read(key) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? (memory[key] ?? null) : value;
  } catch (err) {
    return memory[key] ?? null;
  }
}

function write(key, value) {
  memory[key] = value;
  try {
    window.localStorage.setItem(key, value);
  } catch (err) {
    // storage blocked — the in-memory copy still works for this visit
  }
  listeners.forEach((listener) => listener());
}

export function subscribeInkPrefs(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getEraserMode() {
  return read(KEY_ERASER_MODE) === "stroke" ? "stroke" : "precise";
}

export function getServerEraserMode() {
  return "precise";
}

export function setEraserMode(mode) {
  write(KEY_ERASER_MODE, mode === "stroke" ? "stroke" : "precise");
}

export function getScribbleErase() {
  return read(KEY_SCRIBBLE) !== "0";
}

export function getServerScribbleErase() {
  return true;
}

export function setScribbleErase(on) {
  write(KEY_SCRIBBLE, on ? "1" : "0");
}
