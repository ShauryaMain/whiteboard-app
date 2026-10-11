// Remembers, for the length of this tab, that a sign-in was just started
// and how (Google or an emailed code, and from where), so it can be counted
// once the person lands signed in (see AuthContext.js and track.js).
// Signing in with Google may leave the page and come back, so it's kept
// in session storage.

const KEY = "cleanslate_signin_pending";

export function noteSignInStarted(method, from) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ method, from: from || "signin_page", at: Date.now() }));
  } catch (err) {
    // storage switched off: it just isn't counted
  }
}

// The sign-in started in the last half hour, if any (and forgets it).
export function takePendingSignIn() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const note = JSON.parse(raw);
    if (!note || Date.now() - (note.at || 0) > 30 * 60 * 1000) return null;
    return { method: String(note.method || "unknown"), from: String(note.from || "signin_page") };
  } catch (err) {
    return null;
  }
}
