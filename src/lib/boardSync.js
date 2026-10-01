// Keeps a board's on-screen contents and the database in step.
//
// 1. Loading: Supabase returns at most 1,000 rows per request (the "Max
//    rows" API setting), so a long lesson with more strokes than that used
//    to load only the first 1,000. fetchAllRows() pages through everything.
// 2. Catching up (after a reconnect or an idle pause) merges what the
//    server has into what's on screen instead of replacing it, so work that
//    is still saving, or was drawn a moment ago, is never wiped.
// 3. Saving: a save that fails because of the network or an expired login
//    is kept and retried, instead of the stroke silently never reaching
//    the database (and then "disappearing" on the next load).

import { supabase } from "./supabaseClient";

const PAGE = 1000;
const RECENT_MS = 60 * 1000; // anything seen/removed this recently is trusted locally
const MAX_ATTEMPTS = 25;

// ---------- loading ----------

// makeQuery(withCount) must return a fresh, filtered + ordered query.
export async function fetchAllRows(makeQuery) {
  const rows = [];
  let total = null;
  let from = 0;
  for (let guard = 0; guard < 500; guard++) {
    let result;
    try {
      result = await makeQuery(total === null).range(from, from + PAGE - 1);
    } catch (err) {
      return { rows, error: err };
    }
    const { data, error, count } = result;
    if (error) return { rows, error };
    const page = Array.isArray(data) ? data : [];
    if (total === null) total = typeof count === "number" ? count : -1;
    rows.push(...page);
    from += page.length;
    if (!page.length) break;
    if (total >= 0 && rows.length >= total) break;
    if (total < 0 && page.length < PAGE) break;
  }
  return { rows, error: null };
}

function ordered(query) {
  return query.order("created_at", { ascending: true }).order("id", { ascending: true });
}

export function rowToText(r) {
  return {
    id: r.id,
    x: r.x,
    y: r.y,
    text: r.text,
    color: r.color,
    fontSize: r.font_size,
    width: r.width || 240,
    rotation: r.rotation || 0,
  };
}

const PARTS = {
  strokes: { columns: "id, data", map: (r) => ({ ...r.data, id: r.id }), label: "strokes" },
  texts: { columns: "id, x, y, text, color, font_size, width, rotation", map: rowToText, label: "texts" },
  images: {
    columns: "id, x, y, width, height, src",
    map: (r) => ({ id: r.id, x: r.x, y: r.y, width: r.width, height: r.height, src: r.src }),
    label: "images",
  },
};

// One kind of board content (all of it). null when it couldn't be loaded,
// so the caller leaves that part of the screen alone.
export async function fetchBoardPart(boardId, kind) {
  const part = PARTS[kind];
  const { rows, error } = await fetchAllRows((withCount) =>
    ordered(supabase.from(kind).select(part.columns, withCount ? { count: "exact" } : undefined).eq("board_id", boardId))
  );
  if (error) {
    if (kind === "images") console.warn("Could not load images (has the images table been created yet?):", error);
    else console.error(`Error loading ${part.label}:`, error);
    return null;
  }
  return rows.map(part.map);
}

export async function fetchBoardContents(boardId) {
  const [strokes, texts, images] = await Promise.all([
    fetchBoardPart(boardId, "strokes"),
    fetchBoardPart(boardId, "texts"),
    fetchBoardPart(boardId, "images"),
  ]);
  return { strokes, texts, images };
}

// The board's own settings, for catching up after time away.
export async function fetchBoardSettings(boardId) {
  try {
    const { data, error } = await supabase.from("boards").select("*").eq("id", boardId).maybeSingle();
    if (error || !data) return null;
    return data;
  } catch (err) {
    return null;
  }
}

// Marks a board as in use, so the inactive-board clean-up leaves it alone.
// Quietly does nothing until the clean-up SQL has been run.
export async function touchBoard(boardId) {
  try {
    await supabase.rpc("touch_board", { p_board_id: String(boardId) });
  } catch (err) {
    // optional feature — never block the board over it
  }
}

// ---------- tracking what's on screen ----------

export function createSyncTracker() {
  return {
    pending: new Map(), // id -> number of saves in flight
    failed: new Map(), // id -> { table, row, attempts }
    seenAt: new Map(), // id -> when it first appeared on this screen
    removedAt: new Map(), // id -> when it last left this screen
    lastIds: { strokes: new Set(), texts: new Set(), images: new Set() },
    listeners: new Set(),
    exists: null, // set by the board: (id) => is it still on screen?
    retryTimer: null,
    retrying: false,
  };
}

// Call whenever a list changes; records arrivals and removals.
export function noteList(tracker, kind, list) {
  const now = Date.now();
  const next = new Set();
  for (const o of list) {
    next.add(o.id);
    if (!tracker.lastIds[kind].has(o.id)) {
      tracker.seenAt.set(o.id, now);
      tracker.removedAt.delete(o.id);
    }
  }
  for (const id of tracker.lastIds[kind]) {
    if (!next.has(id)) tracker.removedAt.set(id, now);
  }
  tracker.lastIds[kind] = next;
}

