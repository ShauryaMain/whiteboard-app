// The demo board's backend: a small in-memory stand-in for the Supabase
// client, used ONLY on the /demo page (see supabaseClient.js).
//
// It answers the same calls the board makes (reads, saves, live channels,
// file uploads, sign-in) but keeps everything in this browser tab's memory.
// The real database is never contacted.
//
// Extras:
//   - The board it starts with depends on the visitor's answer to "What
//     are you planning?" (a class lesson, a 1:1 tutoring session, or the
//     tour board). See start() below and DemoGuide.js.
//   - As the visitor works, a copy of their board is kept in this browser
//     (demoStash.js), so coming back opens it again and signing in saves
//     it to their account (demoCarry.js).
//   - "Try a live class" is answered by pretend students (demoClassroom.js).

import { createDemoClassroom } from "./demoClassroom";
import { clearDemoStash, readDemoStash, stashKeepAt, stashStartedAt, wasCarried, writeDemoStash } from "./demoStash";
import { TAPE_SRC, isTape } from "./tape";
import { normalizeNotebook } from "./notebook";

export const DEMO_BOARD_ID = "demo";
const DEMO_USER = { id: "demo-user", email: "", user_metadata: { full_name: "Demo visitor" } };
const DEMO_SESSION = { user: DEMO_USER, access_token: "demo", expires_at: 4102444800 };

// The boards a visitor can start from (the answers to "What are you
// planning?"), and what each is called once it's kept in an account.
export const DEMO_KINDS = ["class", "tutor", "explore", "notebook"];
const BOARD_NAMES = {
  class: "Solving linear equations",
  tutor: "Straight-line graphs",
  explore: "My demo board",
  notebook: "Maths revision: quadratics",
};

// The worksheet shown beside the class lesson board (a picture, so it
// opens on every browser, older iPads included).
export const DEMO_WORKSHEET = {
  url: "/demo/linear-equations-worksheet.png",
  path: "demo/linear-equations-worksheet.png",
  pageCount: 1,
  fileType: "image/png",
  fileName: "Solving linear equations: worksheet",
};

// Something the board saved, or a file the visitor added, so the demo's
// guide (DemoGuide.js) can tell when there's work worth keeping.
export const DEMO_CHANGE_EVENT = "cleanslate:demo-change";

// True when the page that is loading is the demo board.
export function isDemoPath(pathname) {
  return /^\/demo(\/|$)/.test(String(pathname || ""));
}

export function isDemoPage() {
  return typeof window !== "undefined" && isDemoPath(window.location.pathname);
}

// ---------- the starter boards ----------

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

const text = (id, x, y, fontSize, width, color, value) => ({
  id, board_id: DEMO_BOARD_ID, x, y, text: value, color, font_size: fontSize, width, rotation: 0,
});

// Text boxes whose id starts with this are the demo's own instructions.
// They're left behind when a board is kept (unless the visitor edited
// them); everything else on a starter board is the lesson itself.
const TIP = "demo-tip-";

// "Just looking around": a tour of the board, with a sketch of
// y = (x - 2)^2 - 1, its axes and its two roots circled.
function exploreBoard() {
  const ox = 120;
  const oy = 420;
  const unit = 44;
  const curve = [];
  for (let i = 0; i <= 46; i++) {
    const x = -0.3 + (4.6 * i) / 46;
    curve.push([ox + unit * x, oy - unit * ((x - 2) * (x - 2) - 1)]);
  }
  return {
    background: "graph",
    grid: null,
    strokes: [
      inkStroke("demo-s1", "#1a1a1a", 3, linePoints(80, oy, 390, oy, 30)),
      inkStroke("demo-s2", "#1a1a1a", 3, [[380, oy - 7], [391, oy], [380, oy + 7]]),
      inkStroke("demo-s3", "#1a1a1a", 3, linePoints(ox, 480, ox, 215, 28)),
      inkStroke("demo-s4", "#1a1a1a", 3, [[ox - 7, 226], [ox, 214], [ox + 7, 226]]),
      inkStroke("demo-s5", "#1E88E5", 4, curve),
      inkStroke("demo-s6", "#E53935", 3, circlePoints(ox + unit, oy, 12)),
      inkStroke("demo-s7", "#E53935", 3, circlePoints(ox + unit * 3, oy, 12)),
    ],
    texts: [
      text(`${TIP}1`, 56, 36, 32, 640, "#1a1a1a", "This is a real Clean Slate board."),
      text(`${TIP}2`, 56, 96, 20, 640, "#1E88E5", "Pick the Pen and write anywhere. Scribble over something to rub it out."),
      text(`${TIP}3`, 440, 236, 20, 300, "#1a1a1a", "Maths menu: ruler, compass, graph paper and a calculator."),
      text(`${TIP}4`, 440, 340, 20, 300, "#1a1a1a", "Insert menu: pictures, a worksheet beside the board, simulations."),
      text(`${TIP}5`, 56, 520, 18, 660, "#8E24AA", "Your work stays in this browser for now. Sign in free to keep it on every device and run a live class."),
    ],
  };
}

