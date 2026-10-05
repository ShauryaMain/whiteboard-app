// The pretend class behind "Try a live class" on the demo board.
//
// A real live class has students on their own devices, each drawing on
// their own board. The demo has nobody else in it, so this file plays the
// students: five pretend ones join, each works through the same question
// in their own handwriting, and one of them makes a mistake. The teacher's
// side of the app (the LIVE pill, the Students list, opening a student's
// board, pinning a comment) is the real thing, talking to these pretend
// students exactly as it would talk to real ones. Nothing here is used
// outside the demo, and nothing is sent anywhere.
//
// How it fits together: demoBackend.js hands the two kinds of live-class
// channel to createDemoClassroom():
//   classroom-<code>                  who is in the class (the roster)
//   board-student-<code>-<studentId>  one student's own board
// and this file answers on them the way real students' boards would (a
// student's board is an ordinary board, so these are the ordinary board
// messages: see the board channel in Whiteboard.js).

const TICK_MS = 70; // how often the pretend students "move their pens"
const CHUNK = 150; // points per message

// ---------- the class ----------

// lines: what each student writes, one line at a time. "v" is a tick.
// Ben's second line is wrong on purpose (11 - 3 is 8, not 14).
export const DEMO_STUDENTS = [
  { studentId: "demo-aisha", name: "Aisha", color: "#1E88E5", joinAt: 700, speed: 1, slant: 0.1, size: 1.02, lines: ["2x+3=11", "2x=8", "x=4 v"] },
  { studentId: "demo-ben", name: "Ben", color: "#1a1a1a", joinAt: 1500, speed: 1.15, slant: 0.02, size: 1.08, lines: ["2x+3=11", "2x=14", "x=7"] },
  { studentId: "demo-chen", name: "Chen", color: "#43A047", joinAt: 2300, speed: 0.9, slant: 0.16, size: 0.94, lines: ["11-3=8", "8/2=4", "x=4"] },
  { studentId: "demo-dara", name: "Dara", color: "#8E24AA", joinAt: 3200, speed: 0.7, slant: -0.04, size: 1.1, lines: ["2x+3=11", "2x=11-3", "2x=8"] },
  { studentId: "demo-eli", name: "Eli", color: "#FB8C00", joinAt: 4200, speed: 1.05, slant: 0.07, size: 0.98, lines: ["2x=11-3", "x=8/2", "x=4"] },
];

// What Ben writes after the teacher pins a comment on his board: he
// crosses out his two wrong lines and writes them again, correctly.
const BEN_ID = "demo-ben";
const BEN_STRUCK_LINES = [1, 2];
const BEN_FIX_LINES = ["2x=8", "x=4 v"];
const REACT_AFTER_MS = 2600;

// What the pretend students signal to the teacher, the way real ones can
// from their own page: Dara gets stuck and puts a hand up, and each of the
// others marks themselves done a moment after their last line.
const HAND_ID = "demo-dara";
const HAND_AFTER_MS = 6500; // after she joins
const DONE_AFTER_MS = 1200; // after a student's last stroke

// ---------- handwriting ----------

