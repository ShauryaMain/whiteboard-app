// The notebooks and boards someone opened last, on this device (for the
// "Recent" menu and the Go to box). Kept per account, so a shared computer
// doesn't show one person's notebooks to the next.

const KEY = "cleanslate_recent_";
const MAX = 8;
const ID_RE = /^[0-9a-f-]{36}$/i;

function store() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch (err) {
    return null;
  }
}

export function recentList(userId) {
  const s = store();
  if (!s || !userId) return [];
  try {
    const list = JSON.parse(s.getItem(KEY + userId) || "[]");
    return Array.isArray(list)
      ? list.filter((r) => r && ID_RE.test(r.id) && (r.kind === "notebook" || r.kind === "board")).slice(0, MAX)
      : [];
  } catch (err) {
    return [];
  }
}

export function rememberRecent(userId, { id, name, kind }) {
  const s = store();
  if (!s || !userId || !ID_RE.test(String(id || ""))) return;
  const entry = { id, name: String(name || "").slice(0, 80), kind: kind === "notebook" ? "notebook" : "board", at: Date.now() };
  const list = [entry, ...recentList(userId).filter((r) => r.id !== id)].slice(0, MAX);
  try {
    s.setItem(KEY + userId, JSON.stringify(list));
  } catch (err) {
    // storage full or switched off: no recent list
  }
}

export function forgetRecent(userId, id) {
  const s = store();
  if (!s || !userId) return;
  try {
    s.setItem(KEY + userId, JSON.stringify(recentList(userId).filter((r) => r.id !== id)));
  } catch (err) {
    // as above
  }
}