// "A lesson for my class": solving linear equations (IGCSE and US
// Algebra 1 both start here), with the worksheet open beside the board.
// The pretend class solves question 1. `narrow`: laid out for a phone.
function classBoard(narrow) {
  if (narrow) {
    return {
      background: "graph",
      grid: null,
      strokes: [
        inkStroke("lesson-s1", "#1E88E5", 3.5, linePoints(22, 66, 300, 64, 20)),
        inkStroke("lesson-s2", "#8E24AA", 2.5, [
          ...linePoints(12, 118, 352, 118, 16),
          ...linePoints(352, 118, 352, 226, 6),
          ...linePoints(352, 226, 12, 226, 16),
          ...linePoints(12, 226, 12, 118, 6),
        ]),
      ],
      texts: [
        text("lesson-t1", 20, 26, 26, 340, "#1a1a1a", "Solving linear equations"),
        text("lesson-t2", 20, 78, 16, 340, "#1E88E5", "Do the same to both sides until x is on its own."),
        text("lesson-t3", 24, 128, 17, 320, "#1a1a1a", "Example:  4x − 5 = 11"),
        text("lesson-t4", 36, 160, 17, 310, "#1a1a1a", "add 5 to both sides:  4x = 16"),
        text("lesson-t5", 36, 192, 17, 310, "#1a1a1a", "divide both sides by 4:  x = 4"),
        text("lesson-t6", 20, 250, 21, 300, "#E53935", "Your turn"),
        text("lesson-t7", 20, 290, 18, 240, "#1a1a1a", "1)  2x + 3 = 11"),
        text("lesson-t8", 20, 326, 18, 240, "#1a1a1a", "2)  5x − 4 = 21"),
        text("lesson-t9", 20, 362, 18, 240, "#1a1a1a", "3)  3(x + 2) = 18"),
        text("lesson-t10", 20, 398, 18, 240, "#1a1a1a", "4)  7 − 2x = 1"),
        text(`${TIP}1`, 20, 446, 15, 340, "#8E24AA", "Press Live class: five pretend students solve question 1 on their own boards, and you watch them work."),
      ],
    };
  }
  return {
    background: "graph",
    grid: null,
    strokes: [
      // underline the title, and a box round the worked example
      inkStroke("lesson-s1", "#1E88E5", 4, linePoints(58, 82, 420, 80, 24)),
      inkStroke("lesson-s2", "#8E24AA", 2.5, [
        ...linePoints(46, 140, 470, 140, 20),
        ...linePoints(470, 140, 470, 262, 8),
        ...linePoints(470, 262, 46, 262, 20),
        ...linePoints(46, 262, 46, 140, 8),
      ]),
    ],
    texts: [
      text("lesson-t1", 56, 30, 32, 460, "#1a1a1a", "Solving linear equations"),
      text("lesson-t2", 56, 96, 18, 460, "#1E88E5", "Do the same to both sides until x is on its own."),
      text("lesson-t3", 60, 150, 20, 400, "#1a1a1a", "Example:  4x − 5 = 11"),
      text("lesson-t4", 80, 186, 20, 380, "#1a1a1a", "add 5 to both sides:  4x = 16"),
      text("lesson-t5", 80, 222, 20, 380, "#1a1a1a", "divide both sides by 4:  x = 4"),
      text("lesson-t6", 56, 292, 24, 300, "#E53935", "Your turn"),
      text("lesson-t7", 56, 334, 20, 220, "#1a1a1a", "1)  2x + 3 = 11"),
      text("lesson-t8", 56, 374, 20, 220, "#1a1a1a", "2)  5x − 4 = 21"),
      text("lesson-t9", 56, 414, 20, 220, "#1a1a1a", "3)  3(x + 2) = 18"),
      text("lesson-t10", 56, 454, 20, 220, "#1a1a1a", "4)  7 − 2x = 1"),
      text(`${TIP}1`, 56, 516, 17, 460, "#8E24AA", "Press Try a live class: five pretend students solve question 1 on their own boards, and you watch them work."),
    ],
  };
}

