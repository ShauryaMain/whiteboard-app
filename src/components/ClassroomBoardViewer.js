"use client";

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import ReferencePane from "./ReferencePane";
import { renderGrid } from "@/lib/gridRenderer";
import { applyBackground, normalizeBackground } from "@/lib/boardBackground";
import {
  translateStroke, translateText, translateImage, strokeDash,
  strokeBounds, textBounds, imageBounds, unionBounds,
} from "@/lib/boardObjects";
import cls from "./Classroom.module.css";

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const STATE_REQUEST_RETRY_MS = 3000;
const TAP_SLOP_PX = 8; // a press that moves less than this is a tap, not a drag
const FIT_MARGIN_PX = 36;

function distance(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

// Adds (or replaces) things in a list, matched by id.
function mergeById(prev, added) {
  const ids = new Set(added.map((o) => o.id));
  return [...prev.filter((o) => !ids.has(o.id)), ...added];
}

function smoothPath(ctx, pts, startIdx, endIdx) {
  if (endIdx - startIdx < 1) return;
  ctx.beginPath();
  ctx.moveTo(pts[startIdx].x, pts[startIdx].y);
  if (endIdx - startIdx === 1) {
    ctx.lineTo(pts[endIdx].x, pts[endIdx].y);
  } else {
    for (let i = startIdx + 1; i < endIdx; i++) {
      const xc = (pts[i].x + pts[i + 1].x) / 2;
      const yc = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
    }
    ctx.lineTo(pts[endIdx].x, pts[endIdx].y);
  }
  ctx.stroke();
}

function strokeSegment(ctx, p0, p1, width) {
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.stroke();
}

function drawVariableWidthPath(ctx, pts, startIdx, endIdx, fallbackWidth) {
  for (let i = startIdx; i < endIdx; i++) {
    const w0 = pts[i].w ?? fallbackWidth;
    const w1 = pts[i + 1].w ?? fallbackWidth;
    strokeSegment(ctx, pts[i], pts[i + 1], (w0 + w1) / 2);
  }
}

function drawStroke(ctx, stroke) {
  if (!stroke || !stroke.points || stroke.points.length < 2) return;
  if (stroke.tool === "eraser") {
    // Punch a transparent hole (like the teacher's board) so the page
    // background shows through instead of a white smear.
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "#000000";
    drawVariableWidthPath(ctx, stroke.points, 0, stroke.points.length - 1, stroke.width);
    ctx.globalCompositeOperation = "source-over";
  } else {
    ctx.globalAlpha = stroke.opacity ?? 1;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const dash = strokeDash(stroke);
    if (dash) ctx.setLineDash(dash);
    smoothPath(ctx, stroke.points, 0, stroke.points.length - 1);
    if (dash) ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;
}

function wrapTextLines(ctx, textContent, fontSize, maxWidth) {
  ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
  const paragraphs = String(textContent).split("\n");
  const lines = [];
  for (const para of paragraphs) {
    if (para === "") {
      lines.push("");
      continue;
    }
    const words = para.split(" ");
    let currentLine = "";
    for (const word of words) {
      const testLine = currentLine ? currentLine + " " + word : word;
      const testWidth = ctx.measureText(testLine).width;
      if (testWidth > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    lines.push(currentLine);
  }
  return lines;
}

function drawTexts(ctx, textsArr) {
  for (const t of textsArr) {
    const lines = wrapTextLines(ctx, t.text, t.fontSize, t.width || 240);
    const lineHeight = t.fontSize * 1.3;
    const boxHeight = lines.length * lineHeight;
    const center = { x: t.x + (t.width || 240) / 2, y: t.y + boxHeight / 2 };
    const rotation = t.rotation || 0;

    ctx.save();
    if (rotation) {
      ctx.translate(center.x, center.y);
      ctx.rotate(rotation);
      ctx.translate(-center.x, -center.y);
    }
    ctx.fillStyle = t.color;
    ctx.font = `${t.fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textBaseline = "top";
    lines.forEach((line, i) => ctx.fillText(line, t.x, t.y + i * lineHeight));
    ctx.restore();
  }
}

// Same graph renderer as the teacher's board (and the graph dialog's
// preview), so students see exactly the graph the teacher placed.
function drawGrid(ctx, grid, scale) {
  if (!grid) return;
  const { x, y, size, cols } = grid;
  renderGrid(ctx, grid, { cellPx: size / cols, originXPx: x, originYPx: y, lineScale: 1 / scale });
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

// A read-only, live view of a board, for someone with no database access.
//
// Two uses:
//   • a student watching the teacher's board (the default), and
//   • the teacher looking at one student's board (TeacherStudentBoardView
//     passes `embedded` and the extras below).
//
// Extras, all optional:
//   embedded     sits inside another screen: fills its box, no Leave button
//   waitingText  what the pill says while the board hasn't answered yet
//   pins         [{ id, x, y, draft? }] numbered markers, in board coordinates
//   onBoardTap   (boardPoint, screenPoint, paneSize) a tap that wasn't a drag
//   onSnapshot   (payload) the board's answer to "what's on you?" arrived
//   fitOnLoad    once loaded, zoom out if needed so nothing is off screen
//   tour         a data-tour name for the board area (see src/lib/tours.js)
//   ref          gets { send(event, payload), fitAll() }
export default function ClassroomBoardViewer({
  boardId, embedded = false, waitingText, pins, onBoardTap, onSnapshot, fitOnLoad = false, tour, ref, children,
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

  const [strokes, setStrokes] = useState([]);
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
    for (const img of imagesRef.current) {
      const el = imageNodesRef.current[img.id];
      if (!el) continue;
      el.style.left = img.x * scale + pan.x + "px";
      el.style.top = img.y * scale + pan.y + "px";
      el.style.width = img.width * scale + "px";
      el.style.height = img.height * scale + "px";
    }
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
    drawGrid(ctx, gridConfigRef.current, scale);
    if (pinsRef.current.length) drawPins(ctx, pinsRef.current, scale);
    applyBackground(pageBgRef.current, backgroundRef.current, scale, pan, backgroundCssKeyRef);
    repositionImages();
  }

  useEffect(() => {
    pinsRef.current = pins || [];
    fullRedraw();
  }, [pins]);

  // The box around everything on the board (null if it's empty).
  function contentBounds() {
    const boxes = [];
    for (const stroke of strokesRef.current) {
      if (stroke.tool !== "eraser") boxes.push(strokeBounds(stroke));
    }
    const ctx = ctxRef.current;
    for (const t of textsRef.current) {
      const lines = ctx ? wrapTextLines(ctx, t.text, t.fontSize, t.width || 240).length : 1;
      boxes.push(textBounds(t, lines * t.fontSize * 1.3));
    }
    for (const img of imagesRef.current) boxes.push(imageBounds(img));
    const grid = gridConfigRef.current;
    if (grid && grid.size && grid.cols) {
      const rows = grid.type === "polar" ? grid.cols : grid.rows || grid.cols;
      boxes.push({ minX: grid.x, minY: grid.y, maxX: grid.x + grid.size, maxY: grid.y + (grid.size / grid.cols) * rows });
    }
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
    const scale = Math.max(
      MIN_SCALE,
      Math.min(1, (width - FIT_MARGIN_PX * 2) / boxW, (height - FIT_MARGIN_PX * 2) / boxH)
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
  }));

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
      channel.send({ type: "broadcast", event: "classroom-state-request", payload: {} });
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
          strokes: new Set(), texts: new Set(), images: new Set(),
        };
      } else {
        collectingRef.current = null;
        setStrokes(payload.strokes || []);
        setTexts(payload.texts || []);
        setImages(payload.images || []);
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
      }
      if (fitOnLoadRef.current) pendingFitRef.current = true;
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

    function resizeCanvas() {
      const ratio = window.devicePixelRatio || 1;
      const { width, height } = getPaneSize();
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
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
        beginPanZoom();
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

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, []);

  useEffect(() => {
    if (pendingFitRef.current) {
      pendingFitRef.current = false;
      fitAll({ onlyIfNeeded: true });
    }
    fullRedraw();
  }, [strokes, texts, images]);

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
        {!embedded && (
          <button
            onClick={() => router.push("/join")}
            className={cls.floatBtn}
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
            cursor: onBoardTap ? "crosshair" : "default",
          }}
        />
        {children}
      </div>
    </div>
  );
}