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
// 4. With the database set up for it (supabase/2026-10-18-speed-and-
//    privacy.sql): a board opens in one request (open_board), catching up
//    fetches only what changed (board_changes), moving things sends just
//    how far (move_objects), and the boards-list preview is a picture in
//    storage rather than in the boards table. Each falls back to the older
//    way when the database doesn't have it yet (or for the demo, and a
//    student's board, which aren't in the database).

import { supabase } from "./supabaseClient";
import { unpackStroke } from "./inkPack";

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

// Who wrote it (`au`, from the author_id column: a teacher's marks on a
// student's notebook are locked for the student, see 2026-11-clipping.sql).
// "?" for things saved before the database kept that.
function withAuthor(obj, r) {
  if (r && "author_id" in r) obj.au = r.author_id || "?";
  return obj;
}

const PARTS = {
  // (a notebook's strokes are saved packed: inkPack.js)
  strokes: { columns: "id, data", map: (r) => withAuthor({ ...unpackStroke(r.data), id: r.id }, r), label: "strokes" },
  texts: { columns: "id, x, y, text, color, font_size, width, rotation", map: (r) => withAuthor(rowToText(r), r), label: "texts" },
  images: {
    columns: "id, x, y, width, height, src, source",
    // (a database without the newer "source" column: clips from a reference
    // document, see supabase/2026-10-19-reference-docs.sql)
    fallbackColumns: "id, x, y, width, height, src",
    map: (r) => {
      const img = { id: r.id, x: r.x, y: r.y, width: r.width, height: r.height, src: r.src };
      if (r.source) img.source = r.source;
      return withAuthor(img, r);
    },
    label: "images",
  },
};

// (until the database has the author_id column, it isn't asked for)
let authorsMissing = false;

// One kind of board content (all of it). null when it couldn't be loaded,
// so the caller leaves that part of the screen alone.
//
// `client` is where the board is kept. It is the real database unless the
// board says otherwise: a student's own board in a live class is kept in
// the student's tab instead (see src/lib/localBoard.js).
export async function fetchBoardPart(boardId, kind, client = supabase) {
  const part = PARTS[kind];
  const load = (columns) =>
    fetchAllRows((withCount) =>
      ordered(client.from(kind).select(columns, withCount ? { count: "exact" } : undefined).eq("board_id", boardId))
    );
  const authors = isRealBackend(client) && !authorsMissing ? ", author_id" : "";
  let { rows, error } = await load(part.columns + authors);
  if (error && authors && /author_id/i.test(String(error.message || "") + String(error.details || ""))) {
    authorsMissing = true;
    ({ rows, error } = await load(part.columns));
  }
  if (error && part.fallbackColumns && /source|column|schema cache/i.test(String(error.message || "") + String(error.code || ""))) {
    ({ rows, error } = await load(part.fallbackColumns + (authorsMissing ? "" : authors)));
    if (error && authors) ({ rows, error } = await load(part.fallbackColumns));
  }
  if (error) {
    if (kind === "images") console.warn("Could not load images (has the images table been created yet?):", error);
    else console.error(`Error loading ${part.label}:`, error);
    return null;
  }
  return rows.map(part.map);
}

export async function fetchBoardContents(boardId, client = supabase) {
  const [strokes, texts, images] = await Promise.all([
    fetchBoardPart(boardId, "strokes", client),
    fetchBoardPart(boardId, "texts", client),
    fetchBoardPart(boardId, "images", client),
  ]);
  return { strokes, texts, images };
}

// The board's own settings, for catching up after time away.
export async function fetchBoardSettings(boardId, client = supabase) {
  try {
    let { data, error } = await client.from("boards").select("id, name, owner_id, grid_config, sim_embeds, background").eq("id", boardId).maybeSingle();
    // (a database without the newer columns)
    if (error) ({ data, error } = await client.from("boards").select("id, name, owner_id, grid_config").eq("id", boardId).maybeSingle());
    if (error || !data) return null;
    return data;
  } catch (err) {
    return null;
  }
}

// Marks a board as in use, so the inactive-board clean-up leaves it alone.
// Quietly does nothing until the clean-up SQL has been run.
export async function touchBoard(boardId, client = supabase) {
  try {
    await client.rpc("touch_board", { p_board_id: String(boardId) });
  } catch (err) {
    // optional feature — never block the board over it
  }
}

// ---------- the newer, quicker ways (see 4. above) ----------

// The real database (not the demo's stand-in, or a student's board).
export function isRealBackend(client) {
  return !!client && client === supabase && !supabase.__demo;
}

