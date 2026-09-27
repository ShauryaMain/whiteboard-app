// Per-device drawing preferences, kept in localStorage and exposed as a
// tiny external store so components read them with useSyncExternalStore —
// the server render always sees the defaults (no hydration mismatch) and the
// real saved values take over right after.
//
// - pencilOnly: when on, only a stylus draws; fingers can still select,
//   place text and pan/zoom with two fingers. Turned on automatically the
//   first time a pen is used on this device (unless the user has already
//   chosen), and can be switched off from the toolbar.
// - penSeen: whether a stylus has ever been used here — the Pencil-only
//   switch is only shown on devices that actually have one.

const KEY_PENCIL_ONLY = "whiteboard_pencil_only"; // "1" | "0" | absent (not decided yet)
const KEY_PEN_SEEN = "whiteboard_pen_seen";

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
    // Private browsing etc. — the in-memory copy still works for this visit.
  }
  listeners.forEach((listener) => listener());
}

export function subscribePencilPrefs(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPencilOnly() {
  return read(KEY_PENCIL_ONLY) === "1";
}

export function getPenSeen() {
  return read(KEY_PEN_SEEN) === "1";
}

export function getServerPrefSnapshot() {
  return false;
}

export function isPencilOnlyUndecided() {
  return read(KEY_PENCIL_ONLY) === null;
}

export function setPencilOnly(on) {
  write(KEY_PENCIL_ONLY, on ? "1" : "0");
}

export function markPenSeen() {
  if (read(KEY_PEN_SEEN) !== "1") write(KEY_PEN_SEEN, "1");
}
