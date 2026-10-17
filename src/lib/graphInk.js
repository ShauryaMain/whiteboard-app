// Colours for graph paper, plots and charts, for a light or a dark page.
// renderGrid() says which while it draws (one graph at a time, start to
// finish), so the drawing code just asks for "the label colour" etc.

import { inkOn } from "./inkColor";

let dark = false;

// Returns what it was, so it can be put back afterwards.
export function setGraphDark(value) {
  const was = dark;
  dark = !!value;
  return was;
}

export function graphDark() {
  return dark;
}

export const graphText = () => (dark ? "#eef1f6" : "#1B1D24");
export const graphAxis = () => (dark ? "#b9c5d6" : "#5b6b80");
export const graphName = () => (dark ? "#d7dfea" : "#3b4757");
export const graphHalo = () => (dark ? "rgba(17,19,24,0.88)" : "rgba(255,255,255,0.92)");
// the inside of an open circle, a legend's card
export const graphHole = () => (dark ? "#1c2027" : "#ffffff");
export const graphCard = () => (dark ? "rgba(24,27,33,0.9)" : "rgba(255,255,255,0.9)");
export const graphCardEdge = () => (dark ? "rgba(255,255,255,0.22)" : "rgba(27,29,36,0.25)");
// grid lines in the default colour are a little too bright on a dark page
export const graphLines = (color) => (dark && (!color || color === "#cfd8e3") ? "rgba(214,224,238,0.32)" : color || "#cfd8e3");
// a plotted line or point: black shows white on a dark page, like ink
export const graphInk = (color) => (dark && color ? inkOn(color, true) : color);