// Each character as one or more pen strokes, in a box 1 wide and 1 tall
// (y runs down the page). Only the characters the class needs.
const GLYPHS = {
  "1": [[[0.3, 0.22], [0.55, 0.02], [0.55, 1]]],
  "2": [[[0.14, 0.24], [0.3, 0.05], [0.58, 0], [0.8, 0.16], [0.78, 0.4], [0.46, 0.7], [0.12, 1], [0.9, 1]]],
  "3": [[[0.16, 0.1], [0.46, 0], [0.76, 0.12], [0.74, 0.36], [0.44, 0.48], [0.8, 0.6], [0.8, 0.86], [0.5, 1], [0.14, 0.88]]],
  "4": [[[0.62, 0], [0.08, 0.66], [0.92, 0.66]], [[0.66, 0.28], [0.66, 1]]],
  "7": [[[0.1, 0.03], [0.88, 0.03], [0.4, 1]]],
  "8": [[[0.5, 0.48], [0.2, 0.3], [0.28, 0.06], [0.5, 0], [0.72, 0.06], [0.8, 0.3], [0.5, 0.48], [0.18, 0.7], [0.24, 0.94], [0.5, 1], [0.76, 0.94], [0.82, 0.7], [0.5, 0.48]]],
  x: [[[0.12, 0.36], [0.86, 1]], [[0.86, 0.36], [0.12, 1]]],
  "+": [[[0.5, 0.32], [0.5, 0.9]], [[0.16, 0.61], [0.84, 0.61]]],
  "-": [[[0.16, 0.6], [0.84, 0.6]]],
  "=": [[[0.16, 0.46], [0.84, 0.46]], [[0.16, 0.74], [0.84, 0.74]]],
  // divide: a bar with a dot above and below
  "/": [[[0.14, 0.6], [0.86, 0.6]], [[0.47, 0.3], [0.53, 0.33]], [[0.47, 0.88], [0.53, 0.91]]],
  v: [[[0.05, 0.6], [0.34, 0.95], [0.98, 0.08]]],
};
const ADVANCE = { " ": 0.55, "1": 0.82, "+": 1.12, "-": 1.12, "=": 1.18, "/": 1.12, v: 1.2 };

// A small repeatable random-number maker, so each student's handwriting
// wobbles the same way every time (and replays match what was "drawn").
function makeRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Evenly spaced points along a few straight pieces, so the pen appears
// to travel at a steady speed (the board smooths the corners itself).
function resample(points, step) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const pieces = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 1; k <= pieces; k++) out.push([x0 + ((x1 - x0) * k) / pieces, y0 + ((y1 - y0) * k) / pieces]);
  }
  return out;
}

const round = (n) => Math.round(n * 100) / 100;

// The size of the board the teacher will be looking at, so the writing
// comes out a sensible size and all of it is in view on a phone, a tablet
// or a desktop. (A student's board is measured in the same units as any
// other board: one unit is one pixel at 100% zoom.)
function boardShape() {
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth || 1280;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight || 800;
  // The teacher's board area, where a student's board is shown…
  let areaW = vw;
  let areaH = vh - 170;
  const pane = typeof document === "undefined" ? null : document.querySelector('[data-board-pane="true"]');
  if (pane) {
    const rect = pane.getBoundingClientRect();
    if (rect.width > 100 && rect.height > 100) {
      areaW = rect.width;
      areaH = rect.height;
    }
  }
  // …less what TeacherStudentBoardView puts around it: a bar across the
  // top, and the comments list beside the board (underneath it on a phone).
  const narrow = vw <= 640;
  const paneW = Math.max(240, narrow ? areaW : areaW - 290);
  const paneH = Math.max(220, narrow ? (areaH - 62) * 0.7 : areaH - 62);
  const glyphW = Math.max(13, Math.min(30, paneW / 24, paneH / 16));
  return { paneW, paneH, glyphW, glyphH: glyphW * 1.5 };
}

// Turns a student's lines into timed pen strokes: every point has the
// moment (in milliseconds since the class began) at which it is drawn.
function writeLines(student, lines, shape, startAt, firstLine, idPrefix) {
  const random = makeRandom(seedFrom(student.studentId + idPrefix));
  const gw = shape.glyphW * student.size;
  const gh = shape.glyphH * student.size;
  const pitch = gh * 1.85;
  const left = shape.paneW * 0.07;
  const top = shape.paneH * 0.1;
  const pointGap = 24 / student.speed; // ms between points while writing
  const strokes = [];
  const lineBoxes = [];
  let t = startAt;
  lines.forEach((line, n) => {
    const row = firstLine + n;
    const baseY = top + row * pitch + (random() - 0.5) * gh * 0.08;
    let penX = left + (random() - 0.5) * gw * 0.3;
    const lineStartX = penX;
    for (const ch of line) {
      const glyph = GLYPHS[ch];
      if (glyph) {
        const lift = (random() - 0.5) * gh * 0.07;
        glyph.forEach((piece, k) => {
          const pts = resample(piece, 0.11).map(([gx, gy]) => {
            const jx = (random() - 0.5) * 0.05;
            const jy = (random() - 0.5) * 0.05;
            const px = penX + (gx + jx + (1 - gy) * student.slant) * gw;
            const py = baseY + lift + (gy + jy) * gh;
            t += pointGap;
            return { x: round(px), y: round(py), t: Math.round(t) };
          });
          strokes.push({ id: `${idPrefix}-${row}-${strokes.length}-${k}`, color: student.color, points: pts });
          t += 90 / student.speed; // lifting the pen between strokes
        });
      }
      penX += (ADVANCE[ch] || 1) * gw * 1.04;
      t += (ch === " " ? 120 : 150) / student.speed;
    }
    lineBoxes[row] = { x0: lineStartX, x1: penX, y: baseY + gh * 0.55 };
    t += (900 + random() * 900) / student.speed; // thinking before the next line
  });
  return { strokes, lineBoxes, endsAt: t };
}

