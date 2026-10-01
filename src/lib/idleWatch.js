// Pauses live syncing when nobody is using an open board, so a forgotten
// tab doesn't hold a realtime connection open (and keep receiving
// messages) for hours.
//
// "In use" means: drawing, typing, tapping, scrolling or moving the mouse
// on the page, OR watching someone else draw while the tab is on screen.
// A tab that's hidden in the background counts as idle.
//
// Same tiny-store pattern as inkPrefs.js, read with useSyncExternalStore.

import { supabase } from "./supabaseClient";

export const IDLE_MS = 20 * 60 * 1000;
const CHECK_MS = 30 * 1000;

let lastActive = Date.now();
let paused = false;
let users = 0;
let timer = null;
let authStopped = false;
const listeners = new Set();

function emit() {
  listeners.forEach((l) => l());
}

function visible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function pause() {
  if (paused) return;
  paused = true;
  // No token refreshes while nobody's here either (resumed on return).
  authStopped = true;
  Promise.resolve()
    .then(() => supabase.auth.stopAutoRefresh())
    .catch(() => {});
  emit();
}

function check() {
  if (!paused && Date.now() - lastActive >= IDLE_MS) pause();
}

function onInput() {
  if (!paused) lastActive = Date.now();
}

function onVisibility() {
  if (paused) return;
  if (visible()) {
    // Back after a long time away (iPads freeze background tabs, so the
    // timer may not have had a chance to fire): pause now, and the first
    // tap catches up.
    if (Date.now() - lastActive >= IDLE_MS) pause();
    else lastActive = Date.now();
  }
}

const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"];

export function startIdleWatch() {
  users += 1;
  if (users === 1) {
    lastActive = Date.now();
    paused = false;
    INPUT_EVENTS.forEach((type) => window.addEventListener(type, onInput, { capture: true, passive: true }));
    document.addEventListener("visibilitychange", onVisibility);
    timer = setInterval(check, CHECK_MS);
  }
  return stopIdleWatch;
}

function stopIdleWatch() {
  users = Math.max(0, users - 1);
  if (users > 0) return;
  INPUT_EVENTS.forEach((type) => window.removeEventListener(type, onInput, { capture: true }));
  document.removeEventListener("visibilitychange", onVisibility);
  if (timer) clearInterval(timer);
  timer = null;
  if (paused) resumeFromIdle();
}

// Someone else changed the board. Only counts if this person can see it.
export function noteRemoteActivity() {
  if (!paused && visible()) lastActive = Date.now();
}

export function resumeFromIdle() {
  lastActive = Date.now();
  if (!paused) return;
  paused = false;
  if (authStopped) {
    authStopped = false;
    // (if this fails, the next request refreshes the login anyway)
    Promise.resolve()
      .then(() => supabase.auth.startAutoRefresh())
      .catch(() => {});
  }
  emit();
}

export function subscribeIdle(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isIdlePaused() {
  return paused;
}

export function getServerIdlePaused() {
  return false;
}
