// "Quiz me": every piece of tape on a page is covered, then they're shown
// one at a time. For each one, say whether you knew what was under it.
// At the end: how many you knew, and a go at just the ones you missed.
//
// How you did is kept on this device only (nothing is saved to the
// notebook or sent to anyone): the last go and the best, per page.
//
// Pure functions, plus the small store for the tally.

// A new go. `ids`: the pieces of tape, in the order to ask them.
export function startQuiz(pageId, ids) {
  return { pageId, ids: [...ids], at: 0, shown: false, right: [], missed: [], done: ids.length === 0 };
}

export function currentTape(quiz) {
  return quiz && !quiz.done ? quiz.ids[quiz.at] || null : null;
}

// The current piece of tape has been shown.
export function showAnswer(quiz) {
  if (!quiz || quiz.done) return quiz;
  return { ...quiz, shown: true };
}

// "I knew it" (true) or "I didn't" (false): on to the next one.
export function markAnswer(quiz, knew) {
  if (!quiz || quiz.done) return quiz;
  const id = quiz.ids[quiz.at];
  const right = knew ? [...quiz.right, id] : quiz.right;
  const missed = knew ? quiz.missed : [...quiz.missed, id];
  const at = quiz.at + 1;
  return { ...quiz, right, missed, at, shown: false, done: at >= quiz.ids.length };
}

// The pieces that have gone away since the go started (deleted, or their
// page removed) are skipped.
export function dropMissing(quiz, existing) {
  if (!quiz || quiz.done) return quiz;
  const has = (id) => existing.has(id);
  const ids = quiz.ids.filter((id, i) => i < quiz.at || has(id));
  const at = Math.min(quiz.at, ids.length);
  if (ids.length === quiz.ids.length) return quiz;
  return { ...quiz, ids, at, done: at >= ids.length };
}

// ---------- how you did, on this device ----------

const KEY = "cleanslate_quiz_v1";
const MAX_PAGES_KEPT = 300;

function readAll() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const all = raw ? JSON.parse(raw) : {};
    return all && typeof all === "object" ? all : {};
  } catch (err) {
    return {};
  }
}

// { last: { right, total, at }, best: { right, total } } or null.
export function readTally(boardId, pageId) {
  const entry = readAll()[`${boardId}:${pageId}`];
  return entry && entry.last ? entry : null;
}

export function saveTally(boardId, pageId, right, total) {
  if (!total) return;
  try {
    const all = readAll();
    const key = `${boardId}:${pageId}`;
    const prev = all[key];
    const best = prev && prev.best && prev.best.right / prev.best.total >= right / total ? prev.best : { right, total };
    all[key] = { last: { right, total, at: Date.now() }, best };
    // only the most recent pages are kept
    const keys = Object.keys(all);
    if (keys.length > MAX_PAGES_KEPT) {
      keys
        .sort((a, b) => ((all[a].last && all[a].last.at) || 0) - ((all[b].last && all[b].last.at) || 0))
        .slice(0, keys.length - MAX_PAGES_KEPT)
        .forEach((k) => delete all[k]);
    }
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch (err) {
    // storage full or switched off: the tally just isn't kept
  }
}
