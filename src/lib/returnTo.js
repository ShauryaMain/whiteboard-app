// Where to go back to once signed in.
//
// Signing in with Google can come back to the home page rather than the
// page the person was on (a notebook opened from its link, say). The page
// is noted here first; the home page takes it once they're signed in and
// goes back there. A note is only good for a short while, and only for a
// page on this site.

const KEY = "cleanslate_return_to";
const GOOD_FOR_MS = 30 * 60 * 1000;

function store() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch (err) {
    return null;
  }
}

// Only a path on this site ("/n/abc"), never another address.
export function safeReturnPath(path) {
  const p = String(path || "");
  return /^\/(?!\/)[A-Za-z0-9/_\-?=&.%]*$/.test(p) && p.length < 300 ? p : null;
}

export function rememberReturn(path) {
  const s = store();
  const p = safeReturnPath(path);
  if (!s || !p) return;
  try {
    s.setItem(KEY, JSON.stringify({ path: p, at: Date.now() }));
  } catch (err) {
    // storage full or switched off: they just land on the home page
  }
}

// The page to go back to (and forgets it), or null.
export function takeReturn() {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return null;
    s.removeItem(KEY);
    const saved = JSON.parse(raw);
    if (!saved || Date.now() - (Number(saved.at) || 0) > GOOD_FOR_MS) return null;
    return safeReturnPath(saved.path);
  } catch (err) {
    return null;
  }
}