// "A 1:1 tutoring session": straight-line graphs (y = mx + c), with axes
// ready to draw on. The graph snaps, so points and ruler lines land exactly
// on the grid. `narrow`: laid out for a phone (the graph under the
// questions).
function tutorBoard(narrow) {
  const cell = narrow ? 24 : 30;
  const grid = {
    id: "graph-first",
    type: "cartesian",
    x: narrow ? 20 : 420,
    y: narrow ? 356 : 44,
    size: cell * 7,
    cols: 7,
    rows: 12,
    showAxes: true,
    showNumbers: true,
    showUnitCircle: false,
    arrows: true,
    minor: 0,
    snap: true,
    color: "#cfd8e3",
    unitsPerCell: 1,
    trig: false,
    trigStep: { num: 1, den: 2 },
    axes: {
      x: { min: -2, max: 5, step: 1, label: "number", piStep: { num: 1, den: 2 }, log: false, perDecade: 3, name: "" },
      y: { min: -6, max: 6, step: 1, label: "number", piStep: { num: 1, den: 2 }, log: false, perDecade: 3, name: "" },
    },
  };
  if (narrow) {
    return {
      background: "blank",
      grid,
      strokes: [inkStroke("lesson-s1", "#1E88E5", 3.5, linePoints(22, 66, 270, 64, 18))],
      texts: [
        text("lesson-t1", 20, 26, 26, 340, "#1a1a1a", "Straight-line graphs"),
        text("lesson-t2", 20, 78, 16, 340, "#1E88E5", "1:1 session  ·  y = mx + c"),
        text("lesson-t3", 20, 116, 16, 340, "#1a1a1a", "1)  Complete the table for y = 2x − 3, then draw the line."),
        text("lesson-t4", 20, 172, 16, 340, "#1a1a1a", "x:   −1    0    1    2    3"),
        text("lesson-t5", 20, 198, 16, 340, "#1a1a1a", "y:"),
        text("lesson-t6", 20, 236, 16, 340, "#1a1a1a", "2)  Find the gradient of the line through (1, 2) and (3, 6)."),
        text("lesson-t7", 20, 290, 16, 340, "#1a1a1a", "3)  The line parallel to y = 2x − 3 through (0, 5)?"),
        text(`${TIP}1`, 204, 362, 14, 160, "#8E24AA", "This graph snaps: a dot or a ruler line near a crossing lands exactly on it. Double-tap the graph to plot an equation."),
      ],
    };
  }
  return {
    background: "blank",
    grid,
    strokes: [inkStroke("lesson-s1", "#1E88E5", 4, linePoints(58, 82, 360, 80, 22))],
    texts: [
      text("lesson-t1", 56, 30, 32, 340, "#1a1a1a", "Straight-line graphs"),
      text("lesson-t2", 56, 96, 18, 340, "#1E88E5", "1:1 session  ·  y = mx + c"),
      text("lesson-t3", 56, 144, 19, 330, "#1a1a1a", "1)  Complete the table for y = 2x − 3, then draw the line."),
      text("lesson-t4", 56, 214, 19, 330, "#1a1a1a", "x:   −1    0    1    2    3"),
      text("lesson-t5", 56, 248, 19, 330, "#1a1a1a", "y:"),
      text("lesson-t6", 56, 300, 19, 330, "#1a1a1a", "2)  Find the gradient of the line through (1, 2) and (3, 6)."),
      text("lesson-t7", 56, 378, 19, 330, "#1a1a1a", "3)  Write the equation of the line parallel to y = 2x − 3 through (0, 5)."),
      text(`${TIP}1`, 56, 468, 17, 340, "#8E24AA", "This graph snaps: a dot or a ruler line near a crossing lands exactly on it. Double-tap the graph to plot an equation."),
    ],
  };
}