// A slightly wavy line through a line of working: crossing it out.
function strikeThrough(student, box, shape, startAt, id) {
  const pts = [];
  let t = startAt;
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const x = box.x0 - shape.glyphW * 0.2 + ((box.x1 - box.x0 + shape.glyphW * 0.2) * i) / steps;
    const y = box.y + Math.sin(i * 1.3) * shape.glyphH * 0.05;
    t += 16;
    pts.push({ x: round(x), y: round(y), t: Math.round(t) });
  }
  return { stroke: { id, color: student.color, points: pts }, endsAt: t };
}

// ---------- one running class ----------

function makeClass(code) {
  const shape = boardShape();
  const startedAt = Date.now();
  const width = 3; // a fine pen
  const students = DEMO_STUDENTS.map((s) => {
    const written = writeLines(s, s.lines, shape, s.joinAt + 1400, 0, "w");
    return { ...s, strokes: written.strokes, lineBoxes: written.lineBoxes, comments: [], teacherInk: [], reacted: false, joinedAt: startedAt + s.joinAt };
  });
  return { code, shape, startedAt, width, students, rosterChannels: new Set(), boardChannels: new Set(), resetAt: 0, pensDown: false, lastTickAt: 0 };
}

function reactToComment(cls, student, now) {
  if (student.studentId !== BEN_ID || student.reacted) return;
  student.reacted = true;
  // Wait until he has finished what he was writing, then a moment more.
  const lastPoint = student.strokes.reduce((m, s) => Math.max(m, s.points[s.points.length - 1].t), 0);
  let t = Math.max(now, lastPoint) + REACT_AFTER_MS;
  BEN_STRUCK_LINES.forEach((row, i) => {
    const box = student.lineBoxes[row];
    if (!box) return;
    const made = strikeThrough(student, box, cls.shape, t, `fix-strike-${i}`);
    student.strokes.push(made.stroke);
    t = made.endsAt + 450;
  });
  const fixed = writeLines(student, BEN_FIX_LINES, cls.shape, t + 500, student.lines.length, "fix");
  student.strokes.push(...fixed.strokes);
}

// ---------- the stand-in for the live connection ----------

