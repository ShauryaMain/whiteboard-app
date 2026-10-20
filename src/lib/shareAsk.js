// "Know another teacher who'd like this?" after a real live class.
// Asked at most once every few weeks on this device, so it never nags.

const KEY = "cs_share_asked";
const GAP_MS = 21 * 24 * 60 * 60 * 1000; // three weeks

function readAsked() {
  try {
    return Number(window.localStorage.getItem(KEY)) || 0;
  } catch (err) {
    return 0;
  }
}

// Whether to ask now. Remembers that it asked.
export function askToShareNow(now = Date.now()) {
  if (typeof window === "undefined") return false;
  const last = readAsked();
  if (last && now - last < GAP_MS) return false;
  try {
    window.localStorage.setItem(KEY, String(now));
  } catch (err) {
    // storage off: ask this once anyway
  }
  return true;
}