// Opens a board in one go: joins it (when opened from a shared link), marks
// it as used, and returns its settings plus the server's clock ("now").
// null when that isn't available (then the older way is used).
export async function openBoard(boardId, client = supabase) {
  if (!isRealBackend(client)) return null;
  try {
    const { data, error } = await client.rpc("open_board", { p_board: boardId });
    if (error || !data || typeof data !== "object") return null;
    return data;
  } catch (err) {
    return null;
  }
}

// Rows as the database sends them ({ strokes, texts, images }) as the
// board's own objects (a notebook opened from its link reads them this way).
export function contentsFromRows(data) {
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    strokes: list(data && data.strokes).map(PARTS.strokes.map),
    texts: list(data && data.texts).map(PARTS.texts.map),
    images: list(data && data.images).map(PARTS.images.map),
  };
}

// Everything on a board that changed after `since` (the server's clock):
// { now, strokes, texts, images, deletedIds } or { now, full: true } when
// it's quicker to load the whole board. null if it couldn't be asked.
export async function fetchBoardChanges(boardId, since, client = supabase) {
  if (!isRealBackend(client) || !since) return null;
  try {
    const { data, error } = await client.rpc("board_changes", { p_board: boardId, p_since: since });
    if (error || !data || typeof data !== "object" || !data.now) return null;
    if (data.full) return { now: data.now, full: true };
    const list = (v) => (Array.isArray(v) ? v : []);
    return {
      now: data.now,
      strokes: list(data.strokes).map(PARTS.strokes.map),
      texts: list(data.texts).map(PARTS.texts.map),
      images: list(data.images).map(PARTS.images.map),
      deleted: list(data.deleted),
    };
  } catch (err) {
    return null;
  }
}

// A moment a little before `serverTime`: catching up from there also
// covers saves that were still on their way when the clock was read.
export function syncFrom(serverTime, overlapMs = 15000) {
  const t = Date.parse(serverTime);
  if (!Number.isFinite(t)) return null;
  return new Date(t - overlapMs).toISOString();
}

// The same content (whatever order the fields are in)?
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
function sameThing(a, b) {
  return stable(a) === stable(b);
}

// What's on screen + what changed on the server -> what should be on
// screen. Our own work that is still saving (or failed to save) is kept as
// it is here.
export function mergeChanges(local, changed, deletedIds, tracker) {
  const changedById = new Map();
  for (const o of changed) changedById.set(o.id, o);
  const ours = (id) => tracker.pending.has(id) || tracker.failed.has(id);
  const out = [];
  let touched = false;
  for (const o of local) {
    const c = changedById.get(o.id);
    if (c) {
      changedById.delete(o.id);
      if (ours(o.id) || o === c || sameThing(o, c)) {
        out.push(o);
      } else {
        out.push(c);
        touched = true;
      }
      continue;
    }
    if (deletedIds.has(o.id) && !ours(o.id)) {
      touched = true;
      continue;
    }
    out.push(o);
  }
  const now = Date.now();
  for (const c of changedById.values()) {
    // rubbed out here a moment ago (the delete just hasn't landed yet)
    const removed = tracker.removedAt.get(c.id);
    if (removed && now - removed < RECENT_MS) continue;
    out.push(c);
    touched = true;
  }
  return touched ? out : local;
}

// The ids rubbed out, per kind, from a board_changes answer (anything that
// is back again since is left alone).
export function deletedIdsOf(changes) {
  const alive = {
    strokes: new Set(changes.strokes.map((o) => o.id)),
    texts: new Set(changes.texts.map((o) => o.id)),
    images: new Set(changes.images.map((o) => o.id)),
  };
  const out = { strokes: new Set(), texts: new Set(), images: new Set() };
  for (const d of changes.deleted) {
    if (d && out[d.kind] && !alive[d.kind].has(String(d.id))) out[d.kind].add(String(d.id));
  }
  return out;
}

// Moves things on the server by (dx, dy): a few numbers instead of every
// point of every line. Resolves with how many were moved, or null if it
// couldn't (then the moved copies are saved the older way).
export async function moveObjects(boardId, sel, dx, dy, client = supabase) {
  if (!isRealBackend(client)) return null;
  try {
    const { data, error } = await client.rpc("move_objects", {
      p_board: boardId,
      p_strokes: sel.strokes || [],
      p_texts: sel.texts || [],
      p_images: sel.images || [],
      p_dx: dx,
      p_dy: dy,
    });
    if (error || typeof data !== "number") return null;
    return data;
  } catch (err) {
    return null;
  }
}

