// A student's board in a live class only sends what the student is doing
// while somebody is looking at it.
//
// A student's board is an ordinary board, so left to itself it puts every
// line on the live connection as it is drawn, whether or not anyone has it
// open. With a whole class writing at once that is a great many messages
// going to nobody, and the live service only allows a project so many a
// second. So:
//
//   • Whoever is showing a student's board (the teacher's view of one board,
//     the class overview, a classmate being shown it) says so when it asks
//     for the board, says "still watching" every so often after that, and
//     says when it stops. That is the "watcher" half, below.
//   • The student's board keeps what it would have sent to itself unless a
//     watcher has been heard from lately. That is the "gate" half.
//
// Nothing is lost by not sending: anyone who starts watching asks for the
// whole board first (see sendClassSnapshot in Whiteboard.js), exactly as
// they always have.
//
// The class overview is a wall of small pictures, where nobody can follow a
// line being drawn point by point. Its watchers say they only want a
// "glance", and are sent each line once, when it is finished, rather than
// as it is drawn.
//
// A view that was on screen all along could still fall behind: its "still
// watching" didn't get through for a while, say, and the student wrote
// meanwhile. So the board numbers its "editions". The edition goes up
// whenever something is kept back; each whole board it sends is stamped
// with the edition it is; and a watcher says which edition it has every
// time it says "still watching". One that is behind is told to ask again.
//
// The messages, all on the student's own board channel:
//   classroom-state-request { v: 2, watch?: { id, glance? }, comments? }
//       "what's on you?" v: 2 marks a viewer that knows about all this;
//       `watch` is there when it is going to keep watching afterwards.
//   classroom-state-snapshot { …, edition, askedBy }   the answer (the
//       edition, and which watchers' asking it answers, are added here)
//   board-watch   { id, glance?, edition? }   still watching
//   board-unwatch { id, glance? }             stopped
//   board-here    { edition }   from the board: "this is where I am". Sent
//       when it connects, and when a watcher turns out to be behind.

import { newId } from "./boardObjects";

export const WATCH_BEAT_MS = 25000; // a watcher says "still watching" this often (each one reaches everyone on the board)
export const WATCH_TTL_MS = 60000; // and is taken to have gone after this long without a word
export const WATCH_LEAVE_GRACE_MS = 3000; // after "I've stopped": time for anyone else watching to say so
const ANSWER_WITHIN_MS = 1000;
const BEAT_SLACK_MS = 1000;
const HERE_GAP_MS = 2500; // "ask me again" isn't said more often than this
const CROSSED_MS = 1500;
const REJOIN_MEMORY_MS = 5 * 60000;
// How long a connection can have been dead before the page is told it is.
const UNNOTICED_DROP_MS = 60000;
const MAX_STRANGER_GAP_MS = 10 * 60000;

// A finished line goes as one message unless it is enormous.
const WHOLE_STROKE_CHARS = 60000;
const STROKE_CHUNK_POINTS = 800;
const MAX_TRACKED_STROKES = 4;
const MAX_ASKERS_LISTED = 64;

// Always sent, watched or not: the board's answer to "what's on you?", and
// its own housekeeping.
const ALWAYS = new Set(["classroom-state-snapshot", "classroom-state-piece", "classroom-state-done", "board-here", "reference-request"]);
const LINE_BEING_DRAWN = new Set(["stroke-start", "stroke-points", "stroke-straight", "stroke-shape", "stroke-end"]);

// Time that only ever goes forwards (the clock on the wall can be changed
// under a page, and jumps when a tablet has been asleep).
export function steadyNow() {
  return typeof performance !== "undefined" && performance && typeof performance.now === "function" ? performance.now() : Date.now();
}

// An edition is "<which page>-<number>". Is `candidate` a later edition
// from the same page as `mine`? (One from a different page isn't "later":
// it is another board altogether, such as the same student's page after a
// refresh, which announces itself.)
export function samePage(a, b) {
  return !!a && !!b && String(a).split("-")[0] === String(b).split("-")[0];
}

export function isNewerEdition(candidate, mine) {
  if (!candidate || !mine) return false;
  const [theirPage, theirNumber] = String(candidate).split("-");
  const [myPage, myNumber] = String(mine).split("-");
  return theirPage === myPage && Number(theirNumber) > Number(myNumber);
}

// Is this the id of a student's own board in a class (see studentBoardId in
// localBoard.js)? Only those hold back what they send.
export function isStudentBoard(boardId) {
  return /^student-/.test(String(boardId || ""));
}

// ---------- the student's board: what goes out ----------
//
// rawSend(message) puts a message on the live connection. The gate's own
// send(message) takes the same messages the board has always sent, and
// decides what becomes of each.
export function createSendGate(rawSend, { now = steadyNow } = {}) {
  let fullUntil = -Infinity; // someone is watching every movement until then
  let glanceUntil = -Infinity; // someone is watching finished lines until then
  let legacy = false; // a viewer from before all this is about: always send
  const run = newId().slice(0, 8);
  let edition = 1;
  let behind = false; // something has been kept back since a whole board last went out
  let hereAt = -Infinity; // when the board last said "this is where I am"
  let lastHeardAt = -Infinity; // when a viewer was last heard from (so the connection was working)
  let lastSentAt = -Infinity; // when something the student did last went out
  let droppedAt = null; // when the connection was found to be down
  let watchSaidAt = -Infinity; // when anyone last said they were watching…
  let leaveSaidAt = -Infinity; // …and when anyone last said they had stopped
  const strangers = new Map(); // other pages' editions viewers have reported -> times told
  const askers = new Set(); // watchers whose "what's on you?" the next whole board answers
  const lastWatch = { full: null, glance: null }; // who last said "watching", and when
  const lines = new Map(); // strokeKey -> { stroke, live } for lines being drawn

  const token = () => `${run}-${edition}`;

  function mode() {
    const t = now();
    if (legacy || t < fullUntil) return "full";
    return t < glanceUntil ? "glance" : "off";
  }

  function keptBack() {
    if (!behind) {
      behind = true;
      edition += 1;
    }
    return Promise.resolve("ok");
  }

  function swallowed() {
    return Promise.resolve("ok");
  }

  function pass(message) {
    lastSentAt = now();
    return rawSend(message);
  }

  function out(event, payload) {
    return pass({ type: "broadcast", event, payload });
  }

  // A finished line, in one go.
  function sendWhole(key, stroke) {
    let size = WHOLE_STROKE_CHARS + 1;
    try {
      size = JSON.stringify(stroke).length;
    } catch (err) {
      // falls through to sending it in parts
    }
    if (size <= WHOLE_STROKE_CHARS) return out("stroke-restore", { stroke });
    out("stroke-start", {
      strokeKey: key, strokeId: stroke.id, tool: stroke.tool, color: stroke.color,
      width: stroke.width, opacity: stroke.opacity, point: stroke.points[0],
    });
    for (let i = 1; i < stroke.points.length; i += STROKE_CHUNK_POINTS) {
      out("stroke-points", { strokeKey: key, points: stroke.points.slice(i, i + STROKE_CHUNK_POINTS) });
    }
    return out("stroke-end", { strokeKey: key });
  }

  function sendLine(message) {
    const { event } = message;
    const payload = message.payload || {};
    const key = payload.strokeKey;
    const m = mode();

    if (event === "stroke-start") {
      // Also when a line is sent again from the top for someone who has
      // just asked for the board. A line that viewers are already following
      // point by point stays that way (or they would be left holding the
      // half they have); otherwise it is followed from here on whichever way
      // suits who is watching now.
      const was = lines.get(key);
      const live = m === "full" || (m === "glance" && !!was && was.live);
      lines.delete(key);
      while (lines.size >= MAX_TRACKED_STROKES) lines.delete(lines.keys().next().value);
      lines.set(key, {
        live,
        stroke: {
          id: payload.strokeId, tool: payload.tool, color: payload.color,
          width: payload.width, opacity: payload.opacity, points: [payload.point],
        },
      });
      if (live) return pass(message);
      return m === "off" ? keptBack() : swallowed();
    }

    const line = lines.get(key);
    if (!line) {
      // a line this gate never saw the start of: nothing to piece together
      return m === "off" ? keptBack() : pass(message);
    }

    if (event === "stroke-points") line.stroke.points.push(...(payload.points || []));
    else if (event === "stroke-straight") line.stroke.points = [payload.start, payload.end];
    else if (event === "stroke-shape") line.stroke.points = (payload.points || []).slice();

    if (event !== "stroke-end") {
      if (!line.live) return m === "off" ? keptBack() : swallowed();
      if (m !== "off") return pass(message);
      // Whoever was following this line has gone part way through it. If
      // someone comes along before it is finished, they get it whole.
      line.live = false;
      return keptBack();
    }

    lines.delete(key);
    if (m === "off") return keptBack();
    if (line.live) return pass(message);
    // the same rule a viewer following it live applies: a dot isn't kept
    if (line.stroke.points.length < 2) return swallowed();
    return sendWhole(key, line.stroke);
  }

  function extend(watch, t) {
    if (watch.glance) glanceUntil = Math.max(glanceUntil, t + WATCH_TTL_MS);
    else fullUntil = Math.max(fullUntil, t + WATCH_TTL_MS);
    lastWatch[watch.glance ? "glance" : "full"] = { id: watch.id, at: t };
    watchSaidAt = t;
  }

  return {
    mode,
    edition: token,

    // Takes the place of the channel's own send() on a student's board.
    send(message) {
      const event = message && message.event;
      if (event === "classroom-state-snapshot") {
        // A whole board: whoever takes it is up to date as of now. It says
        // whose asking it answers: a watcher who takes it without being on
        // that list (its own asking never arrived) knows to say it is
        // watching.
        behind = false;
        const askedBy = [...askers].slice(0, MAX_ASKERS_LISTED);
        askers.clear();
        return rawSend({ ...message, payload: { ...(message.payload || {}), edition: token(), askedBy } });
      }
      if (event === "board-here") return rawSend({ ...message, payload: { ...(message.payload || {}), edition: token() } });
      if (ALWAYS.has(event)) return rawSend(message);
      if (LINE_BEING_DRAWN.has(event)) return sendLine(message);
      return mode() === "off" ? keptBack() : pass(message);
    },

    // Something a viewer said. True when the board should now say
    // "board-here", so that whoever is behind asks for it afresh.
    heard(event, payload) {
      const t = now();
      if (event === "classroom-state-request") {
        lastHeardAt = t;
        // A viewer that doesn't say it knows about watching (a page that
        // was opened before this was added and hasn't been refreshed) can't
        // be expected to say when it stops. Send everything, as before.
        if (!payload || payload.v !== 2) {
          legacy = true;
          return false;
        }
        if (payload.watch) {
          extend(payload.watch, t);
          if (payload.watch.id) askers.add(payload.watch.id);
        }
        return false;
      }
      if (event === "board-watch" && payload) {
        lastHeardAt = t;
        extend(payload, t);
        // Is what this watcher is showing a different edition from the one
        // the board is now? (One that hasn't got a board yet is asking for
        // it anyway.)
        if (!payload.edition || payload.edition === token()) return false;
        let gap = HERE_GAP_MS;
        const theirPage = String(payload.edition).split("-")[0];
        if (theirPage !== run) {
          // An edition from another page altogether. Normally that is this
          // student's page from before a refresh, and saying so once puts
          // the viewer right. If it keeps coming back (the student has the
          // class open twice, and viewers are being answered by both), say
          // it less and less often rather than for ever.
          // (The first time it is said at once, even if this board has only
          // just announced itself: that is the announcement the viewer
          // missed.)
          const told = strangers.get(theirPage) || 0;
          gap = told === 0 ? 0 : Math.min(HERE_GAP_MS * 2 ** told, MAX_STRANGER_GAP_MS);
          if (t - hereAt < gap) return false;
          strangers.delete(theirPage);
          while (strangers.size >= 8) strangers.delete(strangers.keys().next().value);
          strangers.set(theirPage, told + 1);
        }
        if (t - hereAt < gap) return false;
        hereAt = t;
        return true;
      }
      if (event === "board-unwatch" && payload) {
        lastHeardAt = t;
        const level = payload.glance ? "glance" : "full";
        // Somebody else said "watching" a moment ago: the two messages may
        // simply have crossed. Leave things be (if that somebody goes too,
        // they will say so, or go quiet).
        const last = lastWatch[level];
        if (last && last.id !== payload.id && t - last.at < CROSSED_MS) return false;
        leaveSaidAt = t;
        // Others may be watching without having said so lately (see the
        // watcher below): they get a moment to speak up.
        if (level === "glance") glanceUntil = Math.min(glanceUntil, t + WATCH_LEAVE_GRACE_MS);
        else fullUntil = Math.min(fullUntil, t + WATCH_LEAVE_GRACE_MS);
      }
      return false;
    },

    // The board has just connected for the first time on this page and is
    // saying "board-here".
    announced() {
      hereAt = now();
      droppedAt = null;
    },

    // The board's connection has been found to be down.
    dropped() {
      if (droppedAt === null) droppedAt = now();
    },

    // The board's connection dropped and has come back. True when the
    // board should say "board-here":
    //   • something the student did may have gone nowhere while it was away
    //     (it was sent around the time the connection went, or after, and
    //     no viewer has been heard from since): whoever is watching asks
    //     for the board afresh;
    //   • or it was away so long that it has stopped sending, though it was
    //     being watched not long ago and nobody said they had stopped:
    //     whoever still is watching says so, at once.
    // A board that nobody has been watching, or that was only away a
    // moment, says nothing (a whole class reconnecting together shouldn't
    // all speak at once).
    rejoined() {
      const t = now();
      const awayFrom = (droppedAt === null ? t : droppedAt) - UNNOTICED_DROP_MS;
      droppedAt = null;
      const mayHaveLost = lastSentAt >= awayFrom && lastSentAt >= lastHeardAt - 2000;
      lastSentAt = -Infinity;
      if (mayHaveLost && !behind) {
        behind = true;
        edition += 1;
      }
      // (if the last word was "I've stopped", nobody is waiting to be told)
      const wentQuiet = !legacy && mode() === "off" && watchSaidAt > leaveSaidAt && t - watchSaidAt < REJOIN_MEMORY_MS;
      if (!mayHaveLost && !wentQuiet) return false;
      hereAt = t;
      return true;
    },
  };
}

