// The copy of a visitor's demo board kept in this browser.
//
// The demo board itself lives in the tab's memory (demoBackend.js). As the
// visitor works, a copy is kept here, so that:
//   - coming back to the demo later opens their board where they left it,
//   - signing in (from the demo, or later from the landing page) saves it
//     into their new account (demoCarry.js, DemoCarryOver.js).
//
// Besides the board, the copy has:
//   startedAt  when this demo board was first opened (tells one demo board
//              from another)
//   keepAt     when they pressed a "keep it" button, if they did. A board
//              they asked to keep within the last hour is carried into
//              whatever account they sign in to. Otherwise it's only carried
//              into a brand-new account made after the board was started
//              (see shouldCarry in demoCarry.js).
//   kind       "class", "tutor" or "explore"
//   next       what to show once it opens ("class": point at Start live
//              class)
//
// No imports on purpose: both the demo backend and the real app use this.

export const DEMO_STASH_KEY = "cleanslate_demo_carry";
// how long a kept demo board waits in this browser (if the browser keeps it
// that long: Safari clears a site's storage after about a week away)
export const DEMO_STASH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// how long a "keep it" press counts for (time to finish signing in)
export const KEEP_WINDOW_MS = 60 * 60 * 1000;
const CARRIED_KEY = "cleanslate_demo_carried";

function storage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch (err) {
    return null; // storage switched off
  }
}

function valid(stored) {
  return !!stored && stored.version === 1 && Array.isArray(stored.strokes) && Array.isArray(stored.texts);
}

export function readDemoStash() {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(DEMO_STASH_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw);
    if (!valid(stored) || Date.now() - (stored.savedAt || 0) > DEMO_STASH_MAX_AGE_MS) {
      store.removeItem(DEMO_STASH_KEY);
      return null;
    }
    return stored;
  } catch (err) {
    return null;
  }
}

// Keeps a copy. Returns true if it was kept (false when this browser's
// storage is full or switched off).
export function writeDemoStash(snapshot) {
  const store = storage();
  if (!store || !valid(snapshot)) return false;
  try {
    store.setItem(DEMO_STASH_KEY, JSON.stringify({ ...snapshot, savedAt: Date.now() }));
    return true;
  } catch (err) {
    return false;
  }
}

export function clearDemoStash() {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(DEMO_STASH_KEY);
  } catch (err) {
    // nothing to do
  }
}

// When this copy's demo board was first opened. (Copies kept before this
// was recorded use the time they were kept.)
export function stashStartedAt(stored) {
  if (!stored) return 0;
  return Number.isFinite(stored.startedAt) ? stored.startedAt : stored.savedAt || 0;
}

// When they asked to keep it (0 if they didn't). Copies from before
// startedAt was recorded were only ever made by the "keep" button.
export function stashKeepAt(stored) {
  if (!stored) return 0;
  if (Number.isFinite(stored.keepAt)) return stored.keepAt;
  return Number.isFinite(stored.startedAt) ? 0 : stored.savedAt || 0;
}

// True if they pressed "keep it" recently enough to still count.
export function keepRequested(stored, now = Date.now()) {
  const at = stashKeepAt(stored);
  return at > 0 && now - at < KEEP_WINDOW_MS;
}

// Demo boards already saved into an account (by startedAt), so the same
// board is never saved twice (from a second tab, or a page brought back
// with the browser's Back button).
export function markCarried(startedAt) {
  const store = storage();
  if (!store || !startedAt) return;
  try {
    const list = carriedList(store).filter((t) => t !== startedAt);
    list.push(startedAt);
    store.setItem(CARRIED_KEY, JSON.stringify(list.slice(-10)));
  } catch (err) {
    // nothing to do
  }
}

export function wasCarried(startedAt) {
  const store = storage();
  if (!store || !startedAt) return false;
  return carriedList(store).includes(startedAt);
}

function carriedList(store) {
  try {
    const list = JSON.parse(store.getItem(CARRIED_KEY) || "[]");
    return Array.isArray(list) ? list.filter(Number.isFinite) : [];
  } catch (err) {
    return [];
  }
}

// What the visitor told the demo's opening question ("class", "tutor",
// "explore"), kept for the screens after sign-in.
const PERSONA_KEY = "cleanslate_persona";

export function rememberPersona(kind) {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(PERSONA_KEY, kind);
  } catch (err) {
    // nothing to do
  }
}

export function readPersona() {
  const store = storage();
  if (!store) return null;
  try {
    return store.getItem(PERSONA_KEY);
  } catch (err) {
    return null;
  }
}