// "Notes for my own studying": a revision notebook (three pages: Cornell
// notes with the answers under tape, a graph, and a page to write on), for
// trying notebooks, tape and Quiz me. A notebook fits its page to the
// screen itself, so there's no phone layout.
const TAPE_COVER = (id, x, y, width) => ({ id, board_id: DEMO_BOARD_ID, x, y, width, height: 34, src: TAPE_SRC });

function notebookBoard() {
  const P2 = 1171; // where page 2 starts (an A4 page, then the gap)
  const P3 = 2342;
  const cue = (n, value) => text(`lesson-t-c${n}`, -380, 119 + 96 * n, 17, 200, "#1E88E5", value);
  const ask = (n, value, width) => text(`lesson-t-q${n}`, -140, 119 + 96 * n, 19, width, "#1a1a1a", value);
  const answer = (n, value, width) => text(`lesson-t-a${n}`, 76, 119 + 96 * n, 19, width, "#1a1a1a", value);
  const cover = (n, width) => TAPE_COVER(`lesson-tape-${n}`, 68, 114 + 96 * n, width);
  const grid = {
    id: "graph-first",
    type: "cartesian",
    x: -356,
    y: P2 + 96,
    size: 44 * 8,
    cols: 8,
    rows: 11,
    showAxes: true,
    showNumbers: true,
    showUnitCircle: false,
    arrows: true,
    minor: 0,
    snap: true,
    color: "#cfd8e3",
    unitsPerCell: 1,
    trig: false,
    trigStep: { num: 1, den: 2 },
    axes: {
      x: { min: -3, max: 5, step: 1, label: "number", piStep: { num: 1, den: 2 }, log: false, perDecade: 3, name: "" },
      y: { min: -5, max: 6, step: 1, label: "number", piStep: { num: 1, den: 2 }, log: false, perDecade: 3, name: "" },
    },
    plot: { fns: [{ id: "demo-fn-1", latex: "y=x^2-2x-3", color: "#1E88E5" }], points: [], params: {}, features: {}, pins: [], angle: "rad", equations: true },
  };
  const side = (n, value) => text(`lesson-t-s${n}`, 44, P2 + 104 + 86 * n, 18, 330, "#1a1a1a", value);
  const sideAnswer = (n, value, width) => text(`lesson-t-sa${n}`, 52, P2 + 138 + 86 * n, 19, width, "#1a1a1a", value);
  const sideCover = (n, width) => TAPE_COVER(`lesson-tape-s${n}`, 44, P2 + 133 + 86 * n, width);
  return {
    background: "blank",
    grid,
    notebook: {
      v: 1,
      size: "a4",
      cover: { color: "#2F5BEA", emoji: "📐" },
      pages: [
        { id: "demo-p1", paper: "cornell", title: "Key facts" },
        { id: "demo-p2", paper: "graph", title: "Sketching" },
        { id: "demo-p3", paper: "lined", title: "Your turn" },
      ],
    },
    strokes: [
      // underline the title, a star by the formula, a tick by the summary
      inkStroke("lesson-s1", "#1E88E5", 3.5, linePoints(-372, 62, -150, 60, 18)),
      inkStroke("lesson-s2", "#E53935", 2.5, [[-170, 312], [-163, 328], [-146, 330], [-159, 340], [-155, 357], [-170, 347], [-185, 357], [-181, 340], [-194, 330], [-177, 328], [-170, 312]]),
      inkStroke("lesson-s3", "#43A047", 3, [[-386, 940], [-379, 949], [-364, 928]]),
      inkStroke("lesson-s4", "#1E88E5", 3.5, linePoints(-372, P2 + 60, -40, P2 + 58, 20)),
    ],
    texts: [
      text("lesson-t1", -372, 16, 32, 300, "#1a1a1a", "Quadratics"),
      text("lesson-t2", 96, 30, 15, 290, "#1E88E5", "Revision notes · Cornell page"),
      cue(0, "Factorise"),
      ask(0, "x² + 5x + 6 =", 170),
      answer(0, "(x + 2)(x + 3)", 210),
      cue(1, "Solve"),
      ask(1, "x² + 5x + 6 = 0", 180),
      answer(1, "x = −2 or x = −3", 230),
      cue(2, "The formula"),
      ask(2, "ax² + bx + c = 0", 180),
      answer(2, "x = (−b ± √(b² − 4ac)) ÷ 2a", 330),
      cue(3, "Discriminant"),
      ask(3, "b² − 4ac < 0 means", 180),
      answer(3, "no real roots", 200),
      cue(4, "Completing the square"),
      ask(4, "x² − 6x + 2 =", 170),
      answer(4, "(x − 3)² − 7", 200),
      text(`${TIP}1`, -140, 640, 17, 500, "#8E24AA", "Tap the yellow tape to peek at an answer, and tap again to cover it. Or press Quiz me, top left, to test yourself on the whole page."),
      text("lesson-t-sum", -380, 910, 17, 330, "#1a1a1a", "Summary"),
      text("lesson-t-sum2", -360, 944, 17, 720, "#1a1a1a", "A quadratic has at most two roots. Factorise if you can, otherwise use the formula. The discriminant b² − 4ac says how many roots there are."),
      text("lesson-t-p2", -372, P2 + 16, 28, 400, "#1a1a1a", "Sketching y = x² − 2x − 3"),
      side(0, "Where it crosses the x-axis:"),
      sideAnswer(0, "x = −1 and x = 3", 230),
      side(1, "Where it crosses the y-axis:"),
      sideAnswer(1, "(0, −3)", 120),
      side(2, "Turning point:"),
      sideAnswer(2, "(1, −4), a minimum", 240),
      side(3, "Line of symmetry:"),
      sideAnswer(3, "x = 1", 100),
      text(`${TIP}2`, -356, P2 + 620, 17, 700, "#8E24AA", "Every board tool works in a notebook. Double-tap the graph to plot another equation, or open the Maths menu for the ruler, compass and calculator."),
      text("lesson-t-p3", -300, P3 + 30, 28, 400, "#1a1a1a", "Your turn"),
      text("lesson-t-p3q", -300, P3 + 96, 20, 600, "#1a1a1a", "Solve x² − x − 12 = 0, then sketch y = x² − x − 12."),
      text(`${TIP}3`, -300, P3 + 160, 17, 640, "#8E24AA", "Write with the Pen, then put Tape over your answer to quiz yourself later. Add more pages from the Page menu, or export the notebook as a PDF."),
    ],
    images: [
      cover(0, 186),
      cover(1, 206),
      cover(2, 312),
      cover(3, 150),
      cover(4, 150),
      sideCover(0, 200),
      sideCover(1, 90),
      sideCover(2, 210),
      sideCover(3, 76),
    ],
  };
}

