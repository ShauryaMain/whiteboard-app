// Remembers, on this device, which announced updates someone has already
// seen and whether they've asked not to be shown the pop-up on startup.
// A tiny store, read with useSyncExternalStore, so the boards page updates
// the moment either changes (and stays in step across tabs).

import { supabase } from "./supabaseClient";
import { newNotebook } from "./notebook";

const SEEN_KEY = "cleanslate_whatsnew_seen"; // JSON list of release ids
const QUIET_KEY = "cleanslate_whatsnew_quiet"; // "1" = don't pop up on startup
const BOARD_KEY = "cleanslate_whatsnew_board_"; // + release id -> walkthrough board id

// ---------- the store ----------

const SERVER_STATE = { ready: false, seen: [], quiet: true };
let state = null;
const listeners = new Set();

function readStorage() {
  let seen = [];
  let quiet = false;
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) seen = parsed.filter((v) => typeof v === "string");
    quiet = window.localStorage.getItem(QUIET_KEY) === "1";
  } catch (err) {
    // storage switched off (private window): behave as if nothing is stored
  }
  return { ready: true, seen, quiet };
}

function sameState(a, b) {
  return a.quiet === b.quiet && a.seen.length === b.seen.length && a.seen.every((id, i) => id === b.seen[i]);
}

function setState(next) {
  if (state && sameState(state, next)) return;
  state = next;
  listeners.forEach((l) => l());
}

function onStorage(e) {
  if (e.key === SEEN_KEY || e.key === QUIET_KEY || e.key === null) setState(readStorage());
}

export function subscribeWhatsNew(listener) {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function getWhatsNew() {
  if (!state) state = readStorage();
  return state;
}

// On the server (and for the first paint in the browser) nothing is known
// yet, so nothing pops up.
export function getServerWhatsNew() {
  return SERVER_STATE;
}

export function markReleasesSeen(ids) {
  const current = getWhatsNew();
  const merged = [...current.seen];
  for (const id of ids) if (!merged.includes(id)) merged.push(id);
  if (merged.length === current.seen.length) return;
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(merged));
  } catch (err) {
    // can't be saved: it still counts as seen until the page is reloaded
  }
  setState({ ...current, seen: merged });
}

export function setWhatsNewQuiet(quiet) {
  const current = getWhatsNew();
  if (current.quiet === !!quiet) return;
  try {
    if (quiet) window.localStorage.setItem(QUIET_KEY, "1");
    else window.localStorage.removeItem(QUIET_KEY);
  } catch (err) {
    // as above
  }
  setState({ ...current, quiet: !!quiet });
}

// ---------- "Show me the update": the walkthrough board ----------

function recall(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (err) {
    return null;
  }
}

function remember(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (err) {
    // not remembered: a fresh board is made next time, that's all
  }
}

// Finds the board made for this update's walkthrough, or makes it. Pressing
// the button again reopens the same board, so the boards list doesn't fill
// up with copies. Returns { id } or { error }.
export async function openTourBoard(release, userId) {
  const key = BOARD_KEY + release.id;
  try {
    const stored = recall(key);
    if (stored) {
      const found = await supabase.from("boards").select("id").eq("id", stored).eq("owner_id", userId).maybeSingle();
      if (!found.error && found.data) return { id: found.data.id };
    }
    const row = { name: release.tourBoardName || `Trying out: ${release.title}`, owner_id: userId };
    // an update about notebooks is tried out on a new notebook
    if (release.tourNotebook) {
      const nb = await supabase.from("boards").insert({ ...row, kind: "notebook", notebook: newNotebook({ paper: "lined" }), background: "blank" }).select().single();
      if (nb.error || !nb.data) return { error: nb.error || new Error("no notebook") };
      remember(key, nb.data.id);
      return { id: nb.data.id };
    }
    let made = await supabase.from("boards").insert({ ...row, background: "blank" }).select().single();
    // Project without the background column yet: create it plain.
    if (made.error) made = await supabase.from("boards").insert(row).select().single();
    if (made.error || !made.data) return { error: made.error || new Error("no board") };
    remember(key, made.data.id);
    return { id: made.data.id };
  } catch (err) {
    return { error: err || new Error("couldn't open a board") };
  }
}
