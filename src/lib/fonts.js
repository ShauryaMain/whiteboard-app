// Fonts for text boxes: a list of Google Fonts, and fonts people upload
// (.ttf, .otf, .woff, .woff2), kept with their account (Settings:
// "customFonts") and stored in the app's own storage so everyone looking
// at the board sees them too (a text box carries the address of any
// uploaded font it uses: see richText.js, doc.fx).
//
// Fonts load in the background; whatever is waiting to be drawn with one
// is redrawn when it arrives (subscribeFonts).

import { setFontHooks, isFontUrl } from "./richText";

// Popular, readable Google Fonts, in groups. Loaded only when used.
export const GOOGLE_FONTS = [
  ["Clean", ["Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Nunito", "Raleway", "Quicksand", "Noto Sans"]],
  ["Easy to read", ["Lexend", "Atkinson Hyperlegible", "Comic Neue"]],
  ["Serif", ["Merriweather", "Lora", "Playfair Display", "Roboto Slab", "Source Serif 4", "Noto Serif"]],
  ["Handwriting", ["Caveat", "Patrick Hand", "Kalam", "Indie Flower", "Architects Daughter", "Gochi Hand", "Schoolbell", "Shantell Sans"]],
  ["Display", ["Bebas Neue", "Oswald", "Pacifico", "Lobster"]],
  ["Code", ["Fira Code", "Source Code Pro", "JetBrains Mono"]],
];
export const GOOGLE_FONT_NAMES = GOOGLE_FONTS.flatMap(([, list]) => list);
const GOOGLE_SET = new Set(GOOGLE_FONT_NAMES);

export const MAX_FONT_BYTES = 3 * 1024 * 1024;
export const MAX_CUSTOM_FONTS = 12;
const EXT_TYPES = { ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2" };

let version = 0;
const listeners = new Set();
const state = new Map(); // family -> "loading" | "ready" | "failed"

export function fontsVersion() {
  return version;
}

export function subscribeFonts(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function loaded(family) {
  state.set(family, "ready");
  version += 1;
  listeners.forEach((fn) => {
    try {
      fn(family);
    } catch (err) {
      // a board that has gone
    }
  });
}

export function fontState(family) {
  return state.get(family) || null;
}

export function googleFontUrl(family) {
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}&display=swap`;
}

// Starts loading a font if it isn't already (a Google font by name, or an
// uploaded one from its address). Does nothing for unknown names.
export function ensureFont(family, url) {
  if (typeof document === "undefined" || !family || state.has(family)) return;
  // an upload can't stand in for one of the Google fonts
  if (url && !GOOGLE_SET.has(family) && isFontUrl(url) && typeof FontFace !== "undefined") {
    state.set(family, "loading");
    try {
      const face = new FontFace(family, `url("${url}")`);
      face
        .load()
        .then((f) => {
          document.fonts.add(f);
          loaded(family);
        })
        .catch(() => state.set(family, "failed"));
    } catch (err) {
      state.set(family, "failed");
    }
    return;
  }
  if (!GOOGLE_SET.has(family)) return;
  state.set(family, "loading");
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = googleFontUrl(family);
  link.dataset.font = family;
  link.onload = () => {
    if (!document.fonts || !document.fonts.load) return loaded(family);
    Promise.all([document.fonts.load(`16px "${family}"`), document.fonts.load(`700 16px "${family}"`)])
      .then(() => loaded(family))
      .catch(() => loaded(family));
  };
  link.onerror = () => state.set(family, "failed");
  document.head.appendChild(link);
}

setFontHooks({ ensure: ensureFont, version: fontsVersion });

// "My-Font_Bold.ttf" -> "My Font Bold"
export function fontNameFromFile(fileName) {
  const base = String(fileName || "Font").replace(/\.[^.]+$/, "");
  const clean = base.replace(/[_\-.]+/g, " ").replace(/[^A-Za-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  return (clean || "My font").slice(0, 40);
}

// Checks a font file, uploads it, and starts using it. Returns
// { name, url }, or throws an Error with a message to show.
// It goes in the account's own fonts folder; if storage won't take it
// there, in the board's folder (where the board's pictures go).
export async function uploadFont(file, client, userId, takenNames = [], boardId = null) {
  if (!file) throw new Error("No file chosen.");
  const ext = String(file.name || "").split(".").pop().toLowerCase();
  if (!EXT_TYPES[ext]) throw new Error("That isn't a font file. Choose a .ttf, .otf, .woff or .woff2 file.");
  if (file.size > MAX_FONT_BYTES) throw new Error("That font file is too big (3 MB at most).");
  if (!client || !userId) throw new Error("Sign in to upload fonts.");
  const taken = new Set(takenNames.map((x) => x.toLowerCase()).concat(GOOGLE_FONT_NAMES.map((x) => x.toLowerCase())));
  let name = fontNameFromFile(file.name);
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${fontNameFromFile(file.name).slice(0, 36)} ${n}`;
  // is it really a font?
  const data = await file.arrayBuffer();
  if (typeof FontFace !== "undefined") {
    try {
      const face = new FontFace(name, data);
      await face.load();
      document.fonts.add(face);
    } catch (err) {
      throw new Error("That file couldn't be read as a font.");
    }
  }
  const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  const places = [`fonts/${userId}/${id}.${ext}`];
  if (boardId) places.push(`${boardId}/fonts/${id}.${ext}`);
  for (const path of places) {
    let failed = true;
    try {
      const { error } = await client.storage.from("board-images").upload(path, file, { contentType: EXT_TYPES[ext], upsert: false });
      failed = !!error;
    } catch (err) {
      failed = true;
    }
    if (failed) continue;
    const { data: pub } = client.storage.from("board-images").getPublicUrl(path);
    const url = pub && pub.publicUrl;
    if (!isFontUrl(url)) break;
    loaded(name);
    return { name, url };
  }
  throw new Error("The font couldn't be uploaded. Check your connection and try again.");
}

// Starts loading every font someone has uploaded (so the font list and
// the text box show them).
export function ensureCustomFonts(list) {
  for (const f of list || []) if (f && f.name && f.url) ensureFont(f.name, f.url);
}
