// What the teacher is doing to the whole class in a live class, and how
// their question gets from their board onto every student's.
//
// THE CLASS STATE
// One small message on the class's live connection ("class-state") says
// everything a student's page needs to know about what the teacher has
// switched on:
//   { spotlight: { studentId, name } | null,   whose board is being shown
//                                              to everyone (name is null
//                                              when shown without a name)
//     pensDown: true | false,                  everyone's own board paused
//     question: "<id>" | null }                which question is on
//                                              everyone's board
// The teacher's board sends it whenever any of it changes, whenever a
// student's page asks ("class-state-request", sent as it joins), and when
// the teacher's own page (re)connects. Sending the whole state each time,
// rather than "on" / "off" messages, means a page that missed one message
// is put right by the next.
//
// THE QUESTION
// "Send my board to students" copies what is on the teacher's board to
// every student's board, where it sits as a layer the student can see and
// write over but not rub out (see drawTeacherLayer in boardRender.js). A
// board can be far bigger than one live message is allowed to be, so it
// goes in pieces:
//   "class-question"        { id, pieces, grid, sentAt }
//   "class-question-piece"  { id, index, strokes, texts, images }  × pieces
//   "class-question-done"   { id }
// A student who joins later (or missed a piece) sees from the class state
// that there is a question it doesn't have, and asks for it
// ("class-question-request"); the teacher's board sends it again.

import { chunkObjects, newId } from "./boardObjects";

const CONTROL_KEY = "classroom_control_"; // + class code
const QUESTION_KEY = "classroom_question_"; // + class code
const PIECE_CHARS = 60000;

export const NO_CONTROL = { spotlight: null, pensDown: false };

// ---------- the teacher's side ----------
//
// Tiny stores, read with useSyncExternalStore: what is switched on for the
// class (keyed by class code), and the question last sent. "Pens down" and
// the question are also kept in the tab's own storage, so refreshing the
// teacher's page mid-class doesn't release everyone's boards or lose the
// question for students who join afterwards. The spotlight isn't: after a
// refresh the teacher is back on their own board, so nothing is being shown.

const controls = new Map(); // class code -> { spotlight, pensDown }
const questions = new Map(); // class code -> question | null
const listeners = new Set();

function read(key) {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function write(key, value) {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    return false; // too big, or storage switched off: it just isn't remembered
  }
}

function tell() {
  listeners.forEach((l) => l());
}

export function subscribeClassControl(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getClassControl(code) {
  if (!code || typeof window === "undefined") return NO_CONTROL;
  if (!controls.has(code)) {
    const saved = read(CONTROL_KEY + code);
    controls.set(code, saved && saved.pensDown ? { spotlight: null, pensDown: true } : NO_CONTROL);
  }
  return controls.get(code);
}

export function getServerClassControl() {
  return NO_CONTROL;
}

// changes: { pensDown } and / or { spotlight: { studentId, name, showName } | null }
export function setClassControl(code, changes) {
  if (!code) return;
  const now = getClassControl(code);
  const next = { ...now, ...changes };
  const sameSpot =
    (now.spotlight ? now.spotlight.studentId : null) === (next.spotlight ? next.spotlight.studentId : null) &&
    (now.spotlight ? !!now.spotlight.showName : false) === (next.spotlight ? !!next.spotlight.showName : false);
  if (sameSpot && now.pensDown === next.pensDown) return;
  controls.set(code, next);
  write(CONTROL_KEY + code, next.pensDown ? { pensDown: true } : null);
  tell();
}

export function getSentQuestion(code) {
  if (!code || typeof window === "undefined") return null;
  if (!questions.has(code)) {
    const saved = read(QUESTION_KEY + code);
    questions.set(code, saved && saved.id ? saved : null);
  }
  return questions.get(code);
}

export function getServerSentQuestion() {
  return null;
}

export function setSentQuestion(code, question) {
  if (!code) return;
  questions.set(code, question || null);
  // If the whole question is too big for the tab's storage, just the fact
  // that one was sent is kept ("lost": its contents aren't). After a
  // refresh of the teacher's page students then keep the copy they have,
  // rather than being told there is no question any more; the teacher can
  // send again for anyone who joins later.
  if (!write(QUESTION_KEY + code, question || null) && question) {
    write(QUESTION_KEY + code, { id: question.id, sentAt: question.sentAt, lost: true });
  }
  tell();
}

// The class is over: nothing is switched on any more.
export function forgetClass(code) {
  if (!code) return;
  controls.delete(code);
  questions.delete(code);
  if (typeof window !== "undefined") {
    write(CONTROL_KEY + code, null);
    write(QUESTION_KEY + code, null);
  }
  tell();
}

// What students are told (see the top of this file).
export function classStateMessage(control, question) {
  const spot = control && control.spotlight;
  return {
    spotlight: spot ? { studentId: spot.studentId, name: spot.showName ? spot.name : null } : null,
    pensDown: !!(control && control.pensDown),
    question: question ? question.id : null,
  };
}

// What a student's page makes of a "class-state" message.
export function readClassState(payload) {
  const p = payload || {};
  const spot = p.spotlight && p.spotlight.studentId ? p.spotlight : null;
  return {
    spotlight: spot ? { studentId: String(spot.studentId), name: spot.name ? String(spot.name) : null } : null,
    pensDown: !!p.pensDown,
    question: p.question ? String(p.question) : null,
  };
}

// ---------- the question ----------

// Positions to a hundredth of a board unit: far finer than can be seen at
// any zoom, and about half the size to send and to store.
function trimPoint(p) {
  const out = {};
  for (const key in p) out[key] = typeof p[key] === "number" ? Math.round(p[key] * 100) / 100 : p[key];
  return out;
}

// A copy of what is on the teacher's board right now, ready to send (null
// if the board is empty).
export function questionFromBoard({ strokes = [], texts = [], images = [], grid = null }) {
  const usable = strokes.filter((s) => s && s.points && s.points.length > 1);
  // Rub-outs only matter if there is ink for them to rub out.
  const ink = usable.some((s) => s.tool !== "eraser") ? usable : [];
  if (!ink.length && !texts.length && !images.length && !grid) return null;
  return {
    id: newId(),
    sentAt: Date.now(),
    strokes: ink.map((s) => ({ ...s, points: s.points.map(trimPoint) })),
    texts: texts.slice(),
    images: images.map((img) => ({ id: img.id, src: img.src, x: img.x, y: img.y, width: img.width, height: img.height })),
    grid: grid || null,
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sends a question, in pieces. `send(event, payload)` puts one message on
// the class's live connection and resolves with how it went ("ok", or
// "error" / "timed out"). The pieces are spaced out a little so a big board
// doesn't arrive as one burst. `stillWanted()`, if given, is asked before
// each piece: when it says no (the teacher has taken the question back, or
// sent a newer one) the rest is left unsent. Resolves with the number of
// pieces, or -1 if it stopped part way; throws if a message couldn't go.
export async function sendQuestion(send, question, gapMs = 45, stillWanted = null) {
  const put = async (event, payload) => {
    const result = await send(event, payload);
    if (result === "error" || result === "timed out") throw new Error(`The message couldn't be sent (${result})`);
  };
  const pieces = chunkObjects(
    { strokes: question.strokes || [], texts: question.texts || [], images: question.images || [] },
    PIECE_CHARS
  );
  await put("class-question", { id: question.id, pieces: pieces.length, grid: question.grid || null, sentAt: question.sentAt });
  for (let i = 0; i < pieces.length; i++) {
    if (i > 0 && gapMs > 0) await wait(gapMs);
    if (stillWanted && !stillWanted()) return -1;
    await put("class-question-piece", { id: question.id, index: i, ...pieces[i] });
  }
  if (stillWanted && !stillWanted()) return -1;
  await put("class-question-done", { id: question.id });
  return pieces.length;
}

// The teacher's side keeps one of these: it sends the class question, makes
// sure only one copy is on its way out at a time, and if the question
// changes while one is going, sends the newest straight after.
//   run(send, getQuestion)  resolves true once the latest question has gone
export function createQuestionSender() {
  let busy = false;
  let again = false;
  let lastSentAt = 0;
  return {
    isBusy: () => busy,
    lastSentAt: () => lastSentAt,
    async run(send, getQuestion) {
      if (busy) {
        again = true;
        return true;
      }
      busy = true;
      try {
        do {
          again = false;
          const question = getQuestion();
          // nothing to send (or only the note that one was sent: see setSentQuestion)
          if (!question || question.lost) break;
          await sendQuestion(send, question, 45, () => getQuestion() === question);
          lastSentAt = Date.now();
        } while (again);
        return true;
      } catch (err) {
        return false;
      } finally {
        busy = false;
        again = false;
      }
    },
  };
}

// The student's side: puts the pieces back together. `onQuestion(question)`
// is called once a whole question has arrived.
export function createQuestionReceiver(onQuestion) {
  let incoming = null; // { id, expected, grid, sentAt, pieces: Map(index -> piece) }
  return {
    // Is this question on its way right now?
    receiving(id) {
      return !!incoming && incoming.id === id;
    },
    // Forget whatever is half way here (the teacher has taken it back).
    reset() {
      incoming = null;
    },
    header(payload) {
      if (!payload || !payload.id) return;
      if (incoming && incoming.id === payload.id) return; // being sent again: keep what has come
      incoming = { id: payload.id, expected: Number(payload.pieces) || 0, grid: payload.grid || null, sentAt: payload.sentAt || Date.now(), pieces: new Map() };
    },
    piece(payload) {
      if (!incoming || !payload || payload.id !== incoming.id) return;
      incoming.pieces.set(Number(payload.index) || 0, payload);
    },
    done(payload) {
      if (!incoming || !payload || payload.id !== incoming.id) return;
      const got = incoming;
      if (got.pieces.size < got.expected) return; // a piece went missing: wait for it to be sent again
      incoming = null;
      const question = { id: got.id, sentAt: got.sentAt, strokes: [], texts: [], images: [], grid: got.grid };
      for (let i = 0; i < got.expected; i++) {
        const piece = got.pieces.get(i) || {};
        question.strokes.push(...(piece.strokes || []));
        question.texts.push(...(piece.texts || []));
        question.images.push(...(piece.images || []));
      }
      onQuestion(question);
    },
  };
}
