// Window width (for switching the reference pane between side-by-side and
// stacked) and the reference pane's remembered size, both as tiny external
// stores for useSyncExternalStore — the server render gets fixed defaults,
// the real values take over after hydration, and nothing reads the window
// during render.

export const DEFAULT_REF_FRACTION = 0.4;
const KEYS = { side: "whiteboard_ref_fraction_side", stacked: "whiteboard_ref_fraction_stacked" };

// ---------- viewport width ----------

export function subscribeViewport(listener) {
  window.addEventListener("resize", listener);
  window.addEventListener("orientationchange", listener);
  return () => {
    window.removeEventListener("resize", listener);
    window.removeEventListener("orientationchange", listener);
  };
}

export function getViewportWidth() {
  return window.innerWidth;
}

export function getServerViewportWidth() {
  return 1024;
}

// ---------- reference pane size (fraction of the work area) ----------

const memory = {};
const listeners = new Set();

export function subscribeRefFraction(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function read(mode) {
  let raw = memory[mode];
  try {
    const stored = window.localStorage.getItem(KEYS[mode]);
    if (stored !== null) raw = stored;
  } catch (err) {
    // storage blocked — fall back to this visit's in-memory value
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0.05 && value < 0.95 ? value : DEFAULT_REF_FRACTION;
}

export function getRefFractionSide() {
  return read("side");
}

export function getRefFractionStacked() {
  return read("stacked");
}

export function getServerRefFraction() {
  return DEFAULT_REF_FRACTION;
}

export function setRefFraction(mode, value) {
  memory[mode] = String(value);
  try {
    window.localStorage.setItem(KEYS[mode], String(value));
  } catch (err) {
    // ignore — in-memory copy still works for this visit
  }
  listeners.forEach((listener) => listener());
}