// Server list + what's on screen -> what should be on screen.
// `since` is when the fetch started (minus a little grace).
export function mergeServerList(local, server, tracker, since) {
  const localById = new Map();
  for (const o of local) localById.set(o.id, o);
  const serverIds = new Set();
  const out = [];
  for (const o of server) {
    serverIds.add(o.id);
    const removed = tracker.removedAt.get(o.id);
    // Rubbed out here moments ago and the delete just hasn't landed yet.
    if (!localById.has(o.id) && removed && removed >= since) continue;
    const mine = localById.get(o.id);
    out.push(mine && tracker.pending.has(o.id) ? mine : o);
  }
  for (const o of local) {
    if (serverIds.has(o.id)) continue;
    const seen = tracker.seenAt.get(o.id) || 0;
    if (tracker.pending.has(o.id) || tracker.failed.has(o.id) || seen >= since) out.push(o);
  }
  // Nothing changed? Keep the same array so React skips a redraw.
  if (out.length === local.length && out.every((o, i) => o === local[i])) return local;
  return out;
}

export function syncSince(fetchStartedAt) {
  return fetchStartedAt - RECENT_MS;
}

// ---------- saving ----------

function emit(tracker) {
  tracker.listeners.forEach((l) => l());
}

export function subscribeUnsaved(tracker, listener) {
  tracker.listeners.add(listener);
  return () => tracker.listeners.delete(listener);
}

export function unsavedCount(tracker) {
  return tracker.failed.size;
}

// Network drops, timeouts and expired logins are worth retrying; a
// permission refusal or bad data isn't.
export function isRetryable(error) {
  if (!error) return false;
  const code = String(error.code || "");
  if (/^(42|23|22)/.test(code)) return false;
  return true;
}

// Upserts one row; returns the error (or null).
export async function saveRow(tracker, table, row) {
  const id = row.id;
  tracker.pending.set(id, (tracker.pending.get(id) || 0) + 1);
  let error = null;
  try {
    const result = await supabase.from(table).upsert(row);
    error = result.error;
  } catch (err) {
    error = err || new Error("save failed");
  }
  const left = (tracker.pending.get(id) || 1) - 1;
  if (left > 0) tracker.pending.set(id, left);
  else tracker.pending.delete(id);

  if (!error) {
    if (tracker.failed.delete(id)) emit(tracker);
  } else if (isRetryable(error)) {
    const prev = tracker.failed.get(id);
    tracker.failed.set(id, { table, row, attempts: prev ? prev.attempts : 0 });
    emit(tracker);
    scheduleRetry(tracker);
  }
  return error;
}

// Drop queued saves for things that no longer exist (rubbed out, undone).
export function forgetUnsaved(tracker, ids) {
  let changed = false;
  for (const id of ids) if (tracker.failed.delete(id)) changed = true;
  if (changed) emit(tracker);
}

export function scheduleRetry(tracker, delay) {
  if (tracker.retryTimer || !tracker.failed.size) return;
  const attempts = Math.max(0, ...[...tracker.failed.values()].map((f) => f.attempts));
  const wait = delay ?? Math.min(60000, 4000 * 2 ** Math.min(attempts, 4));
  tracker.retryTimer = setTimeout(() => {
    tracker.retryTimer = null;
    retryUnsaved(tracker);
  }, wait);
}

export function cancelRetry(tracker) {
  if (tracker.retryTimer) clearTimeout(tracker.retryTimer);
  tracker.retryTimer = null;
}

// Re-sends every queued save. `tracker.exists(id)` says whether it's still on the
// board — anything rubbed out in the meantime is dropped, not resurrected.
export async function retryUnsaved(tracker) {
  const exists = tracker.exists;
  if (tracker.retrying || !tracker.failed.size) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    scheduleRetry(tracker, 15000);
    return;
  }
  tracker.retrying = true;
  cancelRetry(tracker);
  const jobs = [...tracker.failed.entries()];
  for (const [id, job] of jobs) {
    if (exists && !exists(id)) {
      tracker.failed.delete(id);
      continue;
    }
    job.attempts += 1;
    if (job.attempts > MAX_ATTEMPTS) {
      console.error(`Giving up saving ${job.table} ${id} after ${MAX_ATTEMPTS} tries.`);
      tracker.failed.delete(id);
      continue;
    }
    await saveRow(tracker, job.table, job.row);
  }
  tracker.retrying = false;
  emit(tracker);
  scheduleRetry(tracker);
}

export function setExistsCheck(tracker, fn) {
  tracker.exists = fn;
}

// Nudges the live connection back up. After an idle pause the old socket
// can still be half-way through closing when the board re-joins, and the
// realtime client then skips reconnecting; calling this again once it has
// finished closing gets it going. Safe to call any time.
export function nudgeRealtime() {
  try {
    supabase.realtime.connect();
  } catch (err) {
    // no WebSocket available right now; the next nudge tries again
  }
}