// One catch-up after time away (or a check now and then): only what changed
// since `cursor` when that can be asked, else everything.
//   { mode: "changes", now, changes, deleted, settings }
//   { mode: "full", now, contents, settings, fetchStartedAt }
// `settings` (the board's own settings) is null when not asked for.
export async function catchUp(boardId, client, cursor, { withSettings = true } = {}) {
  const real = isRealBackend(client);
  if (real && cursor) {
    const [changes, opened] = await Promise.all([
      fetchBoardChanges(boardId, syncFrom(cursor), client),
      withSettings ? openBoard(boardId, client) : Promise.resolve(null),
    ]);
    if (changes && !changes.full) {
      return { mode: "changes", now: changes.now, changes, deleted: deletedIdsOf(changes), settings: opened && opened.found ? opened : null };
    }
  }
  const fetchStartedAt = Date.now();
  const [opened, contents] = await Promise.all([
    real ? openBoard(boardId, client) : Promise.resolve(null),
    fetchBoardContents(boardId, client),
  ]);
  let settings = opened && opened.found ? opened : null;
  if (!real || !opened) settings = withSettings ? await fetchBoardSettings(boardId, client) : null;
  return { mode: "full", now: opened ? opened.now : null, contents, settings, fetchStartedAt };
}

// ---------- the boards-list preview ----------

// A short fingerprint of a picture (to tell whether it changed).
export function pictureHash(text) {
  let h = 0x811c9dc5;
  const str = String(text || "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + "-" + str.length.toString(36);
}

// The fingerprint a saved preview was made from ("…/thumb.jpg?v=<it>"), or
// of an older preview kept as a picture in the row itself.
export function previewHashOf(saved) {
  if (!saved || saved === "legacy") return null;
  if (/^data:/.test(saved)) return pictureHash(saved);
  const m = /[?&]v=([a-z0-9-]+)/i.exec(saved);
  return m ? m[1] : null;
}

function dataUrlToBlob(dataUrl) {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl || "");
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

// Saves a board's preview picture into storage, next to the board's other
// pictures, and points the board at it. false if that didn't work (the
// caller then keeps it in the row, the older way).
export async function savePreview(boardId, dataUrl, hash, client = supabase) {
  if (!isRealBackend(client)) return false;
  const blob = dataUrlToBlob(dataUrl);
  if (!blob) return false;
  try {
    const path = `${boardId}/thumb.jpg`;
    const bucket = client.storage.from("board-images");
    const { error } = await bucket.upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: true, cacheControl: "3600" });
    if (error) return false;
    const { data } = bucket.getPublicUrl(path);
    if (!data || !data.publicUrl) return false;
    const { error: rowError } = await client.from("boards").update({ thumbnail: `${data.publicUrl}?v=${hash}` }).eq("id", boardId);
    return !rowError;
  } catch (err) {
    return false;
  }
}

// ---------- tracking what's on screen ----------

