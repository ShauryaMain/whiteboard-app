// Who else has this board open, and where they are on it.
//
// Each signed-in person on a board announces themselves once over the
// board's live channel ("presence": who they are), and then sends a small
// "person-where" message whenever they move around or write: the part of
// the board their screen shows, and where they last wrote. (Where they are
// isn't part of the announcement because changing an announcement trips a
// fault in the live-connection library: see src/lib/classRoster.js.)
// With that the board can:
//   • show a coloured initial for each of them in the top bar,
//   • jump to what they're looking at when you tap it (and outline their
//     screen for a moment),
//   • put a small name tag at the tip of their pen while they write.
// Nothing here is saved; it disappears when they leave.

// (all dark enough for white letters on them)
export const PEOPLE_COLORS = ["#C2410C", "#2B8A3E", "#7048E8", "#C2255C", "#0B7285", "#8F6F00", "#3B5BDB", "#C92A2A"];

// What goes out instead of someone's account id: enough to tell that two
// tabs are the same person, without handing their real id to everyone on
// the board.
export function personId(userId) {
  const text = "cleanslate-person:" + String(userId || "");
  let a = 2166136261;
  let b = 5381;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = (Math.imul(b, 33) + c) >>> 0;
  }
  return a.toString(36) + b.toString(36);
}

// the colour a person would like (the same every time); two people on one
// screen never share one (see peopleFrom)
export function colorFor(id) {
  const text = String(id || "");
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return PEOPLE_COLORS[h % PEOPLE_COLORS.length];
}

// "Priya Shah" -> "Priya"; "j.smith23@school.org" -> "J.smith23"
export function nameFor(displayName, email) {
  const name = String(displayName || "").trim();
  if (name) return name.slice(0, 40);
  const local = String(email || "").split("@")[0].trim();
  if (!local) return "Someone";
  return (local.charAt(0).toUpperCase() + local.slice(1)).slice(0, 40);
}

export function shortName(name) {
  const first = String(name || "").trim().split(/\s+/)[0] || "Someone";
  return first.length > 16 ? first.slice(0, 15) + "…" : first;
}

export function initialOf(name) {
  const ch = Array.from(String(name || "").trim())[0];
  return ch ? ch.toUpperCase() : "?";
}

const finite = (v) => typeof v === "number" && Number.isFinite(v);
function cleanRect(r) {
  if (!r || !finite(r.x) || !finite(r.y) || !finite(r.w) || !finite(r.h) || r.w <= 0 || r.h <= 0) return null;
  return { x: r.x, y: r.y, w: r.w, h: r.h };
}
function cleanPoint(p) {
  if (!p || !finite(p.x) || !finite(p.y)) return null;
  return { x: p.x, y: p.y };
}

// Where this person is (kept small: it goes out again whenever they move
// around the board).
export function wherePayload({ view, ink }) {
  const round = (v) => Math.round(v);
  return {
    view: view ? { x: round(view.x), y: round(view.y), w: Math.max(1, round(view.w)), h: Math.max(1, round(view.h)) } : null,
    ink: ink ? { x: round(ink.x), y: round(ink.y) } : null,
  };
}

// Same content? (so an unchanged view isn't sent again)
export function sameWhere(a, b) {
  return !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
}

// Who is here ({ tab key: [announcement, …] }, see attendanceState in
// classRoster.js) plus where each tab last said it was (Map of tab key ->
// { view, ink, t }) -> everyone else on the board, one entry per person
// (someone with the board open in two tabs shows once, as the tab that
// moved last), and a lookup from each tab's key to its person for the
// name tags.
export function peopleFrom(state, where, myUid, myKey) {
  const byUid = new Map();
  const byKey = new Map();
  for (const [key, metas] of Object.entries(state || {})) {
    if (key === myKey || !Array.isArray(metas) || !metas.length) continue;
    const m = metas[metas.length - 1];
    if (!m || !m.uid || m.uid === myUid) continue;
    const name = nameFor(m.name);
    const w = (where && where.get(key)) || {};
    const person = {
      key,
      uid: String(m.uid),
      name,
      short: shortName(name),
      initial: initialOf(name),
      color: null, // given below
      view: cleanRect(w.view),
      ink: cleanPoint(w.ink),
      t: finite(w.t) ? w.t : 0,
    };
    byKey.set(key, person);
    const prev = byUid.get(person.uid);
    if (!prev || person.t >= prev.t) byUid.set(person.uid, person);
  }
  const list = [...byUid.values()].sort((a, b) => a.name.localeCompare(b.name) || a.uid.localeCompare(b.uid));
  // colours: each person their own (their usual one if it's free); the
  // viewer's own colour is taken first, so nobody looks like you
  const taken = new Set([colorFor(myUid)]);
  const colorOf = new Map();
  for (const p of [...list].sort((a, b) => a.uid.localeCompare(b.uid))) {
    let c = colorFor(p.uid);
    if (taken.has(c)) {
      const i = PEOPLE_COLORS.indexOf(c);
      for (let k = 1; k <= PEOPLE_COLORS.length; k++) {
        const next = PEOPLE_COLORS[(i + k) % PEOPLE_COLORS.length];
        if (!taken.has(next)) {
          c = next;
          break;
        }
      }
    }
    taken.add(c);
    colorOf.set(p.uid, c);
  }
  for (const p of byKey.values()) p.color = colorOf.get(p.uid) || colorFor(p.uid);
  return { list, byKey };
}

