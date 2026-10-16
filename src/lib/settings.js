// A teacher's settings (the Settings panel, SettingsPanel.js).
//
// Kept in this browser straight away, so they work at once and without a
// connection, and also with the teacher's account (in the sign-in
// account's own settings, like graph presets), so the same settings appear
// on their iPad and their laptop. When both have a copy, the one changed
// most recently wins.
//
// Pencil-only isn't here: it depends on whether this device has a stylus,
// so it stays with the device (pencilPrefs.js).
//
// Components read a setting with useSetting("scribbleLevel"), or
// getSetting() outside React. The server render always sees the defaults
// and the saved values take over right after (no hydration mismatch).

import { useSyncExternalStore } from "react";
import { isValidOverrides, GESTURE_IDS } from "./shortcuts";

export const PEN_COLORS = [
  ["Black", "#1a1a1a"],
  ["Red", "#E53935"],
  ["Orange", "#FB8C00"],
  ["Green", "#43A047"],
  ["Blue", "#1E88E5"],
  ["Purple", "#8E24AA"],
  ["Teal", "#00897B"],
];

export const PAPERS = ["blank", "lined", "graph", "dots", "iso"];
export const PEN_SIZE_MIN = 1;
export const PEN_SIZE_MAX = 40;
export const DISPLAY_NAME_MAX = 40;

const oneOf = (list) => (v) => list.includes(v);
const isBool = (v) => typeof v === "boolean";

// name -> [default, is this value allowed?]
const SPEC = {
  scribbleErase: [true, isBool],
  scribbleLevel: ["normal", oneOf(["gentle", "normal", "eager"])],
  eraserMode: ["precise", oneOf(["precise", "stroke"])],
  moveReturns: [true, isBool], // the Move tool goes back to the last tool after one drag
  showHints: [true, isBool], // the one-line explanation beside the tools
  calcAngle: ["deg", oneOf(["deg", "rad"])],
  paper: ["blank", oneOf(PAPERS)], // new boards start on this paper
  penColor: ["#1a1a1a", oneOf(PEN_COLORS.map(([, hex]) => hex))],
  penSize: [4, (v) => Number.isInteger(v) && v >= PEN_SIZE_MIN && v <= PEN_SIZE_MAX],
  displayName: ["", (v) => typeof v === "string" && v.length <= DISPLAY_NAME_MAX && !/[\u0000-\u001f<>]/.test(v)],
  nameTags: [false, isBool], // other people's names at the tips of their pens
  singleKeys: [true, isBool], // shortcuts without Ctrl/⌘ (P for pen…)
  shortcuts: [{}, isValidOverrides], // the shortcuts someone changed (see shortcuts.js)
  gesture2: ["undo", oneOf(GESTURE_IDS)], // a two-finger tap
  gesture3: ["redo", oneOf(GESTURE_IDS)], // a three-finger tap
};

export const SETTING_NAMES = Object.keys(SPEC);
export const DEFAULTS = Object.fromEntries(SETTING_NAMES.map((k) => [k, SPEC[k][0]]));

export function isValidSetting(name, value) {
  return Object.prototype.hasOwnProperty.call(SPEC, name) && SPEC[name][1](value);
}

// Only the known settings, with allowed values.
export function cleanValues(values) {
  const out = {};
  if (!values || typeof values !== "object") return out;
  for (const name of SETTING_NAMES) {
    if (name in values && isValidSetting(name, values[name])) out[name] = values[name];
  }
  return out;
}

export function cleanDisplayName(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DISPLAY_NAME_MAX);
}

// ---------- the copy in this browser ----------

const KEY = "cleanslate_settings";
// settings that were kept on their own before this file existed
const OLD_KEYS = {
  scribbleErase: ["cleanslate_scribble_erase", (v) => (v === "0" ? false : v === "1" ? true : undefined)],
  eraserMode: ["cleanslate_eraser_mode", (v) => (v === "stroke" || v === "precise" ? v : undefined)],
  calcAngle: ["cleanslate_calc_angle", (v) => (v === "rad" || v === "deg" ? v : undefined)],
};

function storage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch (err) {
    return null;
  }
}

// { values, stamps, owner, syncedAt }
//   stamps   when each setting was last changed (so two devices can each
//            change a different setting without undoing the other)
//   owner    the account these settings belong to (null until someone
//            signs in on this browser)
//   syncedAt the newest change the account is known to have
let state = null;
const listeners = new Set();

const EMPTY = () => ({ values: {}, stamps: {}, owner: null, syncedAt: 0 });

function cleanStamps(stamps, values, fallback) {
  const out = {};
  for (const name of Object.keys(values)) {
    const t = stamps && Number(stamps[name]);
    out[name] = Number.isFinite(t) && t > 0 ? t : fallback;
  }
  return out;
}

const newest = (s) => Object.values(s.stamps).reduce((a, b) => Math.max(a, b), 0);

function readSaved() {
  const store = storage();
  if (!store) return undefined;
  try {
    const raw = store.getItem(KEY);
    return raw === null ? null : JSON.parse(raw);
  } catch (err) {
    return undefined;
  }
}

function fromSaved(saved) {
  const values = cleanValues(saved.values);
  return {
    values,
    stamps: cleanStamps(saved.stamps, values, Number(saved.updatedAt) || 0),
    owner: typeof saved.owner === "string" ? saved.owner : null,
    syncedAt: Number(saved.syncedAt) || 0,
  };
}

function load() {
  const saved = readSaved();
  if (saved && typeof saved === "object") return fromSaved(saved);
  // First time: bring across the settings that used to be kept separately
  // (stamped 0, so anything the account already has wins).
  const fresh = EMPTY();
  const store = storage();
  if (store) {
    for (const [name, [oldKey, read]] of Object.entries(OLD_KEYS)) {
      let raw = null;
      try {
        raw = store.getItem(oldKey);
      } catch (err) {
        raw = null;
      }
      const value = raw === null ? undefined : read(raw);
      if (value !== undefined && isValidSetting(name, value)) {
        fresh.values[name] = value;
        fresh.stamps[name] = 0;
      }
    }
  }
  return fresh;
}

function current() {
  if (!state) state = typeof window === "undefined" ? EMPTY() : load();
  return state;
}

// Picks up changes another tab has saved since (the copy in this browser
// is shared by every tab).
function reload() {
  const saved = readSaved();
  if (saved && typeof saved === "object") state = fromSaved(saved);
  return current();
}

function persist() {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    // storage full or switched off: the in-memory copy still works
  }
}

function notify() {
  listeners.forEach((listener) => listener());
}

let listeningToTabs = false;
function onStorage(e) {
  if (e.key !== KEY && e.key !== null) return;
  reload();
  notify();
}

export function subscribeSettings(listener) {
  listeners.add(listener);
  if (!listeningToTabs && typeof window !== "undefined" && window.addEventListener) {
    listeningToTabs = true;
    window.addEventListener("storage", onStorage);
  }
  return () => listeners.delete(listener);
}

export function getSetting(name) {
  const values = current().values;
  return name in values ? values[name] : DEFAULTS[name];
}

export function getServerSetting(name) {
  return DEFAULTS[name];
}

// React: the setting's value, kept up to date.
export function useSetting(name) {
  return useSyncExternalStore(
    subscribeSettings,
    () => getSetting(name),
    () => DEFAULTS[name]
  );
}

function change(patch, now) {
  const s = reload();
  const values = { ...s.values };
  const stamps = { ...s.stamps };
  let changed = false;
  for (const [name, value] of Object.entries(patch)) {
    if (name in values && values[name] === value) continue;
    values[name] = value;
    stamps[name] = Math.max(now, (stamps[name] || 0) + 1, newest(s) + 1);
    changed = true;
  }
  if (!changed) return;
  state = { ...s, values, stamps };
  persist();
  notify();
  scheduleUpload();
}

// Changes a setting (ignored if the value isn't allowed). Returns true if
// it was accepted.
export function setSetting(name, value, now = Date.now()) {
  if (!isValidSetting(name, value)) return false;
  change({ [name]: value }, now);
  return true;
}

// Back to the defaults (not the display name).
export function resetSettings(now = Date.now()) {
  const patch = {};
  for (const name of SETTING_NAMES) if (name !== "displayName") patch[name] = DEFAULTS[name];
  change(patch, now);
}

// The name to show for a signed-in teacher: the one they set in Settings,
// else the one from their Google account, else "" (show the email).
export function displayNameFor(user) {
  if (!user) return "";
  const s = current();
  if (s.owner === user.id && s.values.displayName) return s.values.displayName;
  const meta = user.user_metadata || {};
  return cleanDisplayName(meta.display_name || meta.full_name || meta.name || "");
}

// After deleting an account: forget this browser's copy.
export function forgetSettings() {
  disconnectSettings();
  state = EMPTY();
  const store = storage();
  try {
    if (store) store.removeItem(KEY);
  } catch (err) {
    // nothing to do
  }
  notify();
}

// ---------- with the account ----------

// "device" (kept in this browser only), "saving", or "account"
let where = "device";
let account = null; // { client, userId } while signed in
let uploadTimer = null;
let uploading = null;
export const UPLOAD_DELAY_MS = 800;

export function getSettingsWhere() {
  return where;
}

export function getServerSettingsWhere() {
  return "device";
}

function setWhere(next) {
  if (where === next) return;
  where = next;
  notify();
}

function accountCopy(user) {
  const meta = user && user.user_metadata;
  const saved = meta && meta.settings && typeof meta.settings === "object" ? meta.settings : null;
  if (!saved) return { values: {}, stamps: {} };
  const values = cleanValues(saved.values);
  return { values, stamps: cleanStamps(saved.stamps, values, Number(saved.updatedAt) || 0) };
}

// Each setting from whichever copy changed it most recently.
function merge(local, remote) {
  const values = { ...local.values };
  const stamps = { ...local.stamps };
  for (const name of Object.keys(remote.values)) {
    const theirs = remote.stamps[name] || 0;
    if (!(name in values) || theirs > (stamps[name] || 0)) {
      values[name] = remote.values[name];
      stamps[name] = theirs;
    }
  }
  return { values, stamps };
}

// true if `a` has a change `b` doesn't
function ahead(a, b) {
  return Object.keys(a.values).some((name) => (a.stamps[name] || 0) > (b.stamps[name] || 0) || !(name in b.values));
}

const sameValues = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The signed-in teacher as the server has them now (so changes made on
// another device are seen), or null.
async function freshUser(client) {
  try {
    if (typeof client.auth.getUser !== "function" || typeof client.auth.updateUser !== "function") return null;
    const { data, error } = await client.auth.getUser();
    if (error || !data || !data.user || data.user.id === "demo-user") return null;
    return data.user;
  } catch (err) {
    return null;
  }
}

async function upload() {
  if (!account) return false;
  const { client, userId } = account;
  let s = reload();
  if (s.owner !== userId) return false;
  setWhere("saving");
  // take in anything another device changed meanwhile, so it isn't undone
  const user = await freshUser(client);
  if (!account || account.userId !== userId) return false;
  s = reload();
  if (user && user.id === userId) {
    const merged = merge(s, accountCopy(user));
    if (!sameValues(merged.values, s.values) || !sameValues(merged.stamps, s.stamps)) {
      state = { ...s, ...merged };
      persist();
      notify();
      s = state;
    }
  }
  const sentAt = newest(s);
  const payload = { values: s.values, stamps: s.stamps, updatedAt: sentAt };
  try {
    const name = cleanDisplayName(s.values.displayName);
    const { error } = await client.auth.updateUser({ data: { settings: payload, display_name: name || null } });
    if (error) throw error;
    const now = reload();
    if (now.owner === userId) {
      state = { ...now, syncedAt: Math.max(now.syncedAt, sentAt) };
      persist();
    }
    setWhere(newest(state) > state.syncedAt ? "saving" : "account");
    return true;
  } catch (err) {
    setWhere("device");
    return false;
  }
}

function scheduleUpload() {
  if (!account) return;
  if (uploadTimer) clearTimeout(uploadTimer);
  setWhere("saving");
  uploadTimer = setTimeout(() => {
    uploadTimer = null;
    const sending = newest(current());
    uploading = upload().then((sent) => {
      uploading = null;
      // changed again while that was going: send the newer copy (but don't
      // keep retrying a failed one: the next change, or the next visit,
      // sends it)
      if (sent && account && state && newest(state) > sending && !uploadTimer) scheduleUpload();
    });
  }, UPLOAD_DELAY_MS);
}

// Sends any change still waiting, now (e.g. before signing out). Gives up
// after a few seconds so signing out never hangs on a slow connection.
export async function flushSettings(timeoutMs = 4000) {
  let job = null;
  if (uploadTimer) {
    clearTimeout(uploadTimer);
    uploadTimer = null;
    job = upload();
  } else if (uploading) {
    job = uploading;
  }
  if (job) await Promise.race([job, new Promise((res) => setTimeout(res, timeoutMs))]);
}

// Called when a teacher is signed in (and again when they come back to the
// tab): each setting from whichever copy changed it last, then anything
// only this browser had is sent to the account. Resolves with where the
// settings are kept now.
export async function connectSettings(client, userId) {
  if (!client || !userId) return where;
  account = { client, userId };
  let local = reload();
  if (local.owner && local.owner !== userId) {
    // This browser's settings belong to someone else who used it (a shared
    // computer): never hand them to this account. Start from this
    // account's own, or the defaults.
    state = { ...EMPTY(), owner: userId };
    persist();
    notify();
  } else if (!local.owner) {
    // made before anyone signed in here (the demo): they come along, except
    // a name, which can't have been this person's
    const values = { ...local.values };
    const stamps = { ...local.stamps };
    delete values.displayName;
    delete stamps.displayName;
    state = { ...local, values, stamps, owner: userId };
    persist();
  }
  const user = await freshUser(client);
  if (!account || account.userId !== userId) return where;
  if (!user || user.id !== userId) {
    // can't reach the account right now: keep using this browser's copy
    setWhere("device");
    return where;
  }
  local = reload();
  const remote = accountCopy(user);
  const merged = merge(local, remote);
  const changed = !sameValues(merged.values, local.values);
  const send = ahead(local, remote);
  state = { ...local, ...merged, syncedAt: send ? local.syncedAt : newest({ stamps: merged.stamps }) };
  persist();
  if (changed) notify();
  if (send) await upload();
  else setWhere("account");
  return where;
}

// Signed out: stop sending changes to that account (this browser keeps
// its copy).
export function disconnectSettings() {
  account = null;
  if (uploadTimer) clearTimeout(uploadTimer);
  uploadTimer = null;
  setWhere("device");
}

// For tests: forget everything held in memory.
export function _resetSettingsForTests() {
  state = null;
  account = null;
  where = "device";
  if (uploadTimer) clearTimeout(uploadTimer);
  uploadTimer = null;
  uploading = null;
}
