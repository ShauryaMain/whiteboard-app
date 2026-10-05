// A board that is kept on the student's own device instead of the database.
//
// Used for a student's own board in a live class. Students never sign in,
// so they have no access to the database (by design); their board is a
// scratch pad for the lesson. The teacher sees it over the live connection,
// not from the database.
//
// The board component (Whiteboard.js) loads and saves through whatever
// "store" it is given. This file makes a store that answers those same
// calls from memory, so a student gets exactly the same board, with the
// same tools, as a signed-in teacher. It reuses the query stand-in the demo
// board already runs on (see demoBackend.js).
//
// The board is also copied into this browser's storage as the student
// works, so a refresh (or closing the tab by accident and joining again)
// brings their work back. The copy is filed under the class code and the
// name they joined with, stays on this device only, and is thrown away
// after a day.

import { DemoQuery } from "./demoBackend";
import { getOrCreateStudentId } from "./classroomCode";
import { msSincePenActivity } from "./penActivity";

const SAVE_PREFIX = "cleanslate_classboard_"; // + class code + "_" + name
const KEEP_FOR_MS = 24 * 60 * 60 * 1000; // saved boards older than this are deleted
const KEEP_AT_MOST = 4; // classes remembered on one device
const MAX_PEN_WAIT_MS = 5000; // the longest a save waits for the pen to lift

// The name a student's board goes by. The live channel for it is
// "board-" + this, the same pattern every other board uses.
export function studentBoardId(code, studentId) {
  return `student-${String(code).toUpperCase()}-${studentId}`;
}

function later(value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), 0));
}

// ---------- the copy kept on this device ----------

// Where one student's board for one class is kept. The name is part of
// it, so two students who use the same device for the same class each get
// their own board back, not each other's.
function saveKey(code, name) {
  // Letters and digits of any alphabet are kept, so "李雷" and "Мария" each
  // get their own board rather than sharing one.
  const who = String(name || "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "student";
  return `${SAVE_PREFIX}${code}_${who}`;
}

function savedKeys() {
  const keys = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key && key.indexOf(SAVE_PREFIX) === 0) keys.push(key);
  }
  return keys;
}

// Deletes saved class boards that are out of date (or, when room is needed,
// all but the one being used).
function tidySaved(keepKey, makeRoom = false) {
  try {
    const now = Date.now();
    const kept = [];
    for (const key of savedKeys()) {
      if (key === keepKey) continue;
      let savedAt = 0;
      try {
        savedAt = Number(JSON.parse(window.localStorage.getItem(key)).savedAt) || 0;
      } catch (err) {
        // unreadable: treat as ancient
      }
      if (makeRoom || now - savedAt > KEEP_FOR_MS) window.localStorage.removeItem(key);
      else kept.push({ key, savedAt });
    }
    kept.sort((a, b) => b.savedAt - a.savedAt);
    kept.slice(KEEP_AT_MOST - 1).forEach((entry) => window.localStorage.removeItem(entry.key));
  } catch (err) {
    // storage switched off: nothing to tidy
  }
}

// What this student left on their board for this class earlier, or null.
export function readSavedBoard(code, name) {
  try {
    const raw = window.localStorage.getItem(saveKey(code, name));
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || saved.v !== 1) return null;
    if (Date.now() - (Number(saved.savedAt) || 0) > KEEP_FOR_MS) return null;
    return saved;
  } catch (err) {
    return null;
  }
}

function writeSavedBoard(code, name, payload) {
  const key = saveKey(code, name);
  const text = JSON.stringify(payload);
  try {
    window.localStorage.setItem(key, text);
    return text.length;
  } catch (err) {
    // Out of room: drop the other classes saved on this device and try once more.
    try {
      tidySaved(key, true);
      window.localStorage.setItem(key, text);
      return text.length;
    } catch (again) {
      return -1;
    }
  }
}

// ---------- the store ----------

// Each new thing gets a later time stamp than the one before, even when
// several arrive in the same instant (a pasted group, an inserted shape),
// so the board always comes back in the order it was drawn.
function makeStamper() {
  let last = 0;
  return () => {
    last = Math.max(Date.now(), last + 1);
    return new Date(last).toISOString();
  };
}

class LocalQuery extends DemoQuery {
  constructor(tables, table, hooks) {
    super(tables, table);
    this.hooks = hooks;
  }

  stamped(rows) {
    const known = new Set((this.tables[this.table] || []).map((r) => String(r.id)));
    const stamp = (row) =>
      row && row.created_at === undefined && !known.has(String(row.id)) ? { ...row, created_at: this.hooks.stamp() } : row;
    return Array.isArray(rows) ? rows.map(stamp) : stamp(rows);
  }

  insert(rows) {
    return super.insert(this.stamped(rows));
  }

  upsert(rows) {
    return super.upsert(this.stamped(rows));
  }

  run() {
    const result = super.run();
    if (this.op !== "select") this.hooks.changed();
    return result;
  }
}

// The teacher's comments on this board: a small list the board and the
// class page both read (with useSyncExternalStore), saved with the board.
function makeComments(initial, changed) {
  let list = Array.isArray(initial) ? initial : [];
  const listeners = new Set();
  const set = (next) => {
    list = next;
    listeners.forEach((l) => l());
    changed();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => list,
    add(comment) {
      if (!comment || !comment.id || list.some((c) => c.id === comment.id)) return;
      set([...list, comment]);
    },
    remove(id) {
      if (list.some((c) => c.id === id)) set(list.filter((c) => c.id !== id));
    },
  };
}

// A store with no comments, for boards that never have any (every board
// that isn't a student's class board).
const NOTHING = [];
export const NO_COMMENTS = {
  subscribe: () => () => {},
  get: () => NOTHING,
  add() {},
  remove() {},
};
export function noComments() {
  return NOTHING;
}

// What the teacher has put on this student's board: the question sent to
// the whole class, and anything the teacher has written on this board in
// particular. The student can see both and write over them, but only the
// teacher can take them away (see drawTeacherLayer in boardRender.js).
// Kept with the board, so a refresh brings them back too. Read with
// useSyncExternalStore: get() hands back the same object until something
// changes.
function makeTeacherLayer(initial, changed) {
  const first = initial && typeof initial === "object" ? initial : {};
  let value = {
    question: first.question && first.question.id ? first.question : null,
    ink: Array.isArray(first.ink) ? first.ink.filter((s) => s && s.id) : [],
  };
  const listeners = new Set();
  const set = (next) => {
    value = next;
    listeners.forEach((l) => l());
    changed();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => value,
    setQuestion(question) {
      const next = question && question.id ? question : null;
      if ((value.question ? value.question.id : null) === (next ? next.id : null)) return;
      set({ ...value, question: next });
    },
    addInk(stroke) {
      if (!stroke || !stroke.id || !Array.isArray(stroke.points) || value.ink.some((s) => s.id === stroke.id)) return;
      set({ ...value, ink: [...value.ink, stroke] });
    },
    removeInk(ids) {
      const gone = new Set(ids || []);
      if (!value.ink.some((s) => gone.has(s.id))) return;
      set({ ...value, ink: value.ink.filter((s) => !gone.has(s.id)) });
    },
    clearInk() {
      if (value.ink.length) set({ ...value, ink: [] });
    },
  };
}

const NO_LAYER = { question: null, ink: [] };
export const NO_TEACHER_LAYER = {
  subscribe: () => () => {},
  get: () => NO_LAYER,
  setQuestion() {},
  addInk() {},
  removeInk() {},
  clearInk() {},
};
export function noTeacherLayer() {
  return NO_LAYER;
}

// Whether the last attempt to keep a copy on this device failed (the board
// has outgrown the browser's storage). The board shows a note while it is
// true. Read with useSyncExternalStore.
function makeFlag() {
  let value = false;
  const listeners = new Set();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => value,
    set(next) {
      if (next === value) return;
      value = next;
      listeners.forEach((l) => l());
    },
  };
}

export const NO_SAVE_PROBLEM = {
  subscribe: () => () => {},
  get: () => false,
  set() {},
};
export function noSaveProblem() {
  return false;
}

// `saved` is an earlier copy to start from (see readSavedBoard); `onChange`
// is called whenever anything on the board changes.
export function createLocalBoard(boardId, { name = "My board", saved = null, onChange } = {}) {
  const stamp = makeStamper();
  const changed = () => {
    if (onChange) onChange();
  };
  const settings = (saved && saved.board) || {};
  const rows = (list) => (Array.isArray(list) ? list : []).filter((r) => r && r.id).map((r) => ({ ...r, board_id: boardId, created_at: stamp() }));
  const tables = {
    boards: [
      {
        id: boardId,
        // Not the student: the board's "owner only" controls (sharing the
        // link, starting a class, reference documents) stay switched off.
        owner_id: "class-teacher",
        name,
        grid_config: settings.grid_config || null,
        background: settings.background || null,
        sim_embeds: [],
        thumbnail: null,
        created_at: new Date().toISOString(),
      },
    ],
    strokes: rows(saved && saved.strokes),
    texts: rows(saved && saved.texts),
    images: [],
  };
  const hooks = { stamp, changed };
  const comments = makeComments(saved && saved.comments, changed);
  const teacher = makeTeacherLayer(saved && saved.teacher, changed);
  const unavailable = () => later({ data: null, error: new Error("Files can't be added to a class board.") });
  return {
    __local: true,
    // How many things came back from an earlier visit (0 for a fresh board).
    __restored: tables.strokes.length + tables.texts.length,
    from: (table) => new LocalQuery(tables, table, hooks),
    rpc: () => later({ data: null, error: null }),
    comments,
    teacher,
    saveProblem: makeFlag(),
    // Everything worth keeping, in a form that can be stored and read back.
    snapshot() {
      const board = tables.boards[0] || {};
      const strip = (row) => {
        const copy = { ...row };
        delete copy.board_id; // the board's name changes from visit to visit
        return copy;
      };
      return {
        board: { background: board.background || null, grid_config: board.grid_config || null },
        strokes: tables.strokes.map(strip),
        texts: tables.texts.map(strip),
        comments: comments.get(),
        teacher: teacher.get(),
      };
    },
    // Pictures and documents are switched off on a student's board, so
    // nothing should ever ask for these. They refuse politely if it does.
    storage: {
      from() {
        return {
          upload: unavailable,
          remove: () => later({ data: [], error: null }),
          getPublicUrl: () => ({ data: { publicUrl: "" } }),
        };
      },
    },
  };
}

// ---------- this student's board for a class ----------

// Saves a moment after the last change. A pen that is still moving is left
// alone (writing to storage can make ink stutter on an older tablet), and a
// big board is saved less often than a small one.
function makeSaver(code, name, getBackend) {
  let timer = null;
  let lastSize = 0;
  let waitingSince = 0;
  const write = () => {
    timer = null;
    waitingSince = 0;
    const backend = getBackend();
    if (!backend) return;
    const copy = { v: 1, name, savedAt: Date.now(), ...backend.snapshot() };
    let size = writeSavedBoard(code, name, copy);
    if (size < 0 && copy.teacher && copy.teacher.question) {
      // No room: the teacher's question can be fetched again after a
      // refresh, the student's own work can't. So it is the question that
      // is left out.
      size = writeSavedBoard(code, name, { ...copy, teacher: { ...copy.teacher, question: null } });
    }
    if (size > 0) lastSize = size;
    backend.saveProblem.set(size < 0);
  };
  const tick = () => {
    // Wait for the pen to lift, but not for ever: a pen left hovering over
    // the screen counts as "moving", and the work still has to be kept.
    if (msSincePenActivity() < 600 && Date.now() - waitingSince < MAX_PEN_WAIT_MS) {
      timer = setTimeout(tick, 400);
      return;
    }
    write();
  };
  const now = () => {
    if (!timer) return;
    clearTimeout(timer);
    write();
  };
  // Leaving the page (a refresh, closing the tab, switching apps on a
  // tablet): save straight away rather than waiting.
  window.addEventListener("pagehide", now);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") now();
  });
  return () => {
    if (timer) return;
    const wait = lastSize > 1200000 ? 8000 : lastSize > 400000 ? 4000 : 1200;
    timer = setTimeout(() => {
      waitingSince = Date.now();
      tick();
    }, wait);
  };
}

// This student's own board for a class: who they are, the board's name and
// where it is kept. Made the first time it is asked for and then handed
// back as-is, so the class page always gets the very same board. Null
// outside the browser.
const myBoards = new Map(); // class code + name -> { boardId, backend, student }

function joinedName() {
  try {
    return window.sessionStorage.getItem("classroom_student_name") || "Student";
  } catch (err) {
    // storage switched off: the name just stays "Student"
    return "Student";
  }
}

export function myClassBoard(code) {
  if (typeof window === "undefined" || !code) return null;
  const classCode = String(code).toUpperCase();
  // The name is part of what the board is filed under: someone who leaves
  // and joins again under another name (a shared tablet passed along) gets
  // that name's board, not the last person's.
  const name = joinedName();
  const cacheKey = `${classCode}\n${name}`;
  if (!myBoards.has(cacheKey)) {
    const studentId = getOrCreateStudentId();
    const boardId = studentBoardId(classCode, studentId);
    tidySaved(saveKey(classCode, name));
    const saved = readSavedBoard(classCode, name);
    const entry = { boardId, backend: null, student: { code: classCode, studentId, name } };
    const save = makeSaver(classCode, name, () => entry.backend);
    entry.backend = createLocalBoard(boardId, { saved, onChange: save });
    // Comments that were already there before this visit aren't "new".
    entry.seenComments = entry.backend.comments.get().map((c) => c.id);
    myBoards.set(cacheKey, entry);
  }
  return myBoards.get(cacheKey);
}

// The student has looked at these comments: they no longer count as new,
// including if they leave and join the class again in the same tab.
export function markCommentsSeen(board, ids) {
  if (board) board.seenComments = ids;
}
