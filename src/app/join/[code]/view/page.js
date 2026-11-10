"use client";

import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { BookPlus, Check, Columns2, Hand, MonitorUp, Pause, Rows2, Send } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { readyStudent, liveChannel, teacherTopic, teacherOnlyNow, whenTopicsFree } from "@/lib/liveMode";
import ClassroomBoardViewer from "@/components/ClassroomBoardViewer";
import Whiteboard from "@/components/Whiteboard";
import SplitDivider from "@/components/SplitDivider";
import SignInSheet from "@/components/SignInSheet";
import { contentsFromRows } from "@/lib/boardSync";
import { graphsOf } from "@/lib/graphList";
import { lessonHasWork, stashLesson } from "@/lib/lessonKeep";
import {
  myClassBoard, markCommentsSeen, studentBoardId, NO_COMMENTS, noComments, NO_TEACHER_LAYER, noTeacherLayer,
} from "@/lib/localBoard";
import { NO_CONTROL, readClassState, createQuestionReceiver } from "@/lib/classControl";
import { subscribeClassStatus, getClassStatus, getServerClassStatus, setClassStatus } from "@/lib/classStatus";
import { createAttendance, attendanceHas, attendanceJoin, attendanceLeave, attendanceSync } from "@/lib/classRoster";
import {
  subscribeScreen, getScreen, getServerScreen, splitModeFor,
  subscribeClassLayout, getPrefersBoth, getServerPrefersBoth, setPrefersBoth,
  getClassSplitSide, getClassSplitStacked, getServerClassSplit, setClassSplit, DEFAULT_CLASS_SPLIT,
} from "@/lib/classLayout";
import d from "@/components/Dialog.module.css";
import p from "@/components/Paper.module.css";
import { landingLink } from "@/lib/links";

// This route is where a student lands *after* the join handshake in
// ../page.js resolves (it navigates here with ?board=<id>). It shows two
// things: the teacher's shared board (read-only, ClassroomBoardViewer) and
// this student's own board. They switch between the two with the tabs, or,
// on a screen with room for it, see both at once ("Side by side").
//
// The student's own board is the same board a teacher uses (Whiteboard),
// in its "class board" mode: the full toolbar, minus pictures, simulations
// and reference documents. Students never sign in, so it is kept on their
// own device rather than in the database (src/lib/localBoard.js), which
// also means a refresh brings it back; the teacher watches it over the
// live connection and pins comments on it.
//
// Both boards stay mounted the whole time (the one not showing is only
// hidden), so switching never loses any work or drops the connection.
//
// The bar across the top also carries the student's two signals to the
// teacher, "Raise hand" and "I'm done". They travel with the student's
// place in the class list (see src/lib/classRoster.js), so the teacher
// sees them next to the student's name.
//
// The teacher can also take over what everyone is looking at (see
// src/lib/classControl.js):
//   • "Pens down" pauses every student's own board and brings them to the
//     teacher's board until the teacher lets go.
//   • Showing one student's board to the class puts that board on
//     everyone's screen (the student whose board it is carries on with it).
//   • "Send my board" puts the teacher's question onto every student's own
//     board, as a layer they can write over but not rub out.

// How long the teacher can be missing from the class before the student is
// told. Long enough to cover the teacher refreshing their page or a brief
// drop in their connection.
const TEACHER_AWAY_AFTER_MS = 12000;
const TAB_BAR_HEIGHT = 58; // roughly; only used to keep the saved split sensible

