// Carries a visitor's demo board into their account.
//
// The demo board lives in the browser tab's memory, and signing in means
// leaving that page. So:
//
//   1. As they work, the demo keeps a copy of the board in this browser
//      (demoBackend.js, demoStash.js). Pressing a "keep it" button calls
//      stashDemoBoard(), which keeps it straight away and marks it as one
//      they asked to keep.
//   2. Once the person is signed in and their boards page opens,
//      bringAcross() saves that copy as a real board in their account,
//      and they are taken straight to it. A copy they didn't ask to keep is
//      only carried into a brand-new account (see shouldCarry).
//
// What comes across: the ink, text boxes, page style, graph and any
// simulations. Pictures and the worksheet don't (in the demo they exist
// only in the tab's memory). If the visitor hadn't changed the demo board
// at all, nothing is kept and nothing is created.

import { supabase } from "./supabaseClient";
import { TAPE_SRC } from "./tape";
import { normalizeNotebook } from "./notebook";
import { packStroke, isPacked } from "./inkPack";
import {
  DEMO_STASH_KEY,
  clearDemoStash,
  keepRequested,
  markCarried,
  readDemoStash,
  stashStartedAt,
  wasCarried,
  writeDemoStash,
} from "./demoStash";

const KEY = DEMO_STASH_KEY;
const BATCH = 40; // rows per request, the same as the board's own batched saves
// An account this new counts as just made (so a board kept as they worked,
// without pressing "keep", still comes across).
const NEW_ACCOUNT_MS = 30 * 60 * 1000;
// ...as long as the demo board was started at most this long before
const AUTO_CARRY_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CLOCK_LEEWAY_MS = 5 * 60 * 1000;

// ---------- the copy kept on this device ----------

const readStored = readDemoStash;
const forget = clearDemoStash;

// Called on the demo page when the visitor asks to keep their board (just
// before signing in). `next` is what to show once it opens ("class": point
// at Start live class). A lesson board is kept even if they haven't
// changed it. Returns true if there was something to keep.
export function stashDemoBoard({ next } = {}) {
  try {
    const snapshot = typeof supabase.__carry === "function" ? supabase.__carry(true) : null;
    if (!snapshot) {
      forget(); // nothing of theirs on the board: don't bring back an old copy either
      return false;
    }
    return writeDemoStash({ ...snapshot, keepAt: Date.now(), next: next || undefined });
  } catch (err) {
    // Too big for this browser's storage, or storage is switched off.
    // Signing in still works; the board just isn't carried across.
    console.warn("Couldn't keep the demo board for sign-in:", err);
    return false;
  }
}

// Whether the board waiting in this browser should be saved into this
// account:
//   - never if that demo board was already saved into an account
//   - yes if they pressed "keep it" in the last hour (they're signing in
//     to keep it)
//   - otherwise only into a brand-new account (made in the last half hour)
//     when the demo board was started before the account was made:
//     someone who tried the demo, then signed up. Not a teacher who has had
//     an account for months poking at the demo, nor a second demo board
//     opened after signing up.
export function shouldCarry(stored, accountCreatedAt, now = Date.now()) {
  if (!stored) return false;
  const started = stashStartedAt(stored);
  if (wasCarried(started)) return false;
  if (keepRequested(stored, now)) return true;
  const made = Date.parse(accountCreatedAt || "");
  if (!Number.isFinite(made) || now - made >= NEW_ACCOUNT_MS) return false;
  // (a few minutes' leeway: this computer's clock may not match the server's)
  return started > 0 && started <= made + CLOCK_LEEWAY_MS && made - started < AUTO_CARRY_AGE_MS;
}

// True when the board waiting here is one they just asked to keep (the
// sign-in page then says it will be saved).
export function demoKeepRequested() {
  if (typeof window === "undefined") return false;
  const stored = readStored();
  return Boolean(stored) && !wasCarried(stashStartedAt(stored)) && keepRequested(stored);
}

// What the waiting board asked to show next (see stashDemoBoard).
export function waitingDemoNext() {
  const stored = readStored();
  return stored && stored.next ? stored.next : null;
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
  // the demo notebook comes across as a notebook, with its pages and tape
  const notebook = snapshot.notebook ? normalizeNotebook(snapshot.notebook) : null;
  if (notebook) {
    const made = await supabase.from("boards").insert({ ...row, kind: "notebook", notebook: { ...notebook, rev: 0 }, background: snapshot.background || "blank" }).select().single();
    if (made.error || !made.data) return { error: made.error || new Error("no notebook") };
    return saveContents(made.data.id, snapshot, true);
  }
  let made = await supabase.from("boards").insert({ ...row, background: snapshot.background || "blank" }).select().single();
  // Project without the background column yet: create it plain.
  if (made.error) made = await supabase.from("boards").insert(row).select().single();
  if (made.error || !made.data) return { error: made.error || new Error("no board") };
  return saveContents(made.data.id, snapshot, false);
}

// What's on the kept board, saved onto the new one.
async function saveContents(boardId, snapshot, isNotebook) {
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
  const tapes = isNotebook && Array.isArray(snapshot.tapes) ? snapshot.tapes : [];
  const total = snapshot.strokes.length + snapshot.texts.length + tapes.length;
  const start = Date.now() - total - 1000;
  let n = 0;
  const stamp = () => new Date(start + n++).toISOString();
  // (a notebook's ink is saved packed: inkPack.js)
  const strokes = snapshot.strokes.map((data) => ({
    id: newId(), board_id: boardId, data: isNotebook && !isPacked(data) ? packStroke(data) : data, created_at: stamp(),
  }));
  const texts = snapshot.texts.map((t) => ({ id: newId(), board_id: boardId, ...t, created_at: stamp() }));
  const images = tapes.map((t) => ({ id: newId(), board_id: boardId, x: t.x, y: t.y, width: t.width, height: t.height, src: TAPE_SRC, created_at: stamp() }));
  const failed = (await insertInBatches("strokes", strokes)) + (await insertInBatches("texts", texts)) + (await insertInBatches("images", images));
  if (failed && failed === total) {
    // Nothing made it: remove the empty board rather than leave it behind.
    await supabase.from("boards").delete().eq("id", boardId);
    return { error: new Error("couldn't save the board's contents") };
  }
  return { id: boardId };
}

// Saves the waiting demo board to this account. Resolves to
// { id, next, kind } for the new board, or null if there was nothing
// (to carry) or it couldn't be saved. Safe to call twice: the second call
// joins the first.
export function bringAcross(userId, accountCreatedAt) {
  if (inFlight) return inFlight;
  const snapshot = readStored();
  if (!snapshot || !userId || !shouldCarry(snapshot, accountCreatedAt)) return Promise.resolve(null);
  setState("saving");
  inFlight = saveAsBoard(snapshot, userId)
    .then((result) => {
      if (result.id) {
        markCarried(stashStartedAt(snapshot));
        forget();
        setState("none");
        return { id: result.id, next: snapshot.next || null, kind: snapshot.kind || "explore" };
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
