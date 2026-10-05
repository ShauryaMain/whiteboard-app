// What a student has signalled in a live class (hand up, "I'm done"), and
// whether the class has ended. Kept per class code for as long as the tab
// is open, so a refresh doesn't quietly put a hand down or bring an ended
// class back. A tiny store, read with useSyncExternalStore.

const KEY = "classroom_status_"; // + class code, in sessionStorage
const SERVER_STATUS = { hand: false, handAt: 0, done: false, ended: false };
const cache = new Map(); // class code -> status
const listeners = new Set();

function read(code) {
  try {
    const raw = window.sessionStorage.getItem(KEY + code);
    const saved = raw ? JSON.parse(raw) : null;
    if (saved && typeof saved === "object") {
      return { hand: !!saved.hand, handAt: Number(saved.handAt) || 0, done: !!saved.done, ended: !!saved.ended };
    }
  } catch (err) {
    // storage switched off: start from nothing
  }
  return { ...SERVER_STATUS };
}

export function subscribeClassStatus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getClassStatus(code) {
  const key = String(code || "").toUpperCase();
  if (!cache.has(key)) cache.set(key, read(key));
  return cache.get(key);
}

// On the server (and for the first paint) nothing is known yet.
export function getServerClassStatus() {
  return SERVER_STATUS;
}

export function setClassStatus(code, changes) {
  const key = String(code || "").toUpperCase();
  const current = getClassStatus(key);
  const next = { ...current, ...changes };
  if (next.hand === current.hand && next.done === current.done && next.ended === current.ended && next.handAt === current.handAt) return;
  cache.set(key, next);
  try {
    window.sessionStorage.setItem(KEY + key, JSON.stringify(next));
  } catch (err) {
    // not remembered across a refresh, that's all
  }
  listeners.forEach((l) => l());
}
