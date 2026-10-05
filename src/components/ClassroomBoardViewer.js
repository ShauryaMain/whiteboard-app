"use client";

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import ReferencePane from "./ReferencePane";
import { applyBackground, normalizeBackground } from "@/lib/boardBackground";
import { translateStroke, translateText, translateImage, unionBounds, newId } from "@/lib/boardObjects";
import {
  drawInkStroke as drawStroke, drawTextBoxes as drawTexts, drawGraph, drawTeacherLayer, hasTeacherLayer, contentBoxes,
} from "@/lib/boardRender";
import { getPencilOnly } from "@/lib/pencilPrefs";
import cls from "./Classroom.module.css";

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const STATE_REQUEST_RETRY_MS = 3000;
const TAP_SLOP_PX = 8; // a press that moves less than this is a tap, not a drag
const FIT_MARGIN_PX = 36;
// A line the teacher writes on a student's board is sent whole when it is
// finished (as well as live, as it is drawn). So that it always fits in one
// live message, a very long line is quietly carried on as a new one.
const INK_MAX_POINTS = 1500;
// A line that was being written but never finished (its last message was
// lost) is dropped after this long without news.
const LIVE_INK_EXPIRES_MS = 20000;

// Positions to a hundredth of a board unit: plenty, and half the size to send.
function trim(value) {
  return Math.round(value * 100) / 100;
}

