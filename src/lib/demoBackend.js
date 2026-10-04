// The demo board's backend: a small in-memory stand-in for the Supabase
// client, used ONLY on the /demo page (see supabaseClient.js).
//
// It answers the same calls the board makes (reads, saves, live channels,
// file uploads, sign-in) but keeps everything in this browser tab's memory.
// Nothing a demo visitor draws is sent anywhere or saved, and the real
// database is never contacted. Reloading the page starts a fresh demo.
//
// Two extras:
//   - "Try a live class" is answered by pretend students (demoClassroom.js).
//   - "Sign in free to keep your work" asks this file for a copy of the
//     board (carrySnapshot below), which demoCarry.js holds on to until
//     the visitor has signed in and it can be saved as a real board.

import { createDemoClassroom } from "./demoClassroom";

export const DEMO_BOARD_ID = "demo";
const DEMO_USER = { id: "demo-user", email: "", user_metadata: { full_name: "Demo visitor" } };
const DEMO_SESSION = { user: DEMO_USER, access_token: "demo", expires_at: 4102444800 };

// True when the page that is loading is the demo board.
export function isDemoPath(pathname) {
  return /^\/demo(\/|$)/.test(String(pathname || ""));
}

export function isDemoPage() {
  return typeof window !== "undefined" && isDemoPath(window.location.pathname);
}

// ---------- the starter board ----------

// A slightly wobbly line through the given points, so the starter drawing
// looks hand-drawn rather than computer-perfect.
function inkStroke(id, color, width, points) {
  const pts = points.map(([x, y], i) => ({
    x: Math.round((x + Math.sin(i * 1.7) * 0.6) * 100) / 100,
    y: Math.round((y + Math.cos(i * 1.3) * 0.6) * 100) / 100,
  }));
  return { id, board_id: DEMO_BOARD_ID, data: { tool: "pen", color, width, opacity: 1, points: pts } };
}

function linePoints(x0, y0, x1, y1, steps) {
  const out = [];
  for (let i = 0; i <= steps; i++) out.push([x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps]);
  return out;
}

function circlePoints(cx, cy, r) {
  const out = [];
  for (let i = 0; i <= 26; i++) {
    const a = (i / 24) * Math.PI * 2 - 0.6;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

function starterStrokes() {
  // A sketch of y = (x - 2)^2 - 1: axes, the curve, and its two roots circled.
  const ox = 150;
  const oy = 420;
  const unit = 44;
  const curve = [];
  for (let i = 0; i <= 46; i++) {
    const x = -0.3 + (4.6 * i) / 46;
    curve.push([ox + unit * x, oy - unit * ((x - 2) * (x - 2) - 1)]);
  }
  return [
    inkStroke("demo-s1", "#1a1a1a", 3, linePoints(80, oy, 390, oy, 30)),
    inkStroke("demo-s2", "#1a1a1a", 3, [[380, oy - 7], [391, oy], [380, oy + 7]]),
    inkStroke("demo-s3", "#1a1a1a", 3, linePoints(ox, 480, ox, 215, 28)),
    inkStroke("demo-s4", "#1a1a1a", 3, [[ox - 7, 226], [ox, 214], [ox + 7, 226]]),
    inkStroke("demo-s5", "#1E88E5", 4, curve),
    inkStroke("demo-s6", "#E53935", 3, circlePoints(ox + unit, oy, 12)),
    inkStroke("demo-s7", "#E53935", 3, circlePoints(ox + unit * 3, oy, 12)),
  ];
}

function starterTexts() {
  const text = (id, x, y, fontSize, width, color, value) => ({
    id, board_id: DEMO_BOARD_ID, x, y, text: value, color, font_size: fontSize, width, rotation: 0,
  });
  return [
    text("demo-t1", 56, 36, 32, 640, "#1a1a1a", "This is a real Clean Slate board."),
    text("demo-t2", 56, 96, 20, 640, "#1E88E5", "Pick the Pen and write anywhere. Scribble over something to rub it out."),
    text("demo-t3", 440, 236, 20, 300, "#1a1a1a", "Maths menu: ruler, compass, graph paper and a calculator."),
    text("demo-t4", 440, 340, 20, 300, "#1a1a1a", "Insert menu: pictures, a worksheet beside the board, simulations."),
    text("demo-t5", 56, 520, 18, 660, "#8E24AA", "Nothing on this demo board is saved. Sign in (it's free) to keep your boards and run a live class."),
  ];
}

// The starter board is laid out for a tablet-sized screen (about 720px
// wide). On a narrower screen (a phone) it is shrunk to fit and moved
// down a little, clear of the zoom control in the top corner.
function starterFit() {
  const width = typeof window === "undefined" ? 1024 : window.innerWidth || 1024;
  const k = Math.min(1, Math.max(0.5, (width - 16) / 720));
  return { k, dy: k < 1 ? 56 : 0 };
}

function fitStroke(row, { k, dy }) {
  if (k === 1 && !dy) return row;
  const round = (n) => Math.round(n * 100) / 100;
  return {
    ...row,
    data: {
      ...row.data,
      width: Math.max(2, round(row.data.width * k)),
      points: row.data.points.map((pt) => ({ x: round(pt.x * k), y: round(pt.y * k + dy) })),
    },
  };
}

function fitText(row, { k, dy }) {
  if (k === 1 && !dy) return row;
  return {
    ...row,
    x: Math.round(row.x * k),
    y: Math.round(row.y * k + dy),
    width: Math.round(row.width * k),
    font_size: Math.max(13, Math.round(row.font_size * k)),
  };
}

function starterTables() {
  const now = Date.now();
  const fit = starterFit();
  const stamp = (rows) => rows.map((r, i) => ({ ...r, created_at: new Date(now + i).toISOString() }));
  return {
    boards: stamp([
      {
        id: DEMO_BOARD_ID,
        owner_id: DEMO_USER.id,
        name: "Demo board",
        grid_config: null,
        background: "graph",
        sim_embeds: [],
        thumbnail: null,
      },
    ]),
    strokes: stamp(starterStrokes().map((r) => fitStroke(r, fit))),
    texts: stamp(starterTexts().map((r) => fitText(r, fit))),
    images: [],
  };
}

// ---------- tables ----------

function later(value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), 0));
}

function compare(a, b) {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  return a < b ? -1 : 1;
}

// One query, built up the way the Supabase client builds them
// (from(...).select(...).eq(...)...), and run when it is awaited.
class DemoQuery {
  constructor(tables, table) {
    this.tables = tables;
    this.table = table;
    this.op = "select";
    this.payload = null;
    this.filters = [];
    this.orders = [];
    this.window = null;
    this.one = false;
    this.wantCount = false;
  }

  select(_columns, options) {
    if (options && options.count) this.wantCount = true;
    return this;
  }
  insert(rows) { this.op = "insert"; this.payload = rows; return this; }
  upsert(rows) { this.op = "upsert"; this.payload = rows; return this; }
  update(values) { this.op = "update"; this.payload = values; return this; }
  delete() { this.op = "delete"; return this; }

  eq(column, value) { this.filters.push((r) => String(r[column]) === String(value)); return this; }
  neq(column, value) { this.filters.push((r) => String(r[column]) !== String(value)); return this; }
  in(column, values) {
    const set = new Set((values || []).map(String));
    this.filters.push((r) => set.has(String(r[column])));
    return this;
  }
  is(column, value) { this.filters.push((r) => (r[column] ?? null) === value); return this; }
  match(pairs) {
    Object.keys(pairs || {}).forEach((k) => this.eq(k, pairs[k]));
    return this;
  }

  order(column, options) {
    this.orders.push({ column, ascending: !options || options.ascending !== false });
    return this;
  }
  range(from, to) { this.window = [from, to]; return this; }
  limit(count) { this.window = [0, count - 1]; return this; }
  maybeSingle() { this.one = true; return this; }
  single() { this.one = true; return this; }

  run() {
    const all = this.tables[this.table] || (this.tables[this.table] = []);
    const matches = (r) => this.filters.every((f) => f(r));

    if (this.op === "insert" || this.op === "upsert") {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload];
      incoming.forEach((row) => {
        if (!row) return;
        const at = row.id === undefined ? -1 : all.findIndex((r) => String(r.id) === String(row.id));
        if (at >= 0) all[at] = { ...all[at], ...row };
        else all.push({ created_at: new Date().toISOString(), ...row });
      });
      return { data: null, error: null, count: null, status: 201 };
    }

    if (this.op === "update") {
      all.forEach((r, i) => {
        if (matches(r)) all[i] = { ...r, ...this.payload };
      });
      return { data: null, error: null, count: null, status: 204 };
    }

    if (this.op === "delete") {
      this.tables[this.table] = all.filter((r) => !matches(r));
      return { data: null, error: null, count: null, status: 204 };
    }

    let rows = all.filter(matches);
    const count = rows.length;
    if (this.orders.length) {
      rows = rows.slice().sort((a, b) => {
        for (const o of this.orders) {
          const c = compare(a[o.column], b[o.column]);
          if (c) return o.ascending ? c : -c;
        }
        return 0;
      });
    }
    if (this.window) rows = rows.slice(this.window[0], this.window[1] + 1);
    const copies = rows.map((r) => ({ ...r }));
    return {
      data: this.one ? copies[0] || null : copies,
      error: null,
      count: this.wantCount ? count : null,
      status: 200,
    };
  }

  then(resolve, reject) {
    return later(null).then(() => this.run()).then(resolve, reject);
  }
}

// ---------- live channels ----------

// Nobody else is on a demo board, so most channels only have to accept
// what the board sends and report that they joined. The two live-class
// channels are the exception: the pretend class (demoClassroom.js) listens
// and answers on those, the way real students would.
function makeChannel(topic, classroom) {
  const live = classroom && classroom.handles(topic) ? classroom : null;
  const handlers = [];
  const channel = {
    topic,
    closed: false,
    on(type, filter, callback) {
      if (typeof callback === "function") handlers.push({ type, event: filter && filter.event, callback });
      return channel;
    },
    subscribe(callback) {
      setTimeout(() => {
        if (channel.closed) return;
        if (live) live.attach(channel);
        if (callback) callback("SUBSCRIBED");
      }, 0);
      return channel;
    },
    send(message) {
      if (live && !channel.closed) live.receive(channel, message);
      return Promise.resolve("ok");
    },
    track() { return Promise.resolve("ok"); },
    untrack() { return Promise.resolve("ok"); },
    presenceState() { return live ? live.presenceState(channel) : {}; },
    unsubscribe() {
      channel.closed = true;
      if (live) live.detach(channel);
      return Promise.resolve("ok");
    },
    // Delivers a message "from a student" to whatever the board registered
    // with on(). Used only by the pretend class.
    __emit(type, event, payload) {
      if (channel.closed) return;
      handlers.forEach((h) => {
        if (h.type !== type || h.event !== event) return;
        try {
          h.callback(type === "broadcast" ? { type, event, payload } : {});
        } catch (err) {
          console.error("Demo class message failed:", err);
        }
      });
    },
  };
  return channel;
}

// ---------- file uploads ----------

// Pictures and worksheets stay in the tab's memory and are shown from there.
function makeStorage() {
  const urls = new Map();
  return {
    from(bucket) {
      const key = (path) => `${bucket}/${path}`;
      return {
        upload(path, file) {
          const old = urls.get(key(path));
          if (old) URL.revokeObjectURL(old);
          urls.set(key(path), URL.createObjectURL(file));
          return later({ data: { path }, error: null });
        },
        getPublicUrl(path) {
          return { data: { publicUrl: urls.get(key(path)) || "" } };
        },
        remove(paths) {
          (paths || []).forEach((path) => {
            const url = urls.get(key(path));
            if (url) URL.revokeObjectURL(url);
            urls.delete(key(path));
          });
          return later({ data: [], error: null });
        },
      };
    },
  };
}

// ---------- the client ----------

// ---------- a copy of the board, for "keep your work" ----------

function sorted(rows) {
  return rows.slice().sort((a, b) => compare(a.created_at, b.created_at) || compare(String(a.id), String(b.id)));
}

// What the visitor has on the demo board, in a form that can be saved as a
// real board once they've signed in: the ink, the text boxes, the page
// style, the graph and any simulations. Returns null when the board is
// still exactly as it started (there is nothing of theirs to keep).
//
// The demo's own instruction notes are left behind unless they were
// edited. Pictures and the worksheet aren't included: in the demo they
// only exist in this tab's memory.
function carrySnapshot(tables, pristine) {
  const board = (tables.boards || []).find((b) => b.id === DEMO_BOARD_ID) || {};
  const strokes = sorted(tables.strokes || []);
  const texts = sorted(tables.texts || []);
  const images = tables.images || [];
  const key = JSON.stringify({
    strokes: strokes.map((r) => [r.id, r.data]),
    texts: texts.map((r) => [r.id, r.x, r.y, r.text, r.color, r.font_size, r.width, r.rotation || 0]),
    images: images.length,
    background: board.background || null,
    grid: board.grid_config || null,
    sims: board.sim_embeds || [],
  });
  if (key === pristine.key) return null;
  const starterText = pristine.texts;
  const keptTexts = texts.filter((r) => !(starterText.has(r.id) && starterText.get(r.id) === r.text));
  return {
    version: 1,
    name: "My demo board",
    background: board.background || null,
    grid_config: board.grid_config || null,
    sim_embeds: Array.isArray(board.sim_embeds) ? board.sim_embeds : [],
    strokes: strokes.map((r) => r.data).filter((d) => d && Array.isArray(d.points) && d.points.length),
    texts: keptTexts.map((r) => ({
      x: r.x, y: r.y, text: r.text, color: r.color, font_size: r.font_size, width: r.width, rotation: r.rotation || 0,
    })),
    leftBehind: { pictures: images.length },
  };
}

function pristineState(tables) {
  const texts = new Map((tables.texts || []).map((r) => [r.id, r.text]));
  const board = tables.boards[0];
  const key = JSON.stringify({
    strokes: sorted(tables.strokes).map((r) => [r.id, r.data]),
    texts: sorted(tables.texts).map((r) => [r.id, r.x, r.y, r.text, r.color, r.font_size, r.width, r.rotation || 0]),
    images: 0,
    background: board.background || null,
    grid: board.grid_config || null,
    sims: board.sim_embeds || [],
  });
  return { key, texts };
}

export function createDemoClient() {
  const tables = starterTables();
  const pristine = pristineState(tables);
  const classroom = createDemoClassroom();
  const leaveDemo = () => {
    window.location.assign("/");
    return Promise.resolve({ data: null, error: null });
  };

  return {
    __demo: true,
    // A copy of the visitor's board for "Sign in free to keep your work"
    // (null if they haven't changed anything). See demoCarry.js.
    __carry: () => carrySnapshot(tables, pristine),
    from: (table) => new DemoQuery(tables, table),
    rpc: () => later({ data: null, error: null }),
    channel: (topic) => makeChannel(topic, classroom),
    removeChannel(channel) {
      if (channel) channel.unsubscribe();
      return Promise.resolve("ok");
    },
    realtime: { connect() {}, disconnect() {} },
    storage: makeStorage(),
    auth: {
      getSession: () => later({ data: { session: DEMO_SESSION }, error: null }),
      getUser: () => later({ data: { user: DEMO_USER }, error: null }),
      refreshSession: () => later({ data: { session: DEMO_SESSION }, error: null }),
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } };
      },
      startAutoRefresh: () => Promise.resolve(),
      stopAutoRefresh: () => Promise.resolve(),
      signInWithOAuth: leaveDemo,
      signInWithIdToken: leaveDemo,
      signOut: leaveDemo,
    },
  };
}
