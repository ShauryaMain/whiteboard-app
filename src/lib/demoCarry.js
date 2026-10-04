// "Sign in free to keep your work": carries a visitor's demo board into
// their account.
//
// The demo board lives only in the browser tab's memory, and signing in
// means leaving that page (to Google and back). So:
//
//   1. On the demo, pressing the button calls stashDemoBoard(). It asks
//      the demo for a copy of the board and keeps it on this device.
//   2. Once the person is signed in and their boards page opens,
//      bringAcross() saves that copy as a real board in their account,
//      and they are taken straight to it.
//
// What comes across: the ink, text boxes, page style, graph and any
// simulations. Pictures and the worksheet don't (in the demo they exist
// only in the tab's memory). If the visitor hadn't changed the demo board
// at all, nothing is kept and nothing is created.

import { supabase } from "./supabaseClient";

const KEY = "cleanslate_demo_carry";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // a copy older than a week is dropped
const BATCH = 40; // rows per request, the same as the board's own batched saves

// ---------- the copy kept on this device ----------

function readStored() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw);
    const ok = stored && stored.version === 1 && Array.isArray(stored.strokes) && Array.isArray(stored.texts);
    if (!ok || Date.now() - (stored.savedAt || 0) > MAX_AGE_MS) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    return stored;
  } catch (err) {
    return null; // storage switched off, or not valid: nothing to carry
  }
}

function forget() {
  try {
    window.localStorage.removeItem(KEY);
  } catch (err) {
    // nothing to do
  }
}

// Called on the demo page, just before leaving it to sign in. Returns true
// if there was something to keep.
export function stashDemoBoard() {
  try {
    const snapshot = typeof supabase.__carry === "function" ? supabase.__carry() : null;
    if (!snapshot) {
      forget(); // nothing of theirs on the board: don't bring back an old copy either
      return false;
    }
    window.localStorage.setItem(KEY, JSON.stringify({ ...snapshot, savedAt: Date.now() }));
    return true;
  } catch (err) {
    // Too big for this browser's storage, or storage is switched off.
    // Signing in still works; the board just isn't carried across.
    console.warn("Couldn't keep the demo board for sign-in:", err);
    return false;
  }
}

// ---------- a tiny store, so the screens can react ----------

// "none"    nothing waiting
// "waiting" a demo board is waiting to be saved to an account
// "saving"  it is being saved now
// "failed"  saving didn't work (the copy is still kept, to try again)
const SERVER_STATE = "none";
let state = null;
let inFlight = null;
const listeners = new Set();

function setState(next) {
  if (state === next) return;
  state = next;
  listeners.forEach((l) => l());
}

function onStorage(e) {
  if ((e.key === KEY || e.key === null) && state !== "saving") setState(readStored() ? "waiting" : "none");
}

export function subscribeDemoCarry(listener) {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function getDemoCarry() {
  if (state === null) state = readStored() ? "waiting" : "none";
  return state;
}

export function getServerDemoCarry() {
  return SERVER_STATE;
}

// True when the waiting board had pictures on it. They can't be carried
// (in the demo they only ever existed in the tab's memory), so the
// sign-in screen says so rather than letting them vanish unexplained.
export function demoCarryLeftPictures() {
  if (typeof window === "undefined") return false;
  const stored = readStored();
  return Boolean(stored && stored.leftBehind && stored.leftBehind.pictures > 0);
}

// "No thanks": drop the waiting copy.
export function dismissDemoCarry() {
  forget();
  setState("none");
}

// ---------- saving it as a real board ----------

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  // Older iPads: build the same kind of id by hand.
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (v) => v.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10).join("")}`;
}

async function insertInBatches(table, rows) {
  let failed = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    let { error } = await supabase.from(table).insert(batch);
    if (error) {
      // Try once more without the timestamps, in case this project doesn't
      // accept them being set (the order of the ink may then differ).
      ({ error } = await supabase.from(table).insert(batch.map(({ created_at, ...rest }) => rest)));
    }
    if (error) {
      failed += batch.length;
      console.error(`Demo board: couldn't save ${batch.length} ${table}:`, error);
    }
  }
  return failed;
}

async function saveAsBoard(snapshot, userId) {
  const row = { name: snapshot.name || "My demo board", owner_id: userId };
  let made = await supabase.from("boards").insert({ ...row, background: snapshot.background || "blank" }).select().single();
  // Project without the background column yet: create it plain.
  if (made.error) made = await supabase.from("boards").insert(row).select().single();
  if (made.error || !made.data) return { error: made.error || new Error("no board") };
  const boardId = made.data.id;

  // The graph and simulations sit on the board itself. Each is optional,
  // so a problem with one never stops the rest.
  if (snapshot.grid_config) {
    const { error } = await supabase.from("boards").update({ grid_config: snapshot.grid_config }).eq("id", boardId);
    if (error) console.warn("Demo board: couldn't save the graph:", error);
  }
  if (snapshot.sim_embeds && snapshot.sim_embeds.length) {
    const { error } = await supabase.from("boards").update({ sim_embeds: snapshot.sim_embeds }).eq("id", boardId);
    if (error) console.warn("Demo board: couldn't save the simulations:", error);
  }

  // Each row gets its own moment in time, a millisecond apart, so the ink
  // loads back in the order it was drawn (what's on top stays on top).
  const total = snapshot.strokes.length + snapshot.texts.length;
  const start = Date.now() - total - 1000;
  let n = 0;
  const stamp = () => new Date(start + n++).toISOString();
  const strokes = snapshot.strokes.map((data) => ({ id: newId(), board_id: boardId, data, created_at: stamp() }));
  const texts = snapshot.texts.map((t) => ({ id: newId(), board_id: boardId, ...t, created_at: stamp() }));
  const failed = (await insertInBatches("strokes", strokes)) + (await insertInBatches("texts", texts));
  if (failed && failed === total) {
    // Nothing made it: remove the empty board rather than leave it behind.
    await supabase.from("boards").delete().eq("id", boardId);
    return { error: new Error("couldn't save the board's contents") };
  }
  return { id: boardId };
}

// Saves the waiting demo board to this account. Resolves to the new
// board's id, or null if there was nothing waiting or it couldn't be
// saved. Safe to call twice: the second call joins the first.
export function bringAcross(userId) {
  if (inFlight) return inFlight;
  const snapshot = readStored();
  if (!snapshot || !userId) return Promise.resolve(null);
  setState("saving");
  inFlight = saveAsBoard(snapshot, userId)
    .then((result) => {
      if (result.id) {
        forget();
        setState("none");
        return result.id;
      }
      console.error("Demo board: couldn't bring it across:", result.error);
      setState("failed");
      return null;
    })
    .catch((err) => {
      console.error("Demo board: couldn't bring it across:", err);
      setState("failed");
      return null;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
