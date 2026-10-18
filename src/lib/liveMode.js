// Private live channels (see supabase/2026-10-18-speed-and-privacy.sql).
//
// Once that file has been run, every live channel is private: Supabase only
// lets someone join a board's channel if they can use the board, and a
// class's channels if they are its teacher or one of its students. Students
// don't sign in, so they get an invisible ("anonymous") sign-in, and join
// the class by its code (join_class) before connecting.
//
// Until the file has been run, everything works as before (public
// channels). The app asks the database which it is (live_config), and
// remembers the answer in this browser, so pages don't wait for it.

import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "./supabaseClient";

const KEY = "cleanslate_live_private";
const PUBLIC = { ready: true, private: false };
const PRIVATE = { ready: true, private: true };
const NOT_READY = { ready: false, private: false };

let known = null; // { ready: true, private } once asked this visit
let asking = null;
const listeners = new Set();

function remembered() {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === "1") return PRIVATE;
    if (v === "0") return PUBLIC;
  } catch (err) {
    // storage switched off
  }
  return null;
}

function remember(mode) {
  try {
    window.localStorage.setItem(KEY, mode.private ? "1" : "0");
  } catch (err) {
    // as above
  }
}

function isDemo() {
  return !!(supabase && supabase.__demo);
}

// Asks the database (once per visit).
export function checkLiveMode() {
  if (isDemo()) return Promise.resolve(PUBLIC);
  if (known) return Promise.resolve(known);
  if (asking) return asking;
  asking = (async () => {
    let mode = null;
    for (let attempt = 0; attempt < 3 && !mode; attempt++) {
      try {
        const { data, error } = await supabase.rpc("live_config");
        if (!error) mode = data && data.private ? PRIVATE : PUBLIC;
        // "no such function": the file hasn't been run yet
        else if (error.code === "PGRST202" || error.code === "42883" || /function/i.test(error.message || "")) mode = PUBLIC;
      } catch (err) {
        // offline: try again shortly
      }
      if (!mode) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
    asking = null;
    if (!mode) {
      // Still can't tell (offline). Guessing "public" could put this page
      // on different channels from everyone else, so: whatever this browser
      // knew before, or nothing yet (pages wait, and ask again shortly).
      const before = remembered();
      if (!before) return null;
      mode = before;
    } else {
      remember(mode);
    }
    known = mode;
    listeners.forEach((l) => l(mode));
    return mode;
  })();
  return asking;
}

// For components: { ready, private }. Ready straight away when this browser
// has the answer from before (it is checked again in the background).
let rememberedMode;
function snapshot() {
  if (isDemo()) return PUBLIC;
  if (known) return known;
  if (rememberedMode === undefined) rememberedMode = remembered();
  return rememberedMode || NOT_READY;
}
function serverSnapshot() {
  return NOT_READY;
}
function subscribe(listener) {
  const l = () => listener();
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useLiveMode() {
  const mode = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(() => {
    let timer = null;
    let gap = 4000;
    const ask = () =>
      checkLiveMode().then((m) => {
        // couldn't tell yet: ask again in a little while
        if (!m) {
          timer = setTimeout(ask, gap);
          gap = Math.min(30000, gap * 2);
        }
      });
    ask();
    return () => clearTimeout(timer);
  }, []);
  return mode;
}

// A live channel, private when the database is set up for it.
export function liveChannel(name, config = {}, mode = known) {
  const priv = !!(mode && mode.private);
  return supabase.channel(name, { config: priv ? { ...config, private: true } : config });
}

// ---------- students ----------

// Makes sure this browser has a sign-in to connect with: the teacher's own,
// or an invisible one for a student. Resolves true when there is one.
export async function ensureLiveSession() {
  if (isDemo()) return true;
  try {
    const { data } = await supabase.auth.getSession();
    if (data && data.session) return true;
    const { data: made, error } = await supabase.auth.signInAnonymously();
    if (error) {
      console.warn("Couldn't sign this student in for the class (are anonymous sign-ins turned on in Supabase?):", error.message || error);
      return false;
    }
    return !!(made && made.session);
  } catch (err) {
    return false;
  }
}

// Joins a class by its code. { status: "ok" | "not_found" | "ended" |
// "offline" | "signed_out", boardId? }
export async function joinClass(code, studentId, name) {
  try {
    const { data, error } = await supabase.rpc("join_class", { p_code: code, p_student_id: studentId, p_name: name });
    if (error) return { status: "offline" };
    if (!data) return { status: "offline" };
    return { status: data.status, boardId: data.board_id || null };
  } catch (err) {
    return { status: "offline" };
  }
}

// Everything a student's page needs before it connects: the mode, a
// sign-in and the class membership. { ok, status }
export async function readyStudent(code, studentId, name) {
  const mode = await checkLiveMode();
  if (!mode) return { ok: false, status: "offline" };
  if (!mode.private) return { ok: true, status: "public" };
  let tries = 0;
  for (;;) {
    const signedIn = await ensureLiveSession();
    if (!signedIn) return { ok: false, status: "no_session" };
    const joined = await joinClass(code, studentId, name);
    if (joined.status === "ok") return { ok: true, status: "ok", boardId: joined.boardId };
    if (joined.status === "not_found" || joined.status === "ended") return { ok: false, status: joined.status };
    tries += 1;
    if (tries >= 4) return { ok: false, status: "offline" };
    await new Promise((r) => setTimeout(r, 1500 * tries));
  }
}

// ---------- teachers ----------

// Registers the class (its code and board) so its students can be let in.
// "ok", "taken" (someone else's class has that code) or "error".
export async function openClass(code, boardId) {
  const mode = await checkLiveMode();
  if (!mode) return "error";
  if (!mode.private) return "ok";
  try {
    const { data, error } = await supabase.rpc("open_class", { p_code: code, p_board: boardId });
    if (error) return "error";
    return data === "taken" ? "taken" : data === "ok" ? "ok" : "error";
  } catch (err) {
    return "error";
  }
}

// openClass, tried again (less and less often) until it works: "ok",
// "taken", or "gone" when `isGone()` says the page has moved on.
export async function openClassReliably(code, boardId, isGone) {
  let wait = 1500;
  for (;;) {
    if (isGone()) return "gone";
    const result = await openClass(code, boardId);
    if (result === "ok" || result === "taken") return result;
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(30000, wait * 2);
  }
}

export async function closeClass(code) {
  const mode = await checkLiveMode();
  if (!mode || !mode.private) return;
  try {
    await supabase.rpc("close_class", { p_code: code });
  } catch (err) {
    // the class just stays open until it is opened again
  }
}

export function _resetLiveModeForTests() {
  known = null;
  asking = null;
  rememberedMode = undefined;
}
