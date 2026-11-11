// A notebook page's title, for the Contents list, the Starred list, links
// between pages and the exported PDF's contents.
//
// A title the owner typed wins. Otherwise it's taken from the page: the
// first line of the text box nearest the top (a heading, or the title of
// a Cornell page), else the title of the homework it came in with, else
// just "Page 7".

import { plainText } from "./richText";
import { layoutPages, pageIndexAt } from "./notebook";

const MAX = 60;

function firstLine(raw) {
  const line = plainText(raw)
    .split("\n")
    .map((l) => l.replace(/[​⁣]/g, "").trim())
    .find((l) => l.length > 0);
  if (!line) return "";
  return line.length > MAX ? line.slice(0, MAX - 1).trimEnd() + "…" : line;
}

// [{ title, auto, from }] for every page. from: "typed" | "text" | "clip" | "number"
// clipTitles (optional): { clipId: "Algebra homework" }
export function pageTitles(nb, texts = [], clipTitles = null) {
  if (!nb || !Array.isArray(nb.pages)) return [];
  const layout = layoutPages(nb);
  // the text box nearest the top of each page (then the leftmost)
  const top = layout.map(() => null);
  if (layout.length) {
    for (const t of texts || []) {
      if (!t || typeof t.y !== "number") continue;
      const i = pageIndexAt(layout, t.y);
      const text = firstLine(t.text);
      if (!text) continue;
      const best = top[i];
      if (!best || t.y < best.y - 4 || (Math.abs(t.y - best.y) <= 4 && t.x < best.x)) top[i] = { y: t.y, x: t.x, text };
    }
  }
  // a homework's title goes on its first page only
  const seenClip = new Set();
  return nb.pages.map((page, i) => {
    if (page.title) return { title: page.title, auto: false, from: "typed" };
    if (top[i]) return { title: top[i].text, auto: true, from: "text" };
    if (page.clip && clipTitles && clipTitles[page.clip] && !seenClip.has(page.clip)) {
      seenClip.add(page.clip);
      return { title: clipTitles[page.clip], auto: true, from: "clip" };
    }
    if (page.clip) seenClip.add(page.clip);
    return { title: `Page ${i + 1}`, auto: true, from: "number" };
  });
}

// A typed title, tidied ("" takes it away, so the page's own words are used).
export function cleanTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
}