// ---------- a viewer of a student's board: saying "I'm watching" ----------
//
// send(event, payload) puts a message on the board's channel.
// edition() gives the edition of the board this viewer is showing (the
// stamp on the last whole board it took), or null if it hasn't one yet.
//
// Several viewers can be on one board at once (a whole class being shown
// it). They can all hear each other, so only one of them needs to keep
// saying "still watching": the others stay quiet for as long as they keep
// hearing somebody say it, and speak up if that somebody leaves.
export function createWatcher(send, { glance = false, edition = null, now = steadyNow, wall = Date.now, random = Math.random, timers = null } = {}) {
  const set = timers ? timers.set : (fn, ms) => setTimeout(fn, ms);
  const clear = timers ? timers.clear : (id) => clearTimeout(id);
  const id = newId();
  let joined = false;
  let visible = true;
  let stopped = false;
  let coveredAt = -Infinity; // when the board last heard, from anyone, what this viewer needs it to
  let coveredWall = -Infinity; // the same by the clock on the wall (the steady clock may stop while a device sleeps)
  let coveredTimes = 0;
  let beatTimer = null;
  let answerTimer = null;
  let answerSince = 0;
  let reportTimer = null;

  const active = () => joined && visible && !stopped;
  // Does somebody else's watching get this viewer what it needs?
  const covers = (other) => !!other && (glance || !other.glance);
  const covered = () => {
    coveredAt = now();
    coveredWall = wall();
    coveredTimes += 1;
  };
  const showing = () => (edition ? edition() : null);
  const me = () => (glance ? { id, glance: true } : { id });

  function beat() {
    if (!active()) return;
    covered();
    const word = me();
    const mine = showing();
    if (mine) word.edition = mine;
    send("board-watch", word);
  }

  function tick() {
    beatTimer = set(tick, WATCH_BEAT_MS);
    if (!active()) return;
    // (whichever clock says longer: one may have stood still while the
    // device slept, the other may have been put back)
    const quietFor = Math.max(now() - coveredAt, wall() - coveredWall);
    if (quietFor >= WATCH_BEAT_MS - BEAT_SLACK_MS) beat();
  }

  // Says "still watching" shortly, unless somebody else says it first (a
  // cover heard before this was called doesn't count: it may be from the
  // very viewer whose leaving prompted this).
  function speakUp(within = ANSWER_WITHIN_MS) {
    if (!active()) return;
    answerSince = coveredTimes;
    if (answerTimer !== null) return;
    answerTimer = set(() => {
      answerTimer = null;
      if (coveredTimes === answerSince) beat();
    }, Math.round(50 + Math.max(0, within - 50) * random()));
  }

  // Says which edition is on screen here shortly, whoever else is
  // watching: this viewer has reason to think it is showing the wrong board
  // (see report() below), and only the board can say.
  function report() {
    if (!active() || reportTimer !== null) return;
    reportTimer = set(() => {
      reportTimer = null;
      beat();
    }, Math.round(50 + (ANSWER_WITHIN_MS - 50) * random()));
  }

  function cancelReport() {
    if (reportTimer !== null) clear(reportTimer);
    reportTimer = null;
  }

  function stopTimers() {
    if (beatTimer !== null) clear(beatTimer);
    if (answerTimer !== null) clear(answerTimer);
    cancelReport();
    beatTimer = null;
    answerTimer = null;
  }

  return {
    id,
    speakUp,
    covers,
    // A whole board went by, for somebody else, from a different page than
    // the one this viewer's board came from (the student has refreshed, and
    // the new page's "I'm here" never arrived). report() tells the board
    // which edition is on screen here, so it can say "ask me again";
    // cancelReport() is for when it says so first.
    report,
    cancelReport,

    // What goes with this viewer's "what's on you?".
    tag() {
      if (!active()) return { v: 2 };
      covered();
      return { v: 2, watch: me() };
    },

    // The connection to the board is up (the caller asks for the board now,
    // which counts as the first "I'm watching").
    connected() {
      if (stopped) return;
      joined = true;
      covered();
      if (beatTimer !== null) clear(beatTimer);
      // Everyone shown a board at the same moment would otherwise all speak
      // at the same moment for ever after.
      beatTimer = set(tick, Math.round(WATCH_BEAT_MS * (0.25 + 0.75 * random())));
    },

    disconnected() {
      joined = false;
    },

    // Another viewer of the same board said something.
    heard(event, payload) {
      if (event === "board-watch" || event === "classroom-state-request") {
        const other = event === "board-watch" ? payload : payload && payload.v === 2 ? payload.watch : null;
        if (covers(other)) covered();
        return;
      }
      // The one who was keeping the board sending may just have left.
      if (event === "board-unwatch" && covers(payload)) speakUp();
    },

    // The page was put in the background, or brought back.
    setVisible(isVisible) {
      if (stopped || visible === !!isVisible) return;
      if (!isVisible) {
        if (active()) send("board-unwatch", me());
        visible = false;
      } else {
        visible = true;
        // (a wall of overview pictures coming back at once don't all speak
        // in the same instant)
        speakUp(glance ? 2000 : 300);
      }
    },

    // Leaving for good.
    stop() {
      if (active()) send("board-unwatch", me());
      stopped = true;
      stopTimers();
    },
  };
}