export function createDemoClassroom() {
  const classes = new Map(); // class code -> running class
  let timer = null;

  // Is this student's hand up / have they said they're done, right now?
  function signals(cls, s, now) {
    const elapsed = now - cls.startedAt;
    const handAt = s.joinedAt + HAND_AFTER_MS;
    const hand = s.studentId === HAND_ID && !s.handLowered && now >= handAt;
    const lastPoint = s.strokes.reduce((m, st) => Math.max(m, st.points[st.points.length - 1].t), 0);
    const finishedAt = cls.startedAt + lastPoint + DONE_AFTER_MS;
    const done = s.studentId !== HAND_ID && elapsed >= lastPoint + DONE_AFTER_MS && finishedAt >= (cls.resetAt || 0);
    return { hand, handAt: hand ? handAt : 0, done };
  }

  // A student's "I'm here" announcement, as the live connection reports it.
  function announcement(s) {
    return { presence_ref: `demo-${s.studentId}`, studentId: s.studentId, name: s.name, joinedAt: s.joinedAt };
  }

  function presenceOf(cls, now) {
    const state = {};
    for (const s of cls.students) {
      if (now - cls.startedAt >= s.joinAt) state[s.studentId] = [announcement(s)];
    }
    return state;
  }

  // Tells one class channel about every student who has joined that it
  // hasn't heard about yet: a "joined" event each, then "the list has
  // changed", the same as the real connection does.
  function tellJoins(cls, channel, now) {
    if (!channel.__told) channel.__told = new Set();
    let any = false;
    for (const s of cls.students) {
      if (now - cls.startedAt < s.joinAt || channel.__told.has(s.studentId)) continue;
      channel.__told.add(s.studentId);
      channel.__emit("presence", "join", { key: s.studentId, currentPresences: [], newPresences: [announcement(s)] });
      any = true;
    }
    if (any) channel.__emit("presence", "sync", null);
  }

  // Tells the teacher's side about any hand or "done" tick that has
  // changed, with the same message a real student's page sends. With
  // `everyone`, says where every student stands (the teacher's side asks
  // for that when it opens).
  function tellSignals(cls, now, everyone) {
    for (const s of cls.students) {
      if (now - cls.startedAt < s.joinAt) continue;
      const sig = signals(cls, s, now);
      const key = `${sig.hand ? 1 : 0}${sig.done ? 1 : 0}`;
      if (!everyone && key === (s.toldSignals || "00")) continue;
      s.toldSignals = key;
      cls.rosterChannels.forEach((ch) => ch.__emit("broadcast", "student-status", { studentId: s.studentId, ...sig }));
    }
  }

  // A finished line, as a board keeps it.
  function asInk(cls, stroke) {
    return {
      id: stroke.id, tool: "pen", color: stroke.color, width: cls.width, opacity: 1,
      points: stroke.points.map((p) => ({ x: p.x, y: p.y })),
    };
  }

  // Sends whatever a student has drawn up to `now` that this board channel
  // hasn't been sent yet, with the same messages a real board sends while
  // someone is drawing (stroke-start, then points in chunks, then
  // stroke-end).
  function catchUp(cls, channel, now) {
    const view = channel.__view;
    if (!view || !view.watching) return;
    const elapsed = now - cls.startedAt;
    for (const stroke of view.student.strokes) {
      const pts = stroke.points;
      if (pts[0].t > elapsed) continue;
      let sent = view.sent.get(stroke.id) || 0;
      if (sent === -1) continue; // finished and already ended
      const strokeKey = `${view.student.studentId}-${stroke.id}`;
      if (sent === 0) {
        channel.__emit("broadcast", "stroke-start", {
          strokeKey, strokeId: stroke.id, tool: "pen", color: stroke.color, width: cls.width, opacity: 1,
          point: { x: pts[0].x, y: pts[0].y },
        });
        sent = 1;
      }
      let ready = sent;
      while (ready < pts.length && pts[ready].t <= elapsed) ready++;
      for (let i = sent; i < ready; i += CHUNK) {
        channel.__emit("broadcast", "stroke-points", {
          strokeKey,
          points: pts.slice(i, Math.min(ready, i + CHUNK)).map((p) => ({ x: p.x, y: p.y })),
        });
      }
      if (ready >= pts.length) {
        channel.__emit("broadcast", "stroke-end", { strokeKey });
        view.sent.set(stroke.id, -1);
      } else {
        view.sent.set(stroke.id, ready);
      }
    }
  }

  function tick() {
    const now = Date.now();
    let busy = false;
    classes.forEach((cls) => {
      if (cls.rosterChannels.size || cls.boardChannels.size) busy = true;
      // "Pens down": time stands still for the pretend students, so they
      // stop where they are and carry on from there when the teacher lets go.
      if (cls.pensDown && cls.lastTickAt) cls.startedAt += now - cls.lastTickAt;
      cls.lastTickAt = now;
      cls.rosterChannels.forEach((ch) => tellJoins(cls, ch, now));
      tellSignals(cls, now, false);
      cls.boardChannels.forEach((ch) => catchUp(cls, ch, now));
    });
    if (!busy && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function wake() {
    if (!timer) timer = setInterval(tick, TICK_MS);
  }

  return {
    // Is this one of the live-class channels?
    handles(topic) {
      return /^classroom-/.test(topic) || /^board-student-/.test(topic);
    },

    // The channel has connected.
    attach(channel) {
      const roster = /^classroom-(.+)$/.exec(channel.topic);
      if (roster) {
        const code = roster[1];
        if (!classes.has(code)) classes.set(code, makeClass(code));
        const cls = classes.get(code);
        cls.rosterChannels.add(channel);
        channel.__class = cls;
        channel.__told = new Set();
        // Whoever is already in the class, straight away.
        tellJoins(cls, channel, Date.now());
        wake();
        return;
      }
      const board = /^board-student-([^-]+)-(.+)$/.exec(channel.topic);
      if (board) {
        const cls = classes.get(board[1]);
        const student = cls && cls.students.find((s) => s.studentId === board[2]);
        if (!cls || !student) return;
        cls.boardChannels.add(channel);
        channel.__class = cls;
        channel.__view = { student, watching: false, sent: new Map() };
        wake();
      }
    },

    // The channel has been closed (the teacher left that view, or ended
    // the class).
    detach(channel) {
      const cls = channel.__class;
      if (!cls) return;
      cls.boardChannels.delete(channel);
      if (cls.rosterChannels.delete(channel) && cls.rosterChannels.size === 0) classes.delete(cls.code);
    },

    presenceState(channel) {
      return channel.__class && !channel.__view ? presenceOf(channel.__class, Date.now()) : {};
    },

    // Something the teacher's side sent.
    receive(channel, message) {
      const cls = channel.__class;
      const view = channel.__view;
      if (!cls || !message) return;
      const now = Date.now();
      if (!view) {
        // To the whole class: "where does everyone stand?", "put that hand
        // down" and "clear everyone's hands and ticks". Changes are told on
        // the next tick.
        if (message.event === "status-request") {
          tellSignals(cls, now, true);
        } else if (message.event === "hand-lower" && message.payload) {
          const who = cls.students.find((s) => s.studentId === message.payload.studentId);
          if (who) who.handLowered = true;
        } else if (message.event === "status-reset") {
          cls.resetAt = now;
          cls.students.forEach((s) => { s.handLowered = true; });
        } else if (message.event === "class-state" && message.payload) {
          cls.pensDown = !!message.payload.pensDown;
        }
        return;
      }
      if (message.event === "classroom-state-request") {
        // "What's on your board so far?" Answer as a real board does: the
        // lines already finished and the teacher's comments in one message,
        // then the line being written right now, live.
        view.watching = true;
        view.sent = new Map();
        setTimeout(() => {
          if (channel.closed) return;
          const elapsed = Date.now() - cls.startedAt;
          const finished = view.student.strokes.filter((st) => st.points[st.points.length - 1].t <= elapsed);
          finished.forEach((st) => view.sent.set(st.id, -1));
          channel.__emit("broadcast", "classroom-state-snapshot", {
            strokes: finished.map((st) => asInk(cls, st)),
            texts: [],
            images: [],
            grid: null,
            background: "blank",
            referenceDoc: null,
            referenceStrokes: [],
            comments: view.student.comments.slice(),
            teacherInk: view.student.teacherInk.slice(),
          });
          catchUp(cls, channel, Date.now());
        }, 120);
      } else if (message.event === "teacher-comment-add" && message.payload) {
        view.student.comments.push(message.payload);
        reactToComment(cls, view.student, now - cls.startedAt);
      } else if (message.event === "teacher-comment-remove" && message.payload) {
        view.student.comments = view.student.comments.filter((c) => c.id !== message.payload.id);
      } else if (message.event === "teacher-ink-end" && message.payload && message.payload.stroke) {
        // What the teacher writes on a pretend student's board is kept with
        // it, as a real student's board keeps it.
        const stroke = message.payload.stroke;
        if (!view.student.teacherInk.some((st) => st.id === stroke.id)) view.student.teacherInk.push(stroke);
      } else if (message.event === "teacher-ink-remove" && message.payload) {
        const gone = new Set(message.payload.ids || []);
        view.student.teacherInk = view.student.teacherInk.filter((st) => !gone.has(st.id));
      } else if (message.event === "teacher-ink-clear") {
        view.student.teacherInk = [];
      }
    },
  };
}
