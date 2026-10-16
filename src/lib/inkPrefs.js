// Ink preferences, now part of the teacher's settings (settings.js), which
// keeps them in this browser and with their account:
// - eraserMode: "precise" rubs out only where you drag; "stroke" removes
//   any whole line it touches.
// - scribbleErase: scribbling back and forth over ink erases it (how
//   readily is the "scribbleLevel" setting).
// Kept as its own small module so the board's existing calls don't change.

import { getSetting, setSetting, subscribeSettings } from "./settings";

export function subscribeInkPrefs(listener) {
  return subscribeSettings(listener);
}

export function getEraserMode() {
  return getSetting("eraserMode") === "stroke" ? "stroke" : "precise";
}

export function getServerEraserMode() {
  return "precise";
}

export function setEraserMode(mode) {
  setSetting("eraserMode", mode === "stroke" ? "stroke" : "precise");
}

export function getScribbleErase() {
  return getSetting("scribbleErase") !== false;
}

export function getServerScribbleErase() {
  return true;
}

export function setScribbleErase(on) {
  setSetting("scribbleErase", !!on);
}

export function getScribbleLevel() {
  return getSetting("scribbleLevel");
}