export function createSyncTracker(client) {
  return {
    client: client || supabase, // where this board's saves go
    pending: new Map(), // id -> number of saves in flight
    failed: new Map(), // id -> { table, row, attempts }
    seenAt: new Map(), // id -> when it first appeared on this screen
    removedAt: new Map(), // id -> when it last left this screen
    lastIds: { strokes: new Set(), texts: new Set(), images: new Set(), refMarks: new Set() },
    listeners: new Set(),
    exists: null, // set by the board: (id) => is it still on screen?
    onGiveUp: null, // set by the board: called with saves that will never go through
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

// Changes the saves waiting to be tried again: rework(table, row) returns
// the row to save instead, or null to forget it (a notebook's pages moved
// or went: see Whiteboard.js).
export function reworkQueued(tracker, rework) {
  let changed = false;
  for (const [id, entry] of tracker.failed) {
    if (!entry || !entry.row) continue;
    const next = rework(entry.table, entry.row);
    if (next === entry.row) continue;
    changed = true;
    if (next) entry.row = next;
    else tracker.failed.delete(id);
  }
  if (changed) emit(tracker);
}

export function unsavedCount(tracker) {
  return tracker.failed.size;
}

// Network drops, timeouts and expired logins are worth retrying; bad data
// isn't.
export function isRetryable(error) {
  if (!error) return false;
  const code = String(error.code || "");
  if (/^(42|23|22)/.test(code)) return false;
  return true;
}

// The database said no (row-level security, code 42501). Usually that's
// the board's rules (the board was deleted, or it's no longer shared with
// this person), but it is also exactly what comes back when the login
// lapsed for a moment: an iPad waking up with an expired login and no
// network yet sends the save as "not signed in". So a refusal is tried a
// few more times before it's given up on.
export function isRefusal(error) {
  return !!error && String(error.code || "") === "42501";
}
const REFUSED_TRIES = 4;

// Is the login stuck mid-refresh (expired, and renewing it just failed)?
// Supabase would then send the save as "not signed in" and the database
// would refuse it, so it's better to wait and send it once the login is
// back.
async function loginLapsed(client) {
  if (!client || !client.auth || typeof client.auth.getSession !== "function") return false;
  try {
    const { data, error } = await client.auth.getSession();
    return !!error && !(data && data.session);
  } catch (err) {
    return false;
  }
}
const LOGIN_LAPSED = { code: "LOGIN_LAPSED", message: "the login couldn't be renewed just now; will retry" };

// Remembers a save that didn't go through, keeping what's known about it.
function queue(tracker, id, table, row, error) {
  const prev = tracker.failed.get(id);
  tracker.failed.set(id, {
    table,
    row,
    attempts: prev ? prev.attempts : 0,
    refusals: (prev && prev.refusals) || 0,
    refused: isRefusal(error),
  });
}

async function sendRows(tracker, table, payload) {
  if (await loginLapsed(tracker.client)) return LOGIN_LAPSED;
  try {
    const result = await tracker.client.from(table).upsert(payload);
    return result.error;
  } catch (err) {
    return err || new Error("save failed");
  }
}

// Upserts one row; returns the error (or null).
export async function saveRow(tracker, table, row) {
  const id = row.id;
  tracker.pending.set(id, (tracker.pending.get(id) || 0) + 1);
  const error = await sendRows(tracker, table, row);
  const left = (tracker.pending.get(id) || 1) - 1;
  if (left > 0) tracker.pending.set(id, left);
  else tracker.pending.delete(id);

  if (!error) {
    if (tracker.failed.delete(id)) emit(tracker);
  } else if (isRetryable(error) || isRefusal(error)) {
    queue(tracker, id, table, row, error);
    emit(tracker);
    scheduleRetry(tracker);
  } else if (tracker.failed.delete(id)) {
    // bad data never saves however often it's sent
    emit(tracker);
  }
  return error;
}

// Upserts several rows in one request — a pasted selection or an inserted
// shape is many strokes at once. Each row is still tracked on its own, so
// if the request fails every one of them is queued and retried exactly
// like a single save.
export async function saveRows(tracker, table, rows) {
  if (!rows.length) return null;
  if (rows.length === 1) return saveRow(tracker, table, rows[0]);
  for (const row of rows) tracker.pending.set(row.id, (tracker.pending.get(row.id) || 0) + 1);
  const error = await sendRows(tracker, table, rows);
  const retry = !!error && (isRetryable(error) || isRefusal(error));
  let changed = false;
  for (const row of rows) {
    const left = (tracker.pending.get(row.id) || 1) - 1;
    if (left > 0) tracker.pending.set(row.id, left);
    else tracker.pending.delete(row.id);
    if (!error || !retry) {
      if (tracker.failed.delete(row.id)) changed = true;
    } else {
      queue(tracker, row.id, table, row, error);
      changed = true;
    }
  }
  if (changed) emit(tracker);
  if (retry) scheduleRetry(tracker);
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
  const gaveUp = [];
  for (const [id, job] of jobs) {
    if (exists && !exists(id)) {
      tracker.failed.delete(id);
      continue;
    }
    job.attempts += 1;
    if (job.attempts > MAX_ATTEMPTS) {
      console.error(`Giving up saving ${job.table} ${id} after ${MAX_ATTEMPTS} tries.`);
      tracker.failed.delete(id);
      gaveUp.push(job);
      continue;
    }
    const error = await saveRow(tracker, job.table, job.row);
    if (isRefusal(error)) {
      const again = tracker.failed.get(id);
      if (again) {
        again.refusals = (again.refusals || 0) + 1;
        if (again.refusals >= REFUSED_TRIES) {
          console.warn(`Giving up saving ${job.table} ${id}: the database keeps refusing it (${error.message || error.code}).`);
          tracker.failed.delete(id);
          gaveUp.push(again);
        }
      }
    }
  }
  tracker.retrying = false;
  emit(tracker);
  if (gaveUp.length && tracker.onGiveUp) {
    try {
      tracker.onGiveUp(gaveUp);
    } catch (err) {
      // the board has gone
    }
  }
  scheduleRetry(tracker);
}

export function setGiveUpHandler(tracker, fn) {
  tracker.onGiveUp = fn;
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