// Just what the top bar shows, to tell whether it needs redrawing.
export function facesKey(list) {
  return list.map((p) => `${p.key}|${p.name}|${p.color}`).join(",");
}

// The view that shows someone else's screen on yours: their area fills
// your board (with a little room round it), centred.
export function viewFor(person, pane, current, minScale, maxScale) {
  const clamp = (s) => Math.min(maxScale, Math.max(minScale, s));
  let scale;
  let cx;
  let cy;
  if (person.view) {
    const r = person.view;
    scale = clamp(Math.min(pane.width / r.w, pane.height / r.h) * 0.92);
    cx = r.x + r.w / 2;
    cy = r.y + r.h / 2;
  } else if (person.ink) {
    scale = clamp(current.scale);
    cx = person.ink.x;
    cy = person.ink.y;
  } else {
    return null;
  }
  return { scale, pan: { x: pane.width / 2 - cx * scale, y: pane.height / 2 - cy * scale } };
}

// A point part-way between two views (t from 0 to 1): the zoom changes
// evenly (in steps that feel even to the eye) and the middle of the screen
// glides between the two spots.
export function viewBetween(from, to, t, pane) {
  const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const scale = Math.exp(Math.log(from.scale) + (Math.log(to.scale) - Math.log(from.scale)) * e);
  const c0 = { x: (pane.width / 2 - from.pan.x) / from.scale, y: (pane.height / 2 - from.pan.y) / from.scale };
  const c1 = { x: (pane.width / 2 - to.pan.x) / to.scale, y: (pane.height / 2 - to.pan.y) / to.scale };
  const cx = c0.x + (c1.x - c0.x) * e;
  const cy = c0.y + (c1.y - c0.y) * e;
  return { scale, pan: { x: pane.width / 2 - cx * scale, y: pane.height / 2 - cy * scale } };
}

// The name tags at the tips of other people's pens. They're plain
// elements moved by hand (not React), because they follow the pen many
// times a second.
export function createPenTags(className) {
  const tags = new Map(); // tab key -> { el, pt, timer }
  let layer = null;
  return {
    attach(el) {
      layer = el;
      if (!el) {
        for (const t of tags.values()) clearTimeout(t.timer);
        tags.clear();
      }
    },
    show(key, person, pt, toScreen) {
      if (!layer || !person || !pt) return;
      let tag = tags.get(key);
      if (!tag) {
        const el = document.createElement("span");
        el.className = className;
        el.setAttribute("aria-hidden", "true");
        el.setAttribute("data-pen-tag", person.uid);
        layer.appendChild(el);
        tag = { el, pt, timer: null };
        tags.set(key, tag);
      }
      tag.el.textContent = person.short;
      tag.el.style.background = person.color;
      tag.el.style.opacity = "1";
      tag.pt = pt;
      this.place(tag, toScreen);
      this.keepAlive(key);
    },
    move(key, pt, toScreen) {
      const tag = tags.get(key);
      if (!tag || !pt) return;
      tag.pt = pt;
      this.place(tag, toScreen);
      this.keepAlive(key);
    },
    // If the "pen lifted" message never comes (lost, or they left mid-line),
    // the tag still goes once nothing has moved for a few seconds.
    keepAlive(key) {
      const tag = tags.get(key);
      if (!tag) return;
      clearTimeout(tag.timer);
      tag.timer = setTimeout(() => this.done(key, 0), 3000);
    },
    clear() {
      for (const tag of tags.values()) {
        clearTimeout(tag.timer);
        tag.el.remove();
      }
      tags.clear();
    },
    // fades a moment after they lift the pen
    done(key, delay = 1200) {
      const tag = tags.get(key);
      if (!tag) return;
      clearTimeout(tag.timer);
      tag.timer = setTimeout(() => {
        tag.el.style.opacity = "0";
        tag.timer = setTimeout(() => {
          tag.el.remove();
          tags.delete(key);
        }, 400);
      }, delay);
    },
    place(tag, toScreen) {
      const p = toScreen(tag.pt);
      tag.el.style.transform = `translate(${Math.round(p.x + 10)}px, ${Math.round(p.y - 30)}px)`;
    },
    reposition(toScreen) {
      for (const tag of tags.values()) this.place(tag, toScreen);
    },
  };
}