function JoinCodeViewInner() {
  const { code } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const boardId = searchParams.get("board");
  const classCode = String(code).toUpperCase();

  // Who this student is, and their own board for the lesson. It only
  // exists in the browser (there is no student until the page is open), so
  // the first, server-made version of the page goes without it.
  const mine = useSyncExternalStore(neverChanges, () => myClassBoard(code), () => null);
  const studentId = mine ? mine.student.studentId : null;
  const studentName = mine ? mine.student.name : "Student";

  // Hand up / done / has the class ended (see src/lib/classStatus.js).
  const status = useSyncExternalStore(subscribeClassStatus, () => getClassStatus(classCode), getServerClassStatus);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  });

  // The teacher's comments on this student's board, for the badge on the
  // My board tab.
  const commentStore = mine ? mine.backend.comments : NO_COMMENTS;
  const comments = useSyncExternalStore(commentStore.subscribe, commentStore.get, noComments);
  // Which comments have been looked at. Null until a tab is first pressed:
  // until then, "seen" means whatever was already there when the page opened.
  const [seen, setSeen] = useState(null);

  // Room for both boards at once?
  const screen = useSyncExternalStore(subscribeScreen, getScreen, getServerScreen);
  const splitMode = splitModeFor(screen); // "side" | "stacked" | null
  const prefersBoth = useSyncExternalStore(subscribeClassLayout, getPrefersBoth, getServerPrefersBoth);
  const savedSide = useSyncExternalStore(subscribeClassLayout, getClassSplitSide, getServerClassSplit);
  const savedStacked = useSyncExternalStore(subscribeClassLayout, getClassSplitStacked, getServerClassSplit);
  const [dragSplit, setDragSplit] = useState(null);
  const areaRef = useRef(null);

  // After the class has ended: have they chosen to keep looking at their board?
  const [staying, setStaying] = useState(false);
  // "Keep this lesson" (src/lib/lessonKeep.js): the teacher's board as it
  // was when the class ended, and the sign-in sheet.
  const teacherViewRef = useRef(null);
  const lessonTeacherRef = useRef(null);
  const [keepSheet, setKeepSheet] = useState(false);
  const [keepNote, setKeepNote] = useState("");
  const ended = status.ended;
  const afterClass = ended && staying;
  // The teacher has been gone from the class for a while without ending it
  // (they closed their laptop, or lost their connection).
  const [teacherAway, setTeacherAway] = useState(false);

  // What the teacher has switched on for the whole class: { spotlight,
  // pensDown }. None of it holds once the class is over, or while the
  // teacher has dropped out (nobody is left paused by a closed laptop).
  const [control, setControl] = useState(NO_CONTROL);
  const inCharge = !ended && !teacherAway;
  const pensDown = inCharge && control.pensDown;
  const spot = inCharge ? control.spotlight : null;
  const spotIsMe = !!spot && spot.studentId === studentId;
  const watchingSpot = !!spot && !spotIsMe;
  // The question the teacher sent to everyone's board (kept with this
  // student's own board: see src/lib/localBoard.js).
  const teacherStore = mine ? mine.backend.teacher : NO_TEACHER_LAYER;
  const teacherLayer = useSyncExternalStore(teacherStore.subscribe, teacherStore.get, noTeacherLayer);
  // A question has just arrived from the teacher: said for a few seconds
  // (it looks like ordinary writing, so it is worth saying whose it is).
  const [newQuestion, setNewQuestion] = useState(null);
  useEffect(() => {
    if (!newQuestion) return undefined;
    const timer = setTimeout(() => setNewQuestion(null), 7000);
    return () => clearTimeout(timer);
  }, [newQuestion]);

  // "master" | "mine" | "both". Until they choose, it opens the way they
  // last had it (both boards, if there is room), otherwise on the teacher's.
  // Once the class is over there is only their own board to look at.
  const [picked, setPicked] = useState(null);
  const wanted = picked || (prefersBoth ? "both" : "master");
  const layout = wanted === "both" && !splitMode ? (picked ? "mine" : "master") : wanted;
  // Pens down: everyone is on the teacher's board until the teacher lets
  // go, and then back to whatever they had before.
  const view = afterClass ? "mine" : pensDown ? "master" : layout;
  const both = view === "both";
  const tabsLocked = pensDown || watchingSpot;

  const seenIds = seen || (mine ? mine.seenComments : []);
  const unread = view === "master" && !ended ? comments.filter((c) => !seenIds.includes(c.id)).length : 0;

  function choose(next) {
    // Whatever comments are there now have been (or are about to be) seen.
    const ids = comments.map((c) => c.id);
    setSeen(ids);
    // (remembered on the board too, so leaving and joining again in the
    // same tab doesn't count them as new a second time)
    markCommentsSeen(mine, ids);
    setPicked(next);
    setPrefersBoth(next === "both");
  }

  // Before connecting: signed in (invisibly) and let into the class (see
  // src/lib/liveMode.js). null while that is happening; "ok", or why not.
  const [access, setAccess] = useState(null);
  const [accessTry, setAccessTry] = useState(0);
  useEffect(() => {
    if (!code || !studentId) return undefined;
    let cancelled = false;
    readyStudent(classCode, studentId, studentName).then((r) => {
      if (cancelled) return;
      if (r.status === "ended") setClassStatus(classCode, { ended: true, hand: false, handAt: 0 });
      if (r.status === "not_found") {
        router.replace(`/join/${code}`);
        return;
      }
      setAccess(r.ok || r.status === "ended" ? "ok" : "error");
    });
    return () => {
      cancelled = true;
    };
  }, [code, classCode, studentId, studentName, accessTry, router]);

  // Guards against someone landing on /view directly without a board
  // id (e.g. a bookmarked/typed URL) — bounce back to the join screen
  // so the handshake can run and supply one.
  useEffect(() => {
    if (!boardId) {
      router.replace(`/join/${code}`);
    }
  }, [boardId, code, router]);

  // Stay present on the classroom's roster channel for the whole time
  // this student is in class — the join handshake page only tracks
  // presence up until the moment it navigates here, but the teacher's
  // in-class roster (for opening a student's board) needs it kept
  // alive for as long as the student is actually watching. The same
  // channel carries what the teacher sends to the whole class: "the class
  // has ended", "put that hand down" and "clear everyone's hands and ticks".
  const roomRef = useRef(null);
  useEffect(() => {
    if (!code || !studentId || ended || access !== "ok") return;
    const startRoom = () => {
      const joinedAt = Date.now();
      const channel = liveChannel(`classroom-${classCode}`, { presence: { key: studentId } });
      // What the teacher says to the whole class comes on their own channel,
      // which only the teacher can send on (before the November security
      // update, on the class channel too).
      const teacherChannel = liveChannel(teacherTopic(classCode), {});
      const fromTeacher = teacherOnlyNow() ? [teacherChannel] : [teacherChannel, channel];
      const onTeacher = (event, fn) => fromTeacher.forEach((ch) => ch.on("broadcast", { event }, fn));
      const room = { joined: false, tell: null, send: (event, payload) => channel.send({ type: "broadcast", event, payload }) };

      // Is the teacher here? Worked out from the "joined" and "left" events
      // (see src/lib/classRoster.js for why not from the library's own list).
      const attendance = createAttendance();
      let awayTimer = null;
      let closed = false; // this connection has been put away
      const checkTeacher = () => {
        if (closed) return;
        if (attendanceHas(attendance, "teacher")) {
          clearTimeout(awayTimer);
          awayTimer = null;
          setTeacherAway(false);
        } else if (!awayTimer) {
          awayTimer = setTimeout(() => setTeacherAway(true), TEACHER_AWAY_AFTER_MS);
        }
      };
      channel.on("presence", { event: "join" }, ({ key, newPresences, currentPresences }) => {
        attendanceJoin(attendance, key, newPresences, currentPresences);
        checkTeacher();
      });
      channel.on("presence", { event: "leave" }, ({ key, leftPresences, currentPresences }) => {
        attendanceLeave(attendance, key, leftPresences, currentPresences);
        checkTeacher();
      });
      channel.on("presence", { event: "sync" }, () => {
        attendanceSync(attendance, channel.presenceState());
        checkTeacher();
      });
      // Tells the teacher whether this student's hand is up / they're done.
      // (Sent as its own message rather than as part of the "I'm here"
      // announcement: see src/lib/classRoster.js for why.)
      room.tell = () => {
        const now = statusRef.current;
        return channel.send({
          type: "broadcast",
          event: "student-status",
          payload: { studentId, hand: now.hand, handAt: now.handAt, done: now.done },
        });
      };
      onTeacher("class-ended", () => {
        // (the teacher's board is put away now: what was on it is kept, for
        // "Keep this lesson")
        const view = teacherViewRef.current;
        if (view && view.contents) lessonTeacherRef.current = view.contents();
        setClassStatus(classCode, { ended: true, hand: false, handAt: 0 });
        setControl(NO_CONTROL);
      });

      // The question the teacher sends to everyone's board arrives in pieces.
      const receiver = createQuestionReceiver((question) => {
        const had = teacherStore.get().question;
        teacherStore.setQuestion(question);
        if (!had || had.id !== question.id) setNewQuestion(question.id);
      });
      onTeacher("class-question", ({ payload }) => receiver.header(payload));
      onTeacher("class-question-piece", ({ payload }) => receiver.piece(payload));
      onTeacher("class-question-done", ({ payload }) => receiver.done(payload));
      // If the class has a question this board doesn't (it joined after the
      // question went out, or a piece got lost on the way), ask for it: a
      // moment later, in case it is arriving right now, then a few more times.
      let wantTimer = null;
      const wantQuestion = (id) => {
        clearTimeout(wantTimer);
        let tries = 0;
        const check = () => {
          wantTimer = null;
          const have = teacherStore.get().question;
          if (closed || (have && have.id === id)) return;
          channel.send({ type: "broadcast", event: "class-question-request", payload: { id } });
          tries += 1;
          if (tries < 5) wantTimer = setTimeout(check, 4000);
        };
        wantTimer = setTimeout(check, 1200);
      };
      // What the teacher has switched on for the class (sent whenever it
      // changes, and whenever a page asks).
      onTeacher("class-state", ({ payload }) => {
        const state = readClassState(payload);
        setControl({ spotlight: state.spotlight, pensDown: state.pensDown });
        if (!state.question) {
          clearTimeout(wantTimer);
          wantTimer = null;
          // (and anything still on its way is dropped: it has been taken back)
          receiver.reset();
          teacherStore.setQuestion(null);
        } else {
          const have = teacherStore.get().question;
          if (!have || have.id !== state.question) wantQuestion(state.question);
        }
      });
      onTeacher("hand-lower", ({ payload }) => {
        if (payload && payload.studentId === studentId) setClassStatus(classCode, { hand: false, handAt: 0 });
      });
      onTeacher("status-reset", () => {
        setClassStatus(classCode, { hand: false, handAt: 0, done: false });
      });
      // The teacher's board has just (re)opened, or reconnected, and wants to
      // know where everyone stands. Always answered, even with "nothing":
      // a hand that came down while the teacher was offline has to be cleared
      // on their side too.
      onTeacher("status-request", () => {
        room.tell();
      });
      // "What is switched on?" (pens down, a board being shown, a question),
      // once both channels are up, so the answer isn't missed.
      let roomUp = false;
      let teacherUp = false;
      const askState = () => {
        if (roomUp && teacherUp && !closed) channel.send({ type: "broadcast", event: "class-state-request", payload: {} });
      };
      teacherChannel.subscribe((state) => {
        if (state === "SUBSCRIBED") {
          teacherUp = true;
          askState();
        }
      });
      channel.subscribe(async (state) => {
        if (state === "SUBSCRIBED") {
          room.joined = true;
          await channel.track({ studentId, name: studentName, joinedAt });
          if (closed) return;
          room.tell();
          checkTeacher();
          roomUp = true;
          askState();
        }
      });
      roomRef.current = room;

      return () => {
        roomRef.current = null;
        closed = true;
        clearTimeout(awayTimer);
        clearTimeout(wantTimer);
        supabase.removeChannel(channel);
        supabase.removeChannel(teacherChannel);
      };
    };

    // The waiting page had these channels open a moment ago. They're only
    // started here once that page has let go of them (otherwise the
    // library hands back the old ones, which are on their way out).
    let gone = false;
    let stop = null;
    whenTopicsFree([`classroom-${classCode}`, teacherTopic(classCode)]).then(() => {
      if (!gone) stop = startRoom();
    });
    return () => {
      gone = true;
      if (stop) stop();
    };
  }, [code, classCode, studentId, studentName, ended, teacherStore, access]);

  // A hand going up or down, or "I'm done": tell the class straight away.
  useEffect(() => {
    const room = roomRef.current;
    if (room && room.joined) room.tell();
  }, [status.hand, status.done]);

  // The lesson as it stands: the teacher's board (as it was when the class
  // ended) and this student's own, with what the teacher put on it.
  function lessonNow() {
    const t = lessonTeacherRef.current || (teacherViewRef.current && teacherViewRef.current.contents ? teacherViewRef.current.contents() : null);
    const teacher = t ? { strokes: t.strokes || [], texts: t.texts || [], images: t.images || [], graphs: graphsOf(t.grid) } : null;
    let own = null;
    if (mine && mine.backend && mine.backend.snapshot) {
      const snap = mine.backend.snapshot();
      const rows = contentsFromRows({ strokes: snap.strokes, texts: snap.texts });
      const layer = (snap.teacher && typeof snap.teacher === "object" ? snap.teacher : {}) || {};
      const q = layer.question || null;
      own = {
        strokes: [...(q ? q.strokes || [] : []), ...(Array.isArray(layer.ink) ? layer.ink : []), ...rows.strokes],
        texts: [...(q ? q.texts || [] : []), ...rows.texts],
        images: q ? q.images || [] : [],
        graphs: [...(q ? graphsOf(q.grid) : []), ...graphsOf(snap.board && snap.board.grid_config)],
      };
    }
    return { name: (t && t.name) || "", background: t ? t.background : "blank", teacher, mine: own };
  }

  // "Keep this lesson": a copy kept on this device, then signing in (once
  // signed in, the home page makes it into a notebook: LessonCarryOver.js).
  async function keepLesson() {
    const lesson = lessonNow();
    if (!lessonHasWork({ teacher: lesson.teacher, mine: lesson.mine })) {
      setKeepNote("There's nothing on the boards to keep.");
      return;
    }
    if (!stashLesson({ ...lesson, classCode })) {
      setKeepNote("This device couldn't keep a copy (its storage is full or switched off).");
      return;
    }
    // already signed in with an account of their own: straight there
    const u = await signedInUser();
    if (u && !u.is_anonymous) {
      window.location.assign("/");
      return;
    }
    setKeepSheet(true);
  }

  // Leaving the class: the hand comes down and "done" is cleared, so
  // neither is still set if they join the same class again.
  function leave() {
    setClassStatus(classCode, { hand: false, handAt: 0, done: false });
    router.push("/join");
  }

  if (access === "error") {
    return (
      <div className={p.screen}>
        <div className={`${p.sticky} ${p.stickyPink}`} role="alert">
          <h1 className={p.stickyTitle}>Couldn&apos;t connect to the class</h1>
          <p className={p.stickyText}>Check your connection, then try again.</p>
          <button
            type="button"
            className={`${d.btn} ${d.btnPrimary}`}
            onClick={() => {
              setAccess(null);
              setAccessTry((n) => n + 1);
            }}
            style={{ marginTop: 6 }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!boardId || access === null) {
    return (
      <div className={p.screen}>
        <div className={p.sticky} role="status">
          <h1 className={p.stickyTitle}>Opening the lesson…</h1>
          <span className={p.dots} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </div>
      </div>
    );
  }

  // ---------- both boards at once: how the space is shared ----------
  const [screenWidth, screenHeight] = String(screen).split("x").map((n) => Number(n) || 0);

  // Neither board is allowed to get too small to use.
  function clampSplit(value, total) {
    const minTeacher = splitMode === "stacked" ? 170 : 260;
    const minMine = (splitMode === "stacked" ? 330 : 400) + 14; // + the divider
    if (!total) return Math.min(0.7, Math.max(0.25, value));
    const lo = minTeacher / total;
    const hi = Math.max(lo, (total - minMine) / total);
    return Math.min(hi, Math.max(lo, value));
  }

  // The share saved last time may have been chosen on a bigger window (or
  // with the tablet the other way up), so it is fitted to this one.
  const roomNow = splitMode === "stacked" ? Math.max(0, screenHeight - TAB_BAR_HEIGHT) : screenWidth;
  const fraction = dragSplit ?? clampSplit(splitMode === "stacked" ? savedStacked : savedSide, roomNow);

  // Beside the teacher's board, the student's own board may be too narrow
  // for its toolbar at full size: it then packs itself tighter.
  const tightForTools = both && splitMode === "side" && screenWidth * (1 - fraction) < 800;

  function paneStyle(which) {
    if (both) {
      return which === "master"
        ? { position: "relative", flex: `0 0 ${(fraction * 100).toFixed(2)}%`, minWidth: 0, minHeight: 0 }
        : { position: "relative", flex: "1 1 0", minWidth: 0, minHeight: 0 };
    }
    // One at a time: the board that isn't showing is hidden rather than
    // removed. It keeps its size (so nothing has to be laid out again when
    // it comes back) but can't be seen, tapped or reached with the keyboard.
    const showing = view === which;
    return {
      position: "absolute",
      inset: 0,
      visibility: showing ? "visible" : "hidden",
      pointerEvents: showing ? "auto" : "none",
      zIndex: showing ? 1 : 0,
    };
  }

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <div className={p.tabBar}>
        <span className={p.tabBrand} aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 17c3-6 6-9 8-9s1 6 3 6 3-3 5-5" />
          </svg>
        </span>
        {afterClass ? (
          <>
            <span className={p.tabTitle}>My board</span>
            <span className={p.tabNote} style={{ marginLeft: 0 }}>class ended</span>
            <span className={p.tabSpacer} />
            <button type="button" className={`${p.tab} ${p.tabOn}`} onClick={keepLesson} data-keep-lesson="bar">
              <BookPlus size={16} aria-hidden="true" /> Keep this lesson
            </button>
            <button type="button" className={p.tab} onClick={leave}>
              Leave
            </button>
          </>
        ) : (
          <>
            <div className={p.tabs} role="tablist" aria-label="Boards">
              <button type="button" role="tab" aria-selected={view === "master"} disabled={tabsLocked} className={`${p.tab} ${view === "master" ? p.tabOn : ""}`} onClick={() => choose("master")}>
                Teacher&apos;s board
              </button>
              <button type="button" role="tab" aria-selected={view === "mine"} disabled={tabsLocked} className={`${p.tab} ${view === "mine" ? p.tabOn : ""}`} onClick={() => choose("mine")}>
                My board
                {unread > 0 && (
                  <span className={p.tabBadge}>
                    <span aria-hidden="true">{unread}</span>
                    <span className={p.srOnly}>{`, ${unread} new comment${unread === 1 ? "" : "s"} from your teacher`}</span>
                  </span>
                )}
              </button>
              {splitMode && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={both}
                  disabled={tabsLocked}
                  aria-label={splitMode === "side" ? "Side by side" : "Both boards"}
                  title="See your teacher's board and your own at the same time"
                  className={`${p.tab} ${p.tabIcon} ${both ? p.tabOn : ""}`}
                  onClick={() => choose("both")}
                >
                  {splitMode === "side" ? <Columns2 size={17} strokeWidth={2} /> : <Rows2 size={17} strokeWidth={2} />}
                  <span className={p.tabLong}>{splitMode === "side" ? "Side by side" : "Both boards"}</span>
                </button>
              )}
            </div>
            <span className={p.tabSpacer} />
            <button
              type="button"
              aria-pressed={status.hand}
              aria-label={status.hand ? "Hand up. Press to put it down" : "Raise hand"}
              title={status.hand ? "Your teacher can see your hand is up. Press to put it down." : "Let your teacher know you need help"}
              className={`${p.signal} ${status.hand ? p.signalHand : ""}`}
              onClick={() => setClassStatus(classCode, status.hand ? { hand: false, handAt: 0 } : { hand: true, handAt: Date.now() })}
            >
              <Hand size={17} strokeWidth={2} />
              <span className={p.signalLabel}>{status.hand ? "Hand up" : "Raise hand"}</span>
            </button>
            <button
              type="button"
              aria-pressed={status.done}
              aria-label={status.done ? "Marked as done. Press to undo" : "I'm done"}
              title={status.done ? "Your teacher can see you're done. Press to undo." : "Let your teacher know you've finished"}
              className={`${p.signal} ${status.done ? p.signalDone : ""}`}
              onClick={() => setClassStatus(classCode, { done: !status.done })}
            >
              <Check size={17} strokeWidth={2.6} />
              <span className={p.signalLabel}>{status.done ? "Done" : "I'm done"}</span>
            </button>
            <span className={p.tabNote}>class {classCode}</span>
          </>
        )}
      </div>

      {teacherAway && !ended && (
        <div className={p.awayBar} role="status">
          <span className={p.awayText}>
            Your teacher isn&apos;t connected right now. They may be back in a moment, and your board is still here.
          </span>
          <button type="button" className={p.awayBtn} onClick={leave}>
            Leave
          </button>
        </div>
      )}

      {/* What the teacher has switched on for everyone. */}
      {watchingSpot && (
        <div className={`${p.classBar} ${p.classBarShow}`} role="status">
          <MonitorUp size={17} aria-hidden="true" />
          <span className={p.awayText}>
            {spot.name ? `Your teacher is showing ${spot.name}'s board to the class.` : "Your teacher is showing a classmate's board to the class."}
          </span>
        </div>
      )}
      {pensDown && !watchingSpot && (
        <div className={`${p.classBar} ${p.classBarPens}`} role="status">
          <Pause size={17} aria-hidden="true" />
          <span className={p.awayText}>Pens down. Your teacher has paused everyone&apos;s boards for a moment: eyes on theirs.</span>
        </div>
      )}

      <div
        ref={areaRef}
        inert={ended && !staying}
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          display: both ? "flex" : "block",
          flexDirection: splitMode === "stacked" ? "column" : "row",
        }}
      >
        {/* Once the class has ended the teacher's board is disconnected. */}
        <div style={paneStyle("master")} inert={watchingSpot || (!both && view !== "master")}>
          {!ended && (
            <ClassroomBoardViewer
              ref={teacherViewRef}
              boardId={boardId}
              onLeave={leave}
              askThrough={() => roomRef.current?.send("master-state-request", {})}
            />
          )}
        </div>
        {both && (
          <SplitDivider
            orientation={splitMode === "stacked" ? "horizontal" : "vertical"}
            label="Resize the two boards — drag, or double-tap to reset"
            containerRef={areaRef}
            valueNow={fraction}
            onDrag={(value, total) => setDragSplit(clampSplit(value, total))}
            onDragEnd={(value, total) => {
              setClassSplit(splitMode, clampSplit(value, total));
              setDragSplit(null);
            }}
            onReset={() => {
              setDragSplit(null);
              setClassSplit(splitMode, DEFAULT_CLASS_SPLIT);
            }}
          />
        )}
        <div style={paneStyle("mine")} inert={watchingSpot || (!both && view !== "mine")}>
          {mine && (
            <Whiteboard
              boardId={mine.boardId}
              student={mine.student}
              backend={mine.backend}
              active={view !== "master" && !watchingSpot}
              compact={tightForTools}
            />
          )}
        </div>
        {/* Notes for a student who may be in the middle of writing: they
            float over the foot of the boards (nothing moves to make room
            for them) and a pen goes straight through them. */}
        {spotIsMe && (
          <div className={p.classToast} role="status">
            <MonitorUp size={16} aria-hidden="true" />
            <span>
              {spot.name
                ? "Your teacher is showing your board to the class."
                : "Your teacher is showing your board to the class, without your name."}
            </span>
          </div>
        )}
        {!spotIsMe && !watchingSpot && newQuestion && teacherLayer.question && teacherLayer.question.id === newQuestion && inCharge && (
          <div className={p.classToast} role="status">
            <Send size={16} aria-hidden="true" />
            <span>Your teacher has put their board onto yours. You can write over it.</span>
          </div>
        )}
        {/* A classmate's board the teacher is showing to everyone, over
            the top of both boards (which stay as they are underneath). */}
        {watchingSpot && (
          <div className={p.spotPane}>
            <ClassroomBoardViewer
              key={spot.studentId}
              boardId={studentBoardId(classCode, spot.studentId)}
              embedded
              fitOnLoad
              question={teacherLayer.question}
              waitingText="Waiting for the board…"
              askThrough={() => roomRef.current?.send("spot-state-request", { studentId: spot.studentId })}
            />
          </div>
        )}
      </div>

      {ended && !staying && !keepSheet && (
        <div className={p.endedOverlay}>
          <div className={p.sticky} role="alertdialog" aria-labelledby="class-ended-title" aria-describedby="class-ended-text">
            <h1 className={p.stickyTitle} id="class-ended-title">This class has ended</h1>
            <p className={p.stickyText} id="class-ended-text">
              Your teacher has finished the lesson. Keep it in a notebook of your own to revise from, or look at your board.
            </p>
            <button type="button" className={`${d.btn} ${d.btnPrimary}`} onClick={keepLesson} autoFocus data-keep-lesson="ended">
              <BookPlus size={17} aria-hidden="true" /> Keep this lesson
            </button>
            {keepNote && (
              <p className={p.stickyText} role="alert" style={{ marginTop: 8 }}>
                {keepNote}
              </p>
            )}
            <div className={p.endedButtons}>
              <button type="button" className={d.btn} onClick={() => setStaying(true)}>
                Look at my board
              </button>
              <button type="button" className={d.btn} onClick={leave}>
                Leave
              </button>
            </div>
            <a href={landingLink("student-ended")} target="_blank" rel="noopener" className={p.madeWith}>
              Made with Clean Slate, free for teachers and tutors
            </a>
          </div>
        </div>
      )}
      {keepNote && afterClass && (
        <div className={p.classToast} role="alert">
          <span>{keepNote}</span>
        </div>
      )}
      {keepSheet && <SignInSheet trigger="lesson" onKeep={() => true} onClose={() => setKeepSheet(false)} />}
    </div>
  );
}

// Who's signed in on this device (null if nobody, or it can't be told).
async function signedInUser() {
  try {
    const { data } = await supabase.auth.getSession();
    return data && data.session ? data.session.user : null;
  } catch (err) {
    return null;
  }
}

// The student's board never changes once made, so there is nothing to
// listen for.
function neverChanges() {
  return () => {};
}

export default function JoinCodeViewPage() {
  return (
    <Suspense fallback={null}>
      <JoinCodeViewInner />
    </Suspense>
  );
}
