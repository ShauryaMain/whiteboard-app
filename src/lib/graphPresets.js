// Graph presets: one tap to set the graph dialog up. A few come built in;
// teachers can save their own, which are kept with their account (in the
// sign-in account's own settings, so no table is needed and they follow
// the teacher to any computer or iPad). Where there's no account to keep
// them with (the demo board, or if saving there fails) they're kept in
// this browser.

import { DEFAULT_AXIS, piStepValue } from "./graphAxes";

// the app's Supabase client (loaded when first needed)
async function appClient() {
  const mod = await import("./supabaseClient");
  return mod.supabase;
}

const BROWSER_KEY = "cleanslate_graph_presets";
// (kept small: they travel with every request the signed-in app makes)
export const MAX_PRESETS = 8;

// The settings a preset carries (not what's plotted, nor where it is).
export const PRESET_KEYS = [
  "type", "axes", "minor", "numbersEvery", "arrows", "style", "unitCircle", "showAxes", "showNumbers", "showUnitCircle",
  "color", "cellSizePx", "snap", "spokeCount", "unitsPerCell", "unitLabel", "trig", "trigStep", "cols", "rows",
];

const axis = (patch) => ({ ...DEFAULT_AXIS, ...patch });

export const BUILT_IN_PRESETS = [
  {
    id: "builtin-ten",
    name: "−10 to 10",
    settings: { type: "cartesian", axes: { x: axis({ min: -10, max: 10 }), y: axis({ min: -10, max: 10 }) }, minor: 0, numbersEvery: "auto", arrows: true, showAxes: true, showNumbers: true, showUnitCircle: false, cellSizePx: 30 },
  },
  {
    id: "builtin-first",
    name: "First quadrant",
    settings: { type: "cartesian", axes: { x: axis({ min: 0, max: 10 }), y: axis({ min: 0, max: 10 }) }, minor: 0, numbersEvery: "auto", arrows: true, showAxes: true, showNumbers: true, showUnitCircle: false, cellSizePx: 44 },
  },
  {
    id: "builtin-trig",
    name: "Trig −2π to 2π",
    settings: {
      type: "cartesian",
      axes: {
        x: axis({ label: "pi", piStep: { num: 1, den: 2 }, min: -2 * Math.PI, max: 2 * Math.PI, step: piStepValue({ num: 1, den: 2 }) }),
        y: axis({ min: -2, max: 2, step: 0.5 }),
      },
      minor: 0,
      numbersEvery: "auto",
      arrows: true,
      showAxes: true,
      showNumbers: true,
      showUnitCircle: false,
      cellSizePx: 52,
    },
  },
  {
    id: "builtin-line",
    name: "Number line",
    settings: { type: "numberline", axes: { x: axis({ min: -10, max: 10 }), y: axis({}) }, minor: 0, numbersEvery: "auto", arrows: true, showNumbers: true, cellSizePx: 40 },
  },
];

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

// Only the preset's own settings (from a dialog's settings), kept small:
// they're stored in the sign-in account's settings, which travel with
// every request the app makes, so an axis only keeps what differs from the
// usual (its range and step always).
export function presetSettings(config) {
  const out = {};
  for (const k of PRESET_KEYS) if (config[k] !== undefined && config[k] !== null) out[k] = config[k];
  if (!out.showUnitCircle) delete out.unitCircle;
  const copy = JSON.parse(JSON.stringify(out));
  if (isObj(copy.axes)) {
    for (const which of ["x", "y"]) {
      const a = copy.axes[which];
      if (!isObj(a)) continue;
      for (const key of Object.keys(a)) {
        if (key === "min" || key === "max" || key === "step") continue;
        if (JSON.stringify(a[key]) === JSON.stringify(DEFAULT_AXIS[key])) delete a[key];
      }
    }
  }
  return copy;
}

// A preset's settings, ready to put into the dialog (each axis filled in).
export function expandPreset(settings) {
  const s = JSON.parse(JSON.stringify(isObj(settings) ? settings : {}));
  if (isObj(s.axes)) {
    s.axes = {
      x: { ...DEFAULT_AXIS, ...(isObj(s.axes.x) ? s.axes.x : {}) },
      y: { ...DEFAULT_AXIS, ...(isObj(s.axes.y) ? s.axes.y : {}) },
    };
  }
  return s;
}

// all of a teacher's presets together, at most (characters)
const MAX_TOTAL = 4000;

// A list of presets as kept (anything odd dropped, and no more than fits).
export function cleanPresets(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  let total = 0;
  for (const p of list) {
    if (!isObj(p) || typeof p.id !== "string" || typeof p.name !== "string" || !isObj(p.settings)) continue;
    const kept = { id: p.id.slice(0, 40), name: p.name.slice(0, 40), settings: p.settings };
    const size = JSON.stringify(kept).length;
    if (size > 1200 || total + size > MAX_TOTAL || out.length >= MAX_PRESETS) continue;
    total += size;
    out.push(kept);
  }
  return out;
}

function readBrowser() {
  try {
    return cleanPresets(JSON.parse(window.localStorage.getItem(BROWSER_KEY) || "[]"));
  } catch (err) {
    return [];
  }
}

function writeBrowser(list) {
  try {
    window.localStorage.setItem(BROWSER_KEY, JSON.stringify(list));
    return true;
  } catch (err) {
    return false;
  }
}

// The signed-in teacher, as the server has them now (so presets saved on
// another computer or iPad are seen), or null (signed out, the demo board).
async function accountUser(client) {
  try {
    const { data } = await client.auth.getSession();
    const user = data && data.session && data.session.user;
    if (!user || user.id === "demo-user" || typeof client.auth.updateUser !== "function") return null;
    if (typeof client.auth.getUser === "function") {
      try {
        const fresh = await client.auth.getUser();
        if (fresh && fresh.data && fresh.data.user) return fresh.data.user;
      } catch (err) {
        // the copy kept in this browser will do
      }
    }
    return user;
  } catch (err) {
    return null;
  }
}

const accountList = (user) => cleanPresets(isObj(user.user_metadata) ? user.user_metadata.graphPresets : null);

// Presets kept in this browser that aren't in the account's list (saved
// here when the account couldn't be reached).
function withBrowserOnes(list) {
  const ids = new Set(list.map((p) => p.id));
  return cleanPresets([...list, ...readBrowser().filter((p) => !ids.has(p.id))]);
}

// The teacher's own presets: { presets, where: "account" | "browser" }.
export async function loadGraphPresets(given) {
  const client = given || (await appClient());
  const user = await accountUser(client);
  if (user) return { presets: withBrowserOnes(accountList(user)), where: "account" };
  return { presets: readBrowser(), where: "browser" };
}

// Saves the teacher's presets: with the account if there is one (falling
// back to this browser if that fails). Resolves with where they went.
export async function saveGraphPresets(list, given) {
  const presets = cleanPresets(list);
  const client = given || (await appClient());
  const user = await accountUser(client);
  if (user) {
    try {
      const { error } = await client.auth.updateUser({ data: { graphPresets: presets } });
      if (!error) {
        // (they're all in the account now)
        writeBrowser([]);
        return "account";
      }
    } catch (err) {
      // falls back to the browser
    }
  }
  writeBrowser(presets);
  return "browser";
}