const STARTERS = { class: classBoard, tutor: tutorBoard, explore: exploreBoard, notebook: notebookBoard };

// The starter boards are laid out for a tablet-sized screen (about 720px
// wide). The lesson boards also have a phone layout (about 380px wide).
// On a narrower screen they are shrunk to fit and moved down a little,
// clear of the zoom control in the top corner.
function screenWidth() {
  return typeof window === "undefined" ? 1024 : window.innerWidth || 1024;
}

function isNarrow() {
  return screenWidth() < 600;
}

function starterFit(layoutWidth) {
  const width = screenWidth();
  const k = Math.min(1, Math.max(0.5, (width - 16) / layoutWidth));
  return { k, dy: k < 1 || layoutWidth < 600 ? 56 : 0 };
}

const round = (n) => Math.round(n * 100) / 100;

function fitStroke(row, { k, dy }) {
  if (k === 1 && !dy) return row;
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

function fitGrid(grid, { k, dy }) {
  if (!grid || (k === 1 && !dy)) return grid;
  return { ...grid, x: round(grid.x * k), y: round(grid.y * k + dy), size: round(grid.size * k) };
}

const stamp = (rows) => {
  const now = Date.now();
  return rows.map((r, i) => ({ ...r, created_at: new Date(now + i).toISOString() }));
};

function boardRow(kind, background, grid, sims, notebook = null) {
  const row = {
    id: DEMO_BOARD_ID,
    owner_id: DEMO_USER.id,
    name: kind === "explore" ? "Demo board" : BOARD_NAMES[kind],
    grid_config: grid || null,
    background: background || "blank",
    sim_embeds: sims || [],
    thumbnail: null,
  };
  // a notebook (see src/lib/notebook.js)
  if (notebook) {
    row.kind = "notebook";
    row.notebook = notebook;
  }
  return row;
}

function starterTables(kind) {
  const board = (STARTERS[kind] || exploreBoard)(false);
  if (board.notebook) {
    // (a notebook fits its pages to the screen itself)
    return {
      boards: stamp([boardRow(kind, board.background, board.grid, [], board.notebook)]),
      strokes: stamp(board.strokes),
      texts: stamp(board.texts),
      images: stamp(board.images || []),
    };
  }
  const phoneLayout = isNarrow() && kind !== "explore";
  const fit = starterFit(phoneLayout ? 380 : 720);
  const laid = phoneLayout ? (STARTERS[kind] || exploreBoard)(true) : board;
  return {
    boards: stamp([boardRow(kind, laid.background, fitGrid(laid.grid, fit), [])]),
    strokes: stamp(laid.strokes.map((r) => fitStroke(r, fit))),
    texts: stamp(laid.texts.map((r) => fitText(r, fit))),
    images: [],
  };
}

// The visitor's own board, as kept in this browser (see demoStash.js).
function restoredTables(stash) {
  const kind = DEMO_KINDS.includes(stash.kind) ? stash.kind : "explore";
  let n = 0;
  const notebook = stash.notebook ? normalizeNotebook(stash.notebook) : null;
  const tapes = Array.isArray(stash.tapes) ? stash.tapes : [];
  return {
    boards: stamp([boardRow(kind, stash.background, stash.grid_config, Array.isArray(stash.sim_embeds) ? stash.sim_embeds : [], notebook)]),
    images: stamp(
      tapes.map((t) => ({ id: `kept-i${n++}`, board_id: DEMO_BOARD_ID, x: t.x, y: t.y, width: t.width, height: t.height, src: TAPE_SRC }))
    ),
    strokes: stamp(stash.strokes.map((data) => ({ id: `kept-s${n++}`, board_id: DEMO_BOARD_ID, data }))),
    texts: stamp(
      stash.texts.map((t) => ({
        id: `kept-t${n++}`, board_id: DEMO_BOARD_ID, x: t.x, y: t.y, text: t.text, color: t.color,
        font_size: t.font_size, width: t.width, rotation: t.rotation || 0,
      }))
    ),
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
// Also used by src/lib/localBoard.js, for a student's own board in a live
// class (which lives in the student's tab, not the database).
export class DemoQuery {
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

  // Lets the demo keep a copy of the board as it changes (see
  // createDemoClient). A student's own board in a live class has no such
  // hook.
  changed() {
    const hook = this.tables.__changed;
    if (typeof hook === "function") hook({ table: this.table, op: this.op });
  }

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
      this.changed();
      return { data: null, error: null, count: null, status: 201 };
    }

    if (this.op === "update") {
      all.forEach((r, i) => {
        if (matches(r)) all[i] = { ...r, ...this.payload };
      });
      this.changed();
      return { data: null, error: null, count: null, status: 204 };
    }

    if (this.op === "delete") {
      this.tables[this.table] = all.filter((r) => !matches(r));
      this.changed();
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
          h.callback(type === "broadcast" ? { type, event, payload } : payload || {});
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
// `onUpload(bucket)` hears about each one (the demo's guide counts them).
function makeStorage(onUpload) {
  const urls = new Map();
  return {
    from(bucket) {
      const key = (path) => `${bucket}/${path}`;
      return {
        upload(path, file) {
          const old = urls.get(key(path));
          if (old) URL.revokeObjectURL(old);
          urls.set(key(path), URL.createObjectURL(file));
          if (onUpload) onUpload(bucket);
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

// ---------- a copy of the board, kept as they work ----------

function sorted(rows) {
  return rows.slice().sort((a, b) => compare(a.created_at, b.created_at) || compare(String(a.id), String(b.id)));
}

function boardKey(tables) {
  const board = (tables.boards || []).find((b) => b.id === DEMO_BOARD_ID) || {};
  return JSON.stringify({
    strokes: sorted(tables.strokes || []).map((r) => [r.id, r.data]),
    texts: sorted(tables.texts || []).map((r) => [r.id, r.x, r.y, r.text, r.color, r.font_size, r.width, r.rotation || 0]),
    images: (tables.images || []).map((r) => [r.id, r.x, r.y, r.width, r.height]),
    background: board.background || null,
    grid: board.grid_config || null,
    sims: board.sim_embeds || [],
    notebook: board.notebook ? board.notebook.pages : null,
  });
}

// What the visitor has on the demo board, in a form that can be kept in
// this browser and saved as a real board once they've signed in: the ink,
// the text boxes, the page style, the graph and any simulations.
//
// Returns null when the board is exactly as it started (nothing of theirs
// to keep), unless `force` is set and it's a lesson board (someone who
// asks to keep the lesson as it is gets the lesson).
//
// The demo's own instruction notes are left behind unless they were
// edited. Pictures and the worksheet aren't included: in the demo they
// only exist in this tab's memory.
function carrySnapshot(tables, pristine, kind, force) {
  const board = (tables.boards || []).find((b) => b.id === DEMO_BOARD_ID) || {};
  const unchanged = pristine.key !== null && boardKey(tables) === pristine.key;
  if (unchanged && !(force && kind !== "explore")) return null;
  const strokes = sorted(tables.strokes || []);
  const texts = sorted(tables.texts || []);
  const keptTexts = texts.filter((r) => !(String(r.id).startsWith(TIP) && pristine.texts.get(r.id) === r.text));
  const images = tables.images || [];
  const snapshot = {
    version: 1,
    kind,
    name: BOARD_NAMES[kind] || BOARD_NAMES.explore,
    background: board.background || null,
    grid_config: board.grid_config || null,
    sim_embeds: Array.isArray(board.sim_embeds) ? board.sim_embeds : [],
    // (a notebook's ink is kept packed: inkPack.js)
    strokes: strokes.map((r) => r.data).filter((d) => d && ((Array.isArray(d.points) && d.points.length) || (d.f === 1 && Array.isArray(d.o)))),
    texts: keptTexts.map((r) => ({
      x: r.x, y: r.y, text: r.text, color: r.color, font_size: r.font_size, width: r.width, rotation: r.rotation || 0,
    })),
    leftBehind: { pictures: images.filter((r) => !isTape(r)).length },
  };
  // a notebook comes with its pages, and its tape (tape is a small drawing,
  // so unlike pictures it can come along)
  if (board.kind === "notebook" && board.notebook) {
    snapshot.notebook = board.notebook;
    snapshot.tapes = sorted(images.filter(isTape)).map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
  }
  return snapshot;
}

function pristineState(tables, restored) {
  return {
    // a board brought back from this browser is all theirs already
    key: restored ? null : boardKey(tables),
    texts: new Map((tables.texts || []).map((r) => [r.id, r.text])),
  };
}

// How much of the board is the visitor's own work, for the demo's guide.
function workSummary(tables, pristine) {
  const starter = pristine.texts;
  const strokes = (tables.strokes || []).filter((r) => !String(r.id).startsWith("demo-s") && !String(r.id).startsWith("lesson-s") && !String(r.id).startsWith("kept-")).length;
  const texts = (tables.texts || []).filter((r) => !starter.has(r.id) || starter.get(r.id) !== r.text).length;
  // what was already theirs when the board was brought back from this browser
  const kept = (tables.strokes || []).filter((r) => String(r.id).startsWith("kept-")).length + (tables.texts || []).filter((r) => String(r.id).startsWith("kept-")).length;
  const images = tables.images || [];
  // tape the visitor put down (the starter notebook's own is "lesson-tape-")
  const tapes = images.filter((r) => isTape(r) && !String(r.id).startsWith("lesson-tape") && !String(r.id).startsWith("kept-")).length;
  return { strokes, texts, tapes, pictures: images.filter((r) => !isTape(r)).length, kept };
}

function emit(detail) {
  try {
    window.dispatchEvent(new CustomEvent(DEMO_CHANGE_EVENT, { detail }));
  } catch (err) {
    // an old browser without CustomEvent: the guide just stays quiet
  }
}

// ---------- the client ----------

export function createDemoClient() {
  const classroom = createDemoClassroom();
  // The board is set up by start() (the answer to "What are you planning?",
  // or the visitor's kept board). Anything that reads it first gets the
  // tour board.
  let state = null; // { kind, tables, pristine, restored, startedAt }
  let saveTimer = null;
  let keptOk = false; // whether the latest copy made it into this browser

  // A copy of the board as it is now (null when there's nothing of theirs),
  // marked with when this demo board was started.
  function snapshotNow(force) {
    if (!state) return null;
    const snapshot = carrySnapshot(state.tables, state.pristine, state.kind, force);
    return snapshot ? { ...snapshot, startedAt: state.startedAt } : null;
  }

  function keepNow() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!state) return false;
    // already saved into an account (this is a second tab, or a page the
    // browser kept from before): don't keep it again
    if (wasCarried(state.startedAt)) return false;
    const snapshot = snapshotNow(false);
    if (!snapshot) return false;
    const kept = readDemoStash();
    // the same board kept earlier: a "keep it" press and what to show next
    // still count
    const same = kept && stashStartedAt(kept) === state.startedAt;
    keptOk = writeDemoStash({
      ...snapshot,
      keepAt: same ? stashKeepAt(kept) || undefined : undefined,
      next: same ? kept.next : undefined,
    });
    // couldn't keep it (storage full or switched off): don't leave an
    // older copy behind to be brought back as if it were this one
    if (!keptOk) clearDemoStash();
    return keptOk;
  }

  function changed(change) {
    if (!state) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(keepNow, 700);
    emit({ ...change, work: workSummary(state.tables, state.pristine) });
  }

  function start(kind) {
    if (state) return state.kind;
    const stash = kind === "restore" ? readDemoStash() : null;
    if (stash) {
      const tables = restoredTables(stash);
      tables.__changed = changed;
      state = {
        kind: DEMO_KINDS.includes(stash.kind) ? stash.kind : "explore",
        tables,
        pristine: pristineState(tables, true),
        restored: true,
        startedAt: stashStartedAt(stash) || Date.now(),
      };
      keptOk = true;
    } else {
      const k = DEMO_KINDS.includes(kind) ? kind : "explore";
      const tables = starterTables(k);
      tables.__changed = changed;
      state = { kind: k, tables, pristine: pristineState(tables, false), restored: false, startedAt: Date.now() };
    }
    return state.kind;
  }

  // Leaving the page or switching apps: keep the latest strokes now rather
  // than lose the last moment of work.
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    const flush = () => {
      if (saveTimer) keepNow();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }

  const tablesNow = () => {
    if (!state) start("explore");
    return state.tables;
  };

  const leaveDemo = () => {
    window.location.assign("/");
    return Promise.resolve({ data: null, error: null });
  };

  return {
    __demo: true,
    // Sets up the board: "class", "tutor", "explore", or "restore" (the
    // visitor's board kept in this browser; the tour board if there isn't
    // one). Only the first call counts. Returns the kind of board it is.
    __start: start,
    __kind: () => (state ? state.kind : null),
    __restored: () => !!(state && state.restored),
    __work: () => (state ? workSummary(state.tables, state.pristine) : { strokes: 0, texts: 0, pictures: 0, kept: 0 }),
    // A copy of the visitor's board (null if they haven't changed anything,
    // unless `force`). See demoCarry.js.
    __carry: (force) => snapshotNow(!!force),
    // Keep the board in this browser right now (rather than after the
    // short wait that follows each change).
    __keepNow: keepNow,
    // Whether the board is kept in this browser at the moment.
    __kept: () => keptOk,
    from: (table) => new DemoQuery(tablesNow(), table),
    rpc: () => later({ data: null, error: null }),
    channel: (topic) => makeChannel(topic, classroom),
    removeChannel(channel) {
      if (channel) channel.unsubscribe();
      return Promise.resolve("ok");
    },
    realtime: { connect() {}, disconnect() {} },
    storage: makeStorage((bucket) => changed({ upload: bucket })),
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