function distance(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

// Adds (or replaces) things in a list, matched by id.
function mergeById(prev, added) {
  const ids = new Set(added.map((o) => o.id));
  return [...prev.filter((o) => !ids.has(o.id)), ...added];
}

// Numbered markers (the teacher's comments on a student's board). Drawn
// the same size on screen whatever the zoom.
function drawPins(ctx, pins, scale) {
  pins.forEach((pin, index) => {
    const r = 13 / scale;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(pin.x, pin.y, r, 0, Math.PI * 2);
    ctx.fillStyle = pin.draft ? "#FFE082" : "#FFB300";
    ctx.fill();
    ctx.lineWidth = 2 / scale;
    ctx.strokeStyle = "#1B1D24";
    ctx.stroke();
    ctx.fillStyle = "#1B1D24";
    ctx.font = `bold ${12 / scale}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(index + 1), pin.x, pin.y + 1 / scale);
    ctx.restore();
  });
}

// A live view of a board, for someone with no database access.
//
// Its uses:
//   • a student watching the teacher's board (the default),
//   • the teacher looking at one student's board (TeacherStudentBoardView
//     passes `embedded` and the extras below),
//   • the small previews in the teacher's class overview (ClassOverview),
//   • a student watching a classmate's board the teacher is showing to
//     everyone.
//
// Extras, all optional:
//   embedded     sits inside another screen: fills its box, no Leave button
//   waitingText  what the pill says while the board hasn't answered yet
//   pins         [{ id, x, y, draft? }] numbered markers, in board coordinates
//   onBoardTap   (boardPoint, screenPoint, paneSize) a tap that wasn't a drag
//   onSnapshot   (payload) the board's answer to "what's on you?" arrived
//   fitOnLoad    once loaded, zoom out if needed so nothing is off screen
//   tour         a data-tour name for the board area (see src/lib/tours.js)
//   question     what the teacher sent to every student's board ({ strokes,
//                texts, images, grid }): drawn here as well when this is a
//                view of a student's board (everyone in the class has their
//                own copy of it, so it isn't sent again with each board)
//   drawTool     { color, width }: dragging on the board writes on it, as
//                the teacher (the student sees it, and can't rub it out).
//                Two fingers still move and zoom.
//   onInkChange  ({ total, mine }) how much teacher's writing is on the
//                board, and how much of it was written in this view
//   interactive  false for a picture that can't be moved or tapped
//   autoFit      keep everything in view as the board changes (previews)
//   fitMargin    px kept clear around the work when fitting
//   withComments ask the board for the teacher's comments on it as well
//                (only the teacher's own view of a student's board does)
//   ref          gets { send(event, payload), fitAll(), undoInk(), clearInk() }
export default function ClassroomBoardViewer({
  boardId, embedded = false, waitingText, pins, onBoardTap, onSnapshot, onLeave, fitOnLoad = false, tour, ref, children,
  question = null, drawTool = null, onInkChange, interactive = true, autoFit = false, fitMargin = FIT_MARGIN_PX,
  withComments = false,
}) {
  const router = useRouter();
  const canvasRef = useRef(null);
  const boardPaneRef = useRef(null);
  const ctxRef = useRef(null);
  const panRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const channelRef = useRef(null);
  const remoteStrokes = useRef({});
  const strokesRef = useRef([]);
  const textsRef = useRef([]);
  const gridConfigRef = useRef(null);
  const backgroundRef = useRef("blank");
  const backgroundCssKeyRef = useRef("");
  const pageBgRef = useRef(null);
  const touchPoints = useRef(new Map());
  const panZoomState = useRef(null);
  const panDragActive = useRef(false);
  const panDragStart = useRef(null);
  const hasReceivedSnapshot = useRef(false);
  // While a big board is arriving in pieces: which snapshot, and what has
  // come so far (see the snapshot handlers below).
  const collectingRef = useRef(null);
  const joinedOnceRef = useRef(false);
  const pendingFitRef = useRef(false);
  const tapRef = useRef(null);
  const pinsRef = useRef(pins || []);
  const onBoardTapRef = useRef(onBoardTap);
  const onSnapshotRef = useRef(onSnapshot);
  const fitOnLoadRef = useRef(fitOnLoad);
  // The teacher's layer (see drawTeacherLayer): it has a canvas of its own,
  // on top of the board's ink.
  const teacherCanvasRef = useRef(null);
  const teacherCtxRef = useRef(null);
  const teacherInkRef = useRef([]);
  const teacherLiveRef = useRef({}); // lines someone else is writing right now, by key
  const questionRef = useRef(question);
  const questionImageNodesRef = useRef({});
  const drawToolRef = useRef(drawTool);
  const onInkChangeRef = useRef(onInkChange);
  const interactiveRef = useRef(interactive);
  const autoFitRef = useRef(autoFit);
  const fitMarginRef = useRef(fitMargin);
  // Writing in this view: the line being drawn, the ids of the lines drawn
  // here (newest last, for Undo), and points waiting to be sent.
  const myStrokeRef = useRef(null);
  const myInkStackRef = useRef([]);
  const pendingInkRef = useRef([]);
  const inkFrameRef = useRef(null);
  const liveExpiryRef = useRef(null);
  const withCommentsRef = useRef(withComments);

  const [strokes, setStrokes] = useState([]);
  const [teacherInk, setTeacherInk] = useState([]);
  const [texts, setTexts] = useState([]);
  const [images, setImages] = useState([]);
  const imagesRef = useRef([]);
  const imageNodesRef = useRef({});
  const [connectionStatus, setConnectionStatus] = useState("connecting"); // connecting | live | waiting
  const [referenceDoc, setReferenceDoc] = useState(null);
  const [referenceStrokes, setReferenceStrokes] = useState([]);

  useEffect(() => { strokesRef.current = strokes; }, [strokes]);
  useEffect(() => { textsRef.current = texts; }, [texts]);
  useEffect(() => { imagesRef.current = images; }, [images]);
  useEffect(() => {
    onBoardTapRef.current = onBoardTap;
    onSnapshotRef.current = onSnapshot;
    fitOnLoadRef.current = fitOnLoad;
    drawToolRef.current = drawTool;
    onInkChangeRef.current = onInkChange;
    interactiveRef.current = interactive;
    autoFitRef.current = autoFit;
    fitMarginRef.current = fitMargin;
    withCommentsRef.current = withComments;
  });

  function getPaneSize() {
    const el = boardPaneRef.current;
    if (!el) return { width: window.innerWidth, height: window.innerHeight };
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  function screenToWorld(p) {
    return {
      x: (p.x - panRef.current.x) / scaleRef.current,
      y: (p.y - panRef.current.y) / scaleRef.current,
    };
  }

  function repositionImages() {
    const scale = scaleRef.current;
    const pan = panRef.current;
    const place = (img, el) => {
      if (!el) return;
      el.style.left = img.x * scale + pan.x + "px";
      el.style.top = img.y * scale + pan.y + "px";
      el.style.width = img.width * scale + "px";
      el.style.height = img.height * scale + "px";
    };
    for (const img of imagesRef.current) place(img, imageNodesRef.current[img.id]);
    const q = questionRef.current;
    for (const img of (q && q.images) || []) place(img, questionImageNodesRef.current[img.id]);
  }

  // The teacher's layer and the comment pins, on their own canvas.
  function drawTeacherOverlay() {
    const canvas = teacherCanvasRef.current;
    const tctx = teacherCtxRef.current;
    if (!canvas || !tctx) return;
    const ratio = window.devicePixelRatio || 1;
    const scale = scaleRef.current;
    const pan = panRef.current;
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.clearRect(0, 0, canvas.width, canvas.height);
    tctx.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * pan.x, ratio * pan.y);
    const layer = { question: questionRef.current, ink: teacherInkRef.current, live: teacherLiveRef.current };
    if (hasTeacherLayer(layer)) drawTeacherLayer(tctx, layer, scale);
    if (myStrokeRef.current) drawStroke(tctx, myStrokeRef.current.stroke);
    if (pinsRef.current.length) drawPins(tctx, pinsRef.current, scale);
  }

  function fullRedraw() {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const scale = scaleRef.current;
    const pan = panRef.current;

    ctx.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * pan.x, ratio * pan.y);
    const { width: paneW, height: paneH } = getPaneSize();
    ctx.clearRect(-pan.x / scale, -pan.y / scale, paneW / scale, paneH / scale);

    for (const stroke of strokesRef.current) drawStroke(ctx, stroke);
    for (const key in remoteStrokes.current) drawStroke(ctx, remoteStrokes.current[key]);
    drawTexts(ctx, textsRef.current);
    drawGraph(ctx, gridConfigRef.current, scale);
    drawTeacherOverlay();
    applyBackground(pageBgRef.current, backgroundRef.current, scale, pan, backgroundCssKeyRef);
    repositionImages();
  }

  useEffect(() => {
    pinsRef.current = pins || [];
    fullRedraw();
  }, [pins]);

  // The box around everything on the board (null if it's empty).
  function contentBounds() {
    const ctx = ctxRef.current;
    const boxes = contentBoxes(ctx, {
      strokes: strokesRef.current, texts: textsRef.current, images: imagesRef.current, grid: gridConfigRef.current,
    });
    if (questionRef.current) boxes.push(...contentBoxes(ctx, questionRef.current));
    boxes.push(...contentBoxes(ctx, { strokes: teacherInkRef.current }));
    for (const pin of pinsRef.current) boxes.push({ minX: pin.x - 14, minY: pin.y - 14, maxX: pin.x + 14, maxY: pin.y + 14 });
    return unionBounds(boxes);
  }

  // Brings the whole board into view: zooms out as far as needed (never in
  // past 100%) and centres it. With onlyIfNeeded, leaves the view alone
  // when everything can already be seen.
  function fitAll({ onlyIfNeeded = false } = {}) {
    const box = contentBounds();
    const { width, height } = getPaneSize();
    if (!box || width < 80 || height < 80) return;
    if (onlyIfNeeded) {
      const scale = scaleRef.current;
      const pan = panRef.current;
      const seen =
        box.minX * scale + pan.x >= 0 && box.minY * scale + pan.y >= 0 &&
        box.maxX * scale + pan.x <= width && box.maxY * scale + pan.y <= height;
      if (seen) return;
    }
    const boxW = Math.max(1, box.maxX - box.minX);
    const boxH = Math.max(1, box.maxY - box.minY);
    const margin = fitMarginRef.current;
    const scale = Math.max(
      MIN_SCALE,
      Math.min(1, (width - margin * 2) / boxW, (height - margin * 2) / boxH)
    );
    scaleRef.current = scale;
    panRef.current = {
      x: (width - boxW * scale) / 2 - box.minX * scale,
      y: (height - boxH * scale) / 2 - box.minY * scale,
    };
    fullRedraw();
  }

  useImperativeHandle(ref, () => ({
    // Sends a message on this board's live channel (the teacher's comments
    // on a student's board go this way).
    send(event, payload) {
      return channelRef.current?.send({ type: "broadcast", event, payload });
    },
    fitAll() {
      fitAll();
    },
    // Takes back the last line written in this view. False if there is none.
    undoInk() {
      const stack = myInkStackRef.current;
      let id = null;
      while (stack.length && id === null) {
        const top = stack.pop();
        if (teacherInkRef.current.some((s) => s.id === top)) id = top;
      }
      if (id === null) return false;
      setTeacherInk((prev) => prev.filter((s) => s.id !== id));
      channelRef.current?.send({ type: "broadcast", event: "teacher-ink-remove", payload: { ids: [id] } });
      return true;
    },
    // Takes all of the teacher's writing off this board.
    clearInk() {
      myInkStackRef.current = [];
      teacherLiveRef.current = {};
      setTeacherInk([]);
      channelRef.current?.send({ type: "broadcast", event: "teacher-ink-clear", payload: {} });
    },
  }));

  // ---------- writing on the board, as the teacher ----------

  function flushInk() {
    inkFrameRef.current = null;
    const mine = myStrokeRef.current;
    const points = pendingInkRef.current;
    pendingInkRef.current = [];
    if (!mine || !points.length) return;
    channelRef.current?.send({ type: "broadcast", event: "teacher-ink-points", payload: { strokeKey: mine.key, points } });
  }

  // at: where, in board coordinates
  function startInk(pointerId, at, pointerType) {
    const pen = drawToolRef.current || { color: "#E53935", width: 4 };
    const id = newId();
    const stroke = { id, tool: "pen", color: pen.color, width: pen.width, opacity: 1, points: [at] };
    myStrokeRef.current = { pointerId, pointerType, key: `teacher-${id}`, stroke };
    pendingInkRef.current = [];
    channelRef.current?.send({
      type: "broadcast",
      event: "teacher-ink-start",
      payload: { strokeKey: `teacher-${id}`, strokeId: id, color: pen.color, width: pen.width, point: at },
    });
  }

  // keep: false when the line turned out to be the start of a pinch
  function endInk(keep) {
    const mine = myStrokeRef.current;
    if (!mine) return;
    if (inkFrameRef.current !== null) cancelAnimationFrame(inkFrameRef.current);
    flushInk();
    myStrokeRef.current = null;
    const send = (event, payload) => channelRef.current?.send({ type: "broadcast", event, payload });
    if (!keep) {
      send("teacher-ink-cancel", { strokeKey: mine.key });
      drawTeacherOverlay();
      return;
    }
    const stroke = mine.stroke;
    // a tap leaves a dot
    if (stroke.points.length === 1) stroke.points.push({ x: stroke.points[0].x + 0.01, y: stroke.points[0].y + 0.01 });
    myInkStackRef.current.push(stroke.id);
    // (written while a re-sent board was still arriving in pieces: it is
    // newer than the pieces, so it isn't pruned when they finish)
    if (collectingRef.current) collectingRef.current.teacherInk.add(stroke.id);
    // (the ref too, so the line doesn't blink out before the next render)
    teacherInkRef.current = [...teacherInkRef.current, stroke];
    setTeacherInk((prev) => (prev.some((x) => x.id === stroke.id) ? prev : [...prev, stroke]));
    send("teacher-ink-end", { strokeKey: mine.key, stroke });
    drawTeacherOverlay();
  }

  function moveInk(pos) {
    const mine = myStrokeRef.current;
    if (!mine) return;
    const world = screenToWorld(pos);
    const at = { x: trim(world.x), y: trim(world.y) };
    const pts = mine.stroke.points;
    const last = pts[pts.length - 1];
    if (Math.hypot(at.x - last.x, at.y - last.y) * scaleRef.current < 0.7) return;
    pts.push(at);
    pendingInkRef.current.push(at);
    if (inkFrameRef.current === null) inkFrameRef.current = requestAnimationFrame(flushInk);
    // Just the new bit: redrawing the whole layer for every movement of the
    // pen would be slow on a board with a lot on it.
    const tctx = teacherCtxRef.current;
    if (tctx) {
      tctx.globalAlpha = 1;
      tctx.globalCompositeOperation = "source-over";
      tctx.strokeStyle = mine.stroke.color;
      tctx.lineWidth = mine.stroke.width;
      tctx.lineCap = "round";
      tctx.lineJoin = "round";
      tctx.beginPath();
      tctx.moveTo(last.x, last.y);
      tctx.lineTo(at.x, at.y);
      tctx.stroke();
    }
    // A very long line is finished here and carried straight on as a new
    // one, so each is small enough to send whole.
    if (pts.length >= INK_MAX_POINTS) {
      const { pointerId, pointerType } = mine;
      endInk(true);
      startInk(pointerId, at, pointerType);
    }
  }

  // Lines being written by the teacher elsewhere that have gone quiet (the
  // message saying they were finished never arrived) are dropped.
  function watchLiveInk() {
    if (liveExpiryRef.current) return;
    liveExpiryRef.current = setInterval(() => {
      const live = teacherLiveRef.current;
      const now = Date.now();
      let left = false;
      let dropped = false;
      for (const key in live) {
        if (now - (live[key].at || 0) >= LIVE_INK_EXPIRES_MS) {
          delete live[key];
          dropped = true;
        } else {
          left = true;
        }
      }
      if (dropped) drawTeacherOverlay();
      if (!left) {
        clearInterval(liveExpiryRef.current);
        liveExpiryRef.current = null;
      }
    }, 5000);
  }

  // Realtime: connects to the board's own existing channel (the exact
  // same one the teacher's normal whiteboard already broadcasts on), and
  // asks for a state snapshot since this viewer has no database access —
  // students never logged in, by design.
  useEffect(() => {
    if (!boardId) return;
    const channel = supabase.channel(`board-${boardId}`, {
      config: { broadcast: { self: false } },
    });

    function requestSnapshot() {
      if (hasReceivedSnapshot.current) return;
      channel.send({
        type: "broadcast",
        event: "classroom-state-request",
        payload: withCommentsRef.current ? { comments: true } : {},
      });
    }

    // The board's answer. A small board arrives whole, in this one message.
    // A big one is too large for a single live message, so this message
    // carries only the settings and says how many pieces of contents follow
    // ("classroom-state-piece"), ending with "classroom-state-done".
    //
    // The board answers everyone at once whenever anybody asks, so a viewer
    // that is already up to date ignores answers meant for someone else.
    channel.on("broadcast", { event: "classroom-state-snapshot" }, ({ payload }) => {
      if (hasReceivedSnapshot.current) return;
      // The teacher's view of a student's board waits for an answer that
      // has the comments in it (one sent for somebody else may not).
      if (withCommentsRef.current && !Array.isArray(payload.comments)) return;
      hasReceivedSnapshot.current = true;
      gridConfigRef.current = payload.grid || null;
      backgroundRef.current = normalizeBackground(payload.background);
      setReferenceDoc(payload.referenceDoc || null);
      setReferenceStrokes(payload.referenceStrokes || []);
      if (payload.pieces) {
        // Contents follow. What's on screen is left alone meanwhile, so
        // re-joining after a dropped connection doesn't blank the board.
        collectingRef.current = {
          id: payload.snapshotId, expected: payload.pieces, received: 0,
          strokes: new Set(), texts: new Set(), images: new Set(), teacherInk: new Set(),
        };
      } else {
        collectingRef.current = null;
        setStrokes(payload.strokes || []);
        setTexts(payload.texts || []);
        setImages(payload.images || []);
        setTeacherInk(payload.teacherInk || []);
        if (fitOnLoadRef.current) pendingFitRef.current = true;
      }
      setConnectionStatus("live");
      onSnapshotRef.current?.(payload);
      fullRedraw();
    });

    channel.on("broadcast", { event: "classroom-state-piece" }, ({ payload }) => {
      const c = collectingRef.current;
      if (!c || c.id !== payload.snapshotId) return;
      c.received += 1;
      const take = (kind, setList) => {
        const list = payload[kind] || [];
        if (!list.length) return;
        list.forEach((o) => c[kind].add(o.id));
        setList((prev) => mergeById(prev, list));
      };
      take("strokes", setStrokes);
      take("texts", setTexts);
      take("images", setImages);
      take("teacherInk", setTeacherInk);
    });

    channel.on("broadcast", { event: "classroom-state-done" }, ({ payload }) => {
      const c = collectingRef.current;
      if (!c || c.id !== payload.snapshotId) return;
      collectingRef.current = null;
      // After a re-join: anything still on screen that the board no longer
      // has was rubbed out while we were away. (Only when every piece
      // arrived, so a lost piece can never wipe things that do exist.)
      if (c.received >= c.expected) {
        setStrokes((prev) => prev.filter((o) => c.strokes.has(o.id)));
        setTexts((prev) => prev.filter((o) => c.texts.has(o.id)));
        setImages((prev) => prev.filter((o) => c.images.has(o.id)));
        setTeacherInk((prev) => prev.filter((o) => c.teacherInk.has(o.id)));
      }
      if (fitOnLoadRef.current) pendingFitRef.current = true;
    });

    // The teacher writing on this board (it is a student's): seen here when
    // this is a classmate's view of it, or the teacher's own class overview.
    // The teacher's own view of the board draws its lines itself (see
    // startInk) and never hears them back.
    channel.on("broadcast", { event: "teacher-ink-start" }, ({ payload }) => {
      if (!payload || !payload.strokeKey) return;
      teacherLiveRef.current[payload.strokeKey] = {
        id: payload.strokeId, tool: "pen", color: payload.color, width: payload.width, opacity: 1, points: [payload.point],
        at: Date.now(),
      };
      watchLiveInk();
    });
    channel.on("broadcast", { event: "teacher-ink-points" }, ({ payload }) => {
      const s = payload && teacherLiveRef.current[payload.strokeKey];
      if (!s) return;
      s.points.push(...(payload.points || []));
      s.at = Date.now();
      drawTeacherOverlay();
    });
    channel.on("broadcast", { event: "teacher-ink-cancel" }, ({ payload }) => {
      if (!payload) return;
      delete teacherLiveRef.current[payload.strokeKey];
      drawTeacherOverlay();
    });
    channel.on("broadcast", { event: "teacher-ink-end" }, ({ payload }) => {
      if (!payload) return;
      const s = payload.stroke || teacherLiveRef.current[payload.strokeKey];
      delete teacherLiveRef.current[payload.strokeKey];
      if (!s || !s.id || !s.points || s.points.length < 2) return;
      keep("teacherInk", s.id);
      setTeacherInk((prev) => (prev.some((x) => x.id === s.id) ? prev : [...prev, s]));
    });
    channel.on("broadcast", { event: "teacher-ink-remove" }, ({ payload }) => {
      const gone = new Set((payload && payload.ids) || []);
      if (gone.size) setTeacherInk((prev) => prev.filter((x) => !gone.has(x.id)));
    });
    channel.on("broadcast", { event: "teacher-ink-clear" }, () => {
      teacherLiveRef.current = {};
      setTeacherInk([]);
    });

    // Things that arrive the ordinary way while a big board is still coming
    // in pieces are newer than the pieces, so they are kept too.
    const keep = (kind, id) => {
      if (collectingRef.current) collectingRef.current[kind].add(id);
    };

    channel.on("broadcast", { event: "stroke-start" }, ({ payload }) => {
      remoteStrokes.current[payload.strokeKey] = {
        id: payload.strokeId,
        tool: payload.tool,
        color: payload.color,
        width: payload.width,
        opacity: payload.opacity,
        points: [payload.point],
      };
    });

    channel.on("broadcast", { event: "stroke-points" }, ({ payload }) => {
      const s = remoteStrokes.current[payload.strokeKey];
      if (!s) return;
      s.points.push(...payload.points);
      fullRedraw();
    });

    channel.on("broadcast", { event: "stroke-straight" }, ({ payload }) => {
      const s = remoteStrokes.current[payload.strokeKey];
      if (!s) return;
      s.points = [payload.start, payload.end];
      fullRedraw();
    });

    channel.on("broadcast", { event: "stroke-shape" }, ({ payload }) => {
      const s = remoteStrokes.current[payload.strokeKey];
      if (!s) return;
      s.points = payload.points;
      fullRedraw();
    });

    channel.on("broadcast", { event: "stroke-end" }, ({ payload }) => {
      const s = remoteStrokes.current[payload.strokeKey];
      if (!s) return;
      delete remoteStrokes.current[payload.strokeKey];
      if (s.points.length > 1) {
        keep("strokes", s.id);
        // never twice (a re-sent board can include a stroke that then also
        // finishes "live")
        setStrokes((prev) => (prev.some((x) => x.id === s.id) ? prev : [...prev, s]));
      }
    });

    channel.on("broadcast", { event: "stroke-remove" }, ({ payload }) => {
      setStrokes((prev) => prev.filter((s) => s.id !== payload.strokeId));
    });

    channel.on("broadcast", { event: "stroke-restore" }, ({ payload }) => {
      keep("strokes", payload.stroke.id);
      setStrokes((prev) => mergeById(prev, [payload.stroke]));
    });

    channel.on("broadcast", { event: "text-add" }, ({ payload }) => {
      keep("texts", payload.text.id);
      setTexts((prev) => {
        const exists = prev.some((t) => t.id === payload.text.id);
        return exists ? prev.map((t) => (t.id === payload.text.id ? payload.text : t)) : [...prev, payload.text];
      });
    });

    channel.on("broadcast", { event: "text-remove" }, ({ payload }) => {
      setTexts((prev) => prev.filter((t) => t.id !== payload.textId));
    });

    channel.on("broadcast", { event: "text-move" }, ({ payload }) => {
      setTexts((prev) => prev.map((t) => (t.id === payload.textId ? { ...t, x: payload.x, y: payload.y } : t)));
    });

    channel.on("broadcast", { event: "text-transform" }, ({ payload }) => {
      const { textId, ...partial } = payload;
      setTexts((prev) => prev.map((t) => (t.id === textId ? { ...t, ...partial } : t)));
    });

    channel.on("broadcast", { event: "grid-set" }, ({ payload }) => {
      gridConfigRef.current = payload.grid;
      fullRedraw();
    });

    // Selection / copy-paste / image events from the teacher's board.
    channel.on("broadcast", { event: "objects-add" }, ({ payload }) => {
      (payload.strokes || []).forEach((o) => keep("strokes", o.id));
      (payload.texts || []).forEach((o) => keep("texts", o.id));
      (payload.images || []).forEach((o) => keep("images", o.id));
      if (payload.strokes?.length) setStrokes((prev) => mergeById(prev, payload.strokes));
      if (payload.texts?.length) setTexts((prev) => mergeById(prev, payload.texts));
      if (payload.images?.length) setImages((prev) => mergeById(prev, payload.images));
    });
    channel.on("broadcast", { event: "objects-remove" }, ({ payload }) => {
      const s = new Set(payload.strokes || []), t = new Set(payload.texts || []), i = new Set(payload.images || []);
      if (s.size) setStrokes((prev) => prev.filter((x) => !s.has(x.id)));
      if (t.size) setTexts((prev) => prev.filter((x) => !t.has(x.id)));
      if (i.size) setImages((prev) => prev.filter((x) => !i.has(x.id)));
    });
    channel.on("broadcast", { event: "objects-move" }, ({ payload }) => {
      const { dx, dy } = payload;
      const s = new Set(payload.strokes || []), t = new Set(payload.texts || []), i = new Set(payload.images || []);
      if (s.size) setStrokes((prev) => prev.map((x) => (s.has(x.id) ? translateStroke(x, dx, dy) : x)));
      if (t.size) setTexts((prev) => prev.map((x) => (t.has(x.id) ? translateText(x, dx, dy) : x)));
      if (i.size) setImages((prev) => prev.map((x) => (i.has(x.id) ? translateImage(x, dx, dy) : x)));
    });
    channel.on("broadcast", { event: "image-update" }, ({ payload }) => {
      if (payload.image) setImages((prev) => prev.map((x) => (x.id === payload.image.id ? payload.image : x)));
    });

    channel.on("broadcast", { event: "background-set" }, ({ payload }) => {
      backgroundRef.current = normalizeBackground(payload.background);
      fullRedraw();
    });

    channel.on("broadcast", { event: "clear" }, () => {
      setStrokes([]);
      setTexts([]);
      setImages([]);
    });

    channel.on("broadcast", { event: "reference-set" }, ({ payload }) => {
      setReferenceDoc(payload.doc);
      setReferenceStrokes([]);
    });

    channel.on("broadcast", { event: "reference-remove" }, () => {
      setReferenceDoc(null);
      setReferenceStrokes([]);
    });

    channel.on("broadcast", { event: "reference-stroke" }, ({ payload }) => {
      setReferenceStrokes((prev) => [...prev, payload.stroke]);
    });

    channel.on("broadcast", { event: "reference-stroke-remove" }, ({ payload }) => {
      setReferenceStrokes((prev) => prev.filter((s) => s.id !== payload.strokeId));
    });

    channel.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      // Back after a dropped connection (Wi-Fi blip, tablet asleep): things
      // may have changed meanwhile, so ask for the board again.
      if (joinedOnceRef.current) {
        hasReceivedSnapshot.current = false;
        remoteStrokes.current = {};
        teacherLiveRef.current = {};
      }
      joinedOnceRef.current = true;
      requestSnapshot();
    });
    channelRef.current = channel;

    // The teacher's board might not have finished mounting/subscribing
    // yet in the moment right after "Start Class" — keep asking rather
    // than giving up after one try.
    const retryInterval = setInterval(() => {
      if (!hasReceivedSnapshot.current) {
        setConnectionStatus("waiting");
        requestSnapshot();
      }
    }, STATE_REQUEST_RETRY_MS);

    return () => {
      clearInterval(retryInterval);
      supabase.removeChannel(channel);
      channelRef.current = null;
      hasReceivedSnapshot.current = false;
      joinedOnceRef.current = false;
      collectingRef.current = null;
      if (liveExpiryRef.current) clearInterval(liveExpiryRef.current);
      liveExpiryRef.current = null;
      teacherLiveRef.current = {};
    };
  }, [boardId]);

  // Canvas setup, resize, pan/zoom — no drawing tools, view navigation only.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctxRef.current = ctx;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const overlay = teacherCanvasRef.current;
    teacherCtxRef.current = overlay ? overlay.getContext("2d") : null;

    function resizeCanvas() {
      const ratio = window.devicePixelRatio || 1;
      const { width, height } = getPaneSize();
      for (const c of [canvas, overlay]) {
        if (!c) continue;
        c.width = width * ratio;
        c.height = height * ratio;
        c.style.width = width + "px";
        c.style.height = height + "px";
      }
      // A preview keeps the whole board in view whatever size it is given.
      if (autoFitRef.current) fitAll();
      fullRedraw();
    }
    resizeCanvas();
    const resizeObserver = new ResizeObserver(() => resizeCanvas());
    if (boardPaneRef.current) resizeObserver.observe(boardPaneRef.current);

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function isLikelyMouseWheel(e) {
      if (e.deltaMode !== 0) return true;
      return e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50;
    }

    function handleWheel(e) {
      e.preventDefault();
      const screenPos = getPos(e);
      const worldPos = screenToWorld(screenPos);
      let newScale = null;

      if (e.ctrlKey) {
        newScale = scaleRef.current * Math.exp(-e.deltaY * 0.01);
      } else if (isLikelyMouseWheel(e)) {
        const step = 0.1;
        newScale = scaleRef.current * (e.deltaY < 0 ? 1 + step : 1 - step);
      }

      if (newScale !== null) {
        newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
        panRef.current = { x: screenPos.x - worldPos.x * newScale, y: screenPos.y - worldPos.y * newScale };
        scaleRef.current = newScale;
      } else {
        panRef.current = { x: panRef.current.x - e.deltaX, y: panRef.current.y - e.deltaY };
      }
      fullRedraw();
    }

    function centroid(p1, p2) {
      return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    }

    function beginPanZoom() {
      const pts = Array.from(touchPoints.current.values());
      if (pts.length < 2) return;
      const [p1, p2] = pts;
      panZoomState.current = {
        initialDistance: distance(p1, p2),
        initialScale: scaleRef.current,
        worldAnchor: screenToWorld(centroid(p1, p2)),
      };
    }

    function updatePanZoom() {
      const pz = panZoomState.current;
      if (!pz) return;
      const pts = Array.from(touchPoints.current.values());
      if (pts.length < 2) return;
      const [p1, p2] = pts;
      const c = centroid(p1, p2);
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pz.initialScale * (distance(p1, p2) / pz.initialDistance)));
      panRef.current = { x: c.x - pz.worldAnchor.x * newScale, y: c.y - pz.worldAnchor.y * newScale };
      scaleRef.current = newScale;
      fullRedraw();
    }

    function handlePointerDown(e) {
      const pos = getPos(e);
      if (e.pointerType === "touch") touchPoints.current.set(e.pointerId, pos);

      if (touchPoints.current.size >= 2) {
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
        tapRef.current = null; // two fingers: a pinch, never a tap
        endInk(false); // …and never the start of a line
        panDragActive.current = false;
        beginPanZoom();
        return;
      }

      // Writing on the board as the teacher: one finger, the pen or the
      // mouse draws (two fingers still move and zoom). With "Pencil only"
      // switched on (see pencilPrefs.js) a finger moves the board instead,
      // as it does on the teacher's own board, so a resting hand can't
      // leave marks on a student's work.
      const mayDraw =
        drawToolRef.current &&
        (e.pointerType !== "mouse" || e.button === 0) &&
        !(e.pointerType === "touch" && getPencilOnly());
      if (mayDraw) {
        if (myStrokeRef.current) {
          // The pen takes over from a finger (or the side of a hand) that
          // touched down first; otherwise it is one line at a time.
          if (e.pointerType === "pen" && myStrokeRef.current.pointerType === "touch") endInk(false);
          else return;
        }
        tapRef.current = null;
        panDragActive.current = false;
        const world = screenToWorld(pos);
        startInk(e.pointerId, { x: trim(world.x), y: trim(world.y) }, e.pointerType);
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
        return;
      }

      tapRef.current = { pointerId: e.pointerId, pos };
      panDragActive.current = true;
      panDragStart.current = { pos, origPan: { ...panRef.current } };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    }

    function handlePointerMove(e) {
      if (e.pointerType === "touch" && touchPoints.current.has(e.pointerId)) {
        touchPoints.current.set(e.pointerId, getPos(e));
      }
      if (panZoomState.current && touchPoints.current.size >= 2) {
        updatePanZoom();
        return;
      }
      if (myStrokeRef.current) {
        if (myStrokeRef.current.pointerId !== e.pointerId) return;
        // every position the pen passed through, not just one per frame
        const steps = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
        if (steps.length > 1) steps.forEach((step) => moveInk(getPos(step)));
        else moveInk(getPos(e));
        return;
      }
      if (panDragActive.current) {
        const pos = getPos(e);
        const dx = pos.x - panDragStart.current.pos.x;
        const dy = pos.y - panDragStart.current.pos.y;
        if (tapRef.current && Math.hypot(dx, dy) > TAP_SLOP_PX) tapRef.current = null;
        panRef.current = { x: panDragStart.current.origPan.x + dx, y: panDragStart.current.origPan.y + dy };
        fullRedraw();
      }
    }

    function handlePointerUp(e) {
      if (e.pointerType === "touch") {
        touchPoints.current.delete(e.pointerId);
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
      }
      if (panZoomState.current) {
        if (touchPoints.current.size < 2) panZoomState.current = null;
        return;
      }
      if (myStrokeRef.current) {
        if (myStrokeRef.current.pointerId !== e.pointerId) return;
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
        endInk(true);
        return;
      }
      panDragActive.current = false;
      panDragStart.current = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
      const tap = tapRef.current;
      tapRef.current = null;
      if (tap && tap.pointerId === e.pointerId && e.type === "pointerup" && onBoardTapRef.current) {
        // The press never moved, so the view didn't either: put it back
        // exactly (a pixel of drift would nudge the board on every tap).
        onBoardTapRef.current(screenToWorld(tap.pos), tap.pos, getPaneSize());
      }
    }

    // A preview (interactive = false) is only looked at.
    if (!interactiveRef.current) return () => resizeObserver.disconnect();

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      resizeObserver.disconnect();
      if (inkFrameRef.current !== null) cancelAnimationFrame(inkFrameRef.current);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, []);

  useEffect(() => {
    teacherInkRef.current = teacherInk;
    questionRef.current = question;
    if (autoFit) {
      pendingFitRef.current = false;
      fitAll();
    } else if (pendingFitRef.current) {
      pendingFitRef.current = false;
      fitAll({ onlyIfNeeded: true });
    }
    fullRedraw();
  }, [strokes, texts, images, teacherInk, question, autoFit]);

  // How much teacher's writing is on the board (for the Undo / Remove
  // buttons in the teacher's view).
  useEffect(() => {
    const mine = myInkStackRef.current.filter((id) => teacherInk.some((s) => s.id === id)).length;
    onInkChangeRef.current?.({ total: teacherInk.length, mine });
  }, [teacherInk]);

  const showReferencePane = !!referenceDoc;

  return (
    <div style={{ width: "100%", height: "100%", overflow: "hidden", display: "flex" }}>
      {showReferencePane && (
        <div
          className={cls.refColumn}
        >
          <div className={cls.refHeader}>
            {referenceDoc.fileName}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ReferencePane doc={referenceDoc} strokes={referenceStrokes} readOnly />
          </div>
        </div>
      )}

      <div
        ref={boardPaneRef}
        data-tour={tour}
        style={{ position: "relative", flex: 1, minWidth: 0, height: "100%", overflow: "hidden", isolation: "isolate" }}
      >
        {/* Page pattern layer behind the transparent ink canvas. */}
        <div
          ref={pageBgRef}
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, zIndex: -1, backgroundColor: "#ffffff", pointerEvents: "none" }}
        />
        {images.map((img) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={img.id}
            ref={(el) => {
              if (el) imageNodesRef.current[img.id] = el;
              else delete imageNodesRef.current[img.id];
            }}
            src={img.src}
            alt=""
            draggable={false}
            onLoad={repositionImages}
            style={{ position: "absolute", left: 0, top: 0, zIndex: -1, maxWidth: "none", pointerEvents: "none", userSelect: "none" }}
          />
        ))}
        {/* Pictures in the teacher's question, shown the same way. */}
        {((question && question.images) || []).map((img) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`q-${img.id}`}
            ref={(el) => {
              if (el) questionImageNodesRef.current[img.id] = el;
              else delete questionImageNodesRef.current[img.id];
            }}
            src={img.src}
            alt=""
            draggable={false}
            onLoad={repositionImages}
            style={{ position: "absolute", left: 0, top: 0, zIndex: -1, maxWidth: "none", pointerEvents: "none", userSelect: "none" }}
          />
        ))}
        {!embedded && (
          <button
            onClick={() => (onLeave ? onLeave() : router.push("/join"))}
            className={`${cls.floatBtn} ${cls.floatBtnLow}`}
          >
            Leave
          </button>
        )}

        {connectionStatus !== "live" && (
          <div
            className={cls.statusPill}
          >
            {connectionStatus === "connecting" ? "Connecting…" : waitingText || "Waiting for your teacher's board…"}
          </div>
        )}

        <canvas
          ref={canvasRef}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            display: "block",
            touchAction: "none",
            WebkitUserSelect: "none",
            userSelect: "none",
            WebkitTouchCallout: "none",
            WebkitTapHighlightColor: "transparent",
            cursor: onBoardTap || drawTool ? "crosshair" : "default",
            pointerEvents: interactive ? "auto" : "none",
          }}
        />
        {/* The teacher's layer (the class question, the teacher's writing)
            and the comment pins: on top of the ink, never in the way of it. */}
        <canvas
          ref={teacherCanvasRef}
          aria-hidden="true"
          data-teacher-layer="true"
          style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
        />
        {children}
      </div>
    </div>
  );
}