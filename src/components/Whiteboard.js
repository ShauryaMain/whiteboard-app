"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import Toolbar from "./Toolbar";
import RulerOverlay from "./RulerOverlay";
import CompassOverlay from "./CompassOverlay";
import ZoomMenu from "./ZoomMenu";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const ERASER_MAX_BOOST = 2;
const ERASER_SENSITIVITY = 0.6;
const ERASER_SMOOTHING = 0.25;
const INTERP_MAX_STEP = 6;

function opacityForTool(t) {
  return t === "highlighter" ? 0.35 : 1;
}

function widthForTool(t, baseWidth) {
  if (t === "eraser") return baseWidth * 3;
  if (t === "highlighter") return baseWidth * 2.5;
  return baseWidth;
}

function projectOntoAngle(start, pos, angle) {
  const dx = pos.x - start.x;
  const dy = pos.y - start.y;
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const t = dx * dirX + dy * dirY;
  return { x: start.x + t * dirX, y: start.y + t * dirY };
}

function distance(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function centroid(p1, p2) {
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

function angleDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
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

function roundPoints(points) {
  return points.map((p) => {
    const rp = { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 };
    if (p.w !== undefined) rp.w = Math.round(p.w * 100) / 100;
    return rp;
  });
}

function interpolateGap(prevScreen, newScreen, maxStep) {
  const dist = distance(prevScreen, newScreen);
  if (dist <= maxStep) return [];
  const steps = Math.floor(dist / maxStep);
  const points = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / (steps + 1);
    points.push({
      x: prevScreen.x + (newScreen.x - prevScreen.x) * t,
      y: prevScreen.y + (newScreen.y - prevScreen.y) * t,
    });
  }
  return points;
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

export default function Whiteboard({ boardId }) {
  const { user } = useAuth();
  const [isOwner, setIsOwner] = useState(false);

  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const isDrawing = useRef(false);
  const currentStroke = useRef(null);
  const currentStrokeId = useRef(null);
  const activePointerId = useRef(null);
  const activePointerType = useRef(null);
  const strokeScreenStart = useRef(null);
  const lastRawScreenPos = useRef(null);
  const eraserSpeedMultiplier = useRef(1);
  const eraserLastPointTime = useRef(0);
  const eraserLastScreenPos = useRef(null);

  const isMobileRef = useRef(false);
  const touchDrivenStrokeActive = useRef(false);
  const pencilTipCheckedRef = useRef(false);

  const panRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);

  const touchPoints = useRef(new Map());
  const panZoomState = useRef(null);

  const pendingBroadcastPoints = useRef([]);
  const pendingStraightUpdate = useRef(null);
  const pendingShapeUpdate = useRef(null);
  const rafId = useRef(null);

  const pendingGridUpdate = useRef(null);
  const gridRafId = useRef(null);
  const gridToolActiveRef = useRef(false);
  const gridConfigRef = useRef(null);
  const gridDragMode = useRef(null);
  const gridDragStart = useRef(null);

  const panToolActiveRef = useRef(false);
  const panDragActive = useRef(false);
  const panDragStart = useRef(null);

  const clientId = useRef(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  );

  const channelRef = useRef(null);
  const remoteStrokes = useRef({});
  const strokesRef = useRef([]);
  const textsRef = useRef([]);
  const toolRef = useRef("pen");
  const colorRef = useRef("#1a1a1a");
  const widthRef = useRef(4);
  const rulerActiveRef = useRef(false);
  const rulerAngleRef = useRef(0);

  const compassActiveRef = useRef(false);
  const compassCenterRef = useRef({ x: 0, y: 0 });
  const compassRadiusRef = useRef(100);
  const activeCompassParams = useRef(null);
  const compassStartAngle = useRef(0);
  const compassCumulativeAngle = useRef(0);
  const compassLastRawAngle = useRef(0);

  // Per-user undo/redo, unified across both strokes and text boxes. Each
  // entry is {kind: "stroke"|"text", id}; myRedoStack entries carry the
  // full object ({kind, data}) since it's been removed from live state.
  const myStrokeStack = useRef([]);
  const myRedoStack = useRef([]);

  // Text-editing overlay: editingTextRef is the source of truth used by
  // imperative code (repositioning during pan/zoom); editingText (state)
  // just controls whether the textarea is mounted at all.
  const editingTextRef = useRef(null);
  const textareaElRef = useRef(null);
  const movingTextRef = useRef(null);
  const pendingTextMoveUpdate = useRef(null);
  const textMoveRafId = useRef(null);

  const [strokes, setStrokes] = useState([]);
  const [texts, setTexts] = useState([]);
  const [myUndoAvailable, setMyUndoAvailable] = useState(false);
  const [myRedoAvailable, setMyRedoAvailable] = useState(false);
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState("#1a1a1a");
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [saveStatus, setSaveStatus] = useState("");
  const [rulerActive, setRulerActive] = useState(false);
  const [rulerAngle, setRulerAngle] = useState(0);
  const [rulerPos, setRulerPos] = useState({ x: 300, y: 300 });
  const [compassActive, setCompassActive] = useState(false);
  const [compassCenter, setCompassCenter] = useState({ x: 300, y: 300 });
  const [compassRadius, setCompassRadius] = useState(100);
  const [compassAngle, setCompassAngle] = useState(-Math.PI / 2);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [gridToolActive, setGridToolActive] = useState(false);
  const [panToolActive, setPanToolActive] = useState(false);
  const [showPencilTip, setShowPencilTip] = useState(false);
  const [editingText, setEditingText] = useState(null);

  useEffect(() => { strokesRef.current = strokes; }, [strokes]);
  useEffect(() => { textsRef.current = texts; }, [texts]);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { widthRef.current = strokeWidth; }, [strokeWidth]);
  useEffect(() => { rulerActiveRef.current = rulerActive; }, [rulerActive]);
  useEffect(() => { rulerAngleRef.current = rulerAngle; }, [rulerAngle]);
  useEffect(() => { compassActiveRef.current = compassActive; }, [compassActive]);
  useEffect(() => { compassCenterRef.current = compassCenter; }, [compassCenter]);
  useEffect(() => { compassRadiusRef.current = compassRadius; }, [compassRadius]);
  useEffect(() => { gridToolActiveRef.current = gridToolActive; }, [gridToolActive]);
  useEffect(() => { panToolActiveRef.current = panToolActive; }, [panToolActive]);

  function screenToWorld(p) {
    return {
      x: (p.x - panRef.current.x) / scaleRef.current,
      y: (p.y - panRef.current.y) / scaleRef.current,
    };
  }

  function worldToScreen(p) {
    return {
      x: p.x * scaleRef.current + panRef.current.x,
      y: p.y * scaleRef.current + panRef.current.y,
    };
  }

  function repositionEditingTextarea() {
    const info = editingTextRef.current;
    const el = textareaElRef.current;
    if (!info || !el) return;
    const screenPos = worldToScreen({ x: info.x, y: info.y });
    el.style.left = screenPos.x + "px";
    el.style.top = screenPos.y + "px";
    el.style.fontSize = info.fontSize * scaleRef.current + "px";
  }

  function drawStroke(ctx, stroke) {
    if (!stroke || !stroke.points || stroke.points.length < 2) return;
    ctx.globalAlpha = stroke.opacity ?? 1;
    ctx.strokeStyle = stroke.tool === "eraser" ? "#ffffff" : stroke.color;
    if (stroke.tool === "eraser") {
      drawVariableWidthPath(ctx, stroke.points, 0, stroke.points.length - 1, stroke.width);
    } else {
      ctx.lineWidth = stroke.width;
      ctx.lineCap = "round";
      smoothPath(ctx, stroke.points, 0, stroke.points.length - 1);
    }
  }

  function drawTexts(ctx, textsArr, showBounds) {
    for (const t of textsArr) {
      ctx.save();
      ctx.fillStyle = t.color;
      ctx.font = `${t.fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textBaseline = "top";
      const lines = String(t.text).split("\n");
      const lineHeight = t.fontSize * 1.3;
      let maxWidth = 0;
      lines.forEach((line) => {
        maxWidth = Math.max(maxWidth, ctx.measureText(line).width);
      });
      lines.forEach((line, i) => ctx.fillText(line, t.x, t.y + i * lineHeight));

      if (showBounds) {
        const scale = scaleRef.current;
        ctx.strokeStyle = "rgba(30,136,229,0.55)";
        ctx.lineWidth = 1 / scale;
        ctx.setLineDash([4 / scale, 3 / scale]);
        ctx.strokeRect(t.x - 4, t.y - 4, maxWidth + 8, lines.length * lineHeight + 8);
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
  }

  // Finds the topmost existing text box under a world-space point, if any
  // — used to decide whether a tap with the Text tool should start
  // dragging an existing box instead of creating a new one.
  function hitTestText(worldPos) {
    const ctx = ctxRef.current;
    if (!ctx) return null;
    const arr = textsRef.current;
    for (let i = arr.length - 1; i >= 0; i--) {
      const t = arr[i];
      ctx.font = `${t.fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
      const lines = String(t.text).split("\n");
      const lineHeight = t.fontSize * 1.3;
      let maxWidth = 0;
      lines.forEach((line) => {
        maxWidth = Math.max(maxWidth, ctx.measureText(line).width);
      });
      const height = lines.length * lineHeight;
      const pad = 6;
      if (
        worldPos.x >= t.x - pad && worldPos.x <= t.x + maxWidth + pad &&
        worldPos.y >= t.y - pad && worldPos.y <= t.y + height + pad
      ) {
        return t;
      }
    }
    return null;
  }

  function drawGrid(ctx, grid) {
    if (!grid) return;
    const { x, y, size, cols } = grid;
    const cell = size / cols;
    const scale = scaleRef.current;

    ctx.save();
    ctx.strokeStyle = "#cfd8e3";
    ctx.lineWidth = 1 / scale;
    for (let i = 0; i <= cols; i++) {
      const gx = x + i * cell;
      ctx.beginPath();
      ctx.moveTo(gx, y);
      ctx.lineTo(gx, y + size);
      ctx.stroke();
    }
    for (let j = 0; j <= cols; j++) {
      const gy = y + j * cell;
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.lineTo(x + size, gy);
      ctx.stroke();
    }

    const mid = cols / 2;
    ctx.strokeStyle = "#9aa7b8";
    ctx.lineWidth = 1.5 / scale;
    const midX = x + mid * cell;
    const midY = y + mid * cell;
    ctx.beginPath();
    ctx.moveTo(midX, y);
    ctx.lineTo(midX, y + size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, midY);
    ctx.lineTo(x + size, midY);
    ctx.stroke();
    ctx.restore();

    if (gridToolActiveRef.current) {
      ctx.save();
      ctx.fillStyle = "#1E88E5";
      ctx.beginPath();
      ctx.arc(x + size, y + size, 8 / scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
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
    ctx.clearRect(-pan.x / scale, -pan.y / scale, window.innerWidth / scale, window.innerHeight / scale);

    for (const stroke of strokesRef.current) drawStroke(ctx, stroke);
    for (const key in remoteStrokes.current) drawStroke(ctx, remoteStrokes.current[key]);
    if (currentStroke.current) drawStroke(ctx, currentStroke.current);
    ctx.globalAlpha = 1;

    drawTexts(ctx, textsRef.current, toolRef.current === "text");
    drawGrid(ctx, gridConfigRef.current);

    repositionEditingTextarea();
  }

  function drawNewSegment(ctx, styleStroke, newPointsCount) {
    const pts = styleStroke.points;
    if (pts.length < 2 || newPointsCount < 1) return;
    const lookback = 3;
    const startIdx = Math.max(0, pts.length - newPointsCount - 1 - lookback);
    const endIdx = pts.length - 1;
    ctx.globalAlpha = styleStroke.opacity ?? 1;
    ctx.strokeStyle = styleStroke.tool === "eraser" ? "#ffffff" : styleStroke.color;
    if (styleStroke.tool === "eraser") {
      drawVariableWidthPath(ctx, pts, startIdx, endIdx, styleStroke.width);
    } else {
      ctx.lineWidth = styleStroke.width;
      ctx.lineCap = "butt";
      smoothPath(ctx, pts, startIdx, endIdx);
    }
    ctx.globalAlpha = 1;

    if (gridConfigRef.current) drawGrid(ctx, gridConfigRef.current);
  }

  async function insertStroke(stroke) {
    if (!boardId || !stroke?.id) return;
    const { error } = await supabase.from("strokes").upsert({
      id: stroke.id,
      board_id: boardId,
      data: {
        tool: stroke.tool,
        color: stroke.color,
        width: stroke.width,
        opacity: stroke.opacity,
        points: roundPoints(stroke.points),
      },
    });
    if (error) console.error("Error saving stroke:", error);
  }

  async function insertText(t) {
    if (!boardId || !t?.id) return;
    const { error } = await supabase.from("texts").upsert({
      id: t.id,
      board_id: boardId,
      x: t.x,
      y: t.y,
      text: t.text,
      color: t.color,
      font_size: t.fontSize,
    });
    if (error) console.error("Error saving text:", error);
  }

  function performClear() {
    setStrokes([]);
    setTexts([]);
  }

  function handleResetView() {
    panRef.current = { x: 0, y: 0 };
    scaleRef.current = 1;
    fullRedraw();
    setZoomPercent(100);
  }

  function handleSetZoom(percent) {
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, percent / 100));
    const center = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const worldCenter = screenToWorld(center);
    panRef.current = {
      x: center.x - worldCenter.x * newScale,
      y: center.y - worldCenter.y * newScale,
    };
    scaleRef.current = newScale;
    fullRedraw();
    setZoomPercent(Math.round(newScale * 100));
  }

  useEffect(() => {
    if (!boardId || !user) return;
    async function loadBoard() {
      const { error: joinError } = await supabase.rpc("join_board_via_link", { board_id: boardId });
      if (joinError) console.error("Error joining board:", joinError);

      const { data: boardRow, error: boardError } = await supabase
        .from("boards")
        .select("grid_config, owner_id")
        .eq("id", boardId)
        .single();
      if (!boardError && boardRow) {
        gridConfigRef.current = boardRow.grid_config || null;
        setIsOwner(user.id === boardRow.owner_id);
      } else if (boardError) {
        console.error("Error loading board:", boardError);
      }

      const { data: strokeRows, error: strokesError } = await supabase
        .from("strokes")
        .select("id, data")
        .eq("board_id", boardId)
        .order("created_at", { ascending: true });
      if (!strokesError && strokeRows) {
        setStrokes(strokeRows.map((r) => ({ ...r.data, id: r.id })));
      } else if (strokesError) {
        console.error("Error loading strokes:", strokesError);
      }

      const { data: textRows, error: textsError } = await supabase
        .from("texts")
        .select("id, x, y, text, color, font_size")
        .eq("board_id", boardId)
        .order("created_at", { ascending: true });
      if (!textsError && textRows) {
        setTexts(
          textRows.map((r) => ({
            id: r.id,
            x: r.x,
            y: r.y,
            text: r.text,
            color: r.color,
            fontSize: r.font_size,
          }))
        );
      } else if (textsError) {
        console.error("Error loading texts:", textsError);
      }

      fullRedraw();
    }
    loadBoard();
  }, [boardId, user]);

  async function saveGrid() {
    if (!boardId) return;
    const { error } = await supabase
      .from("boards")
      .update({ grid_config: gridConfigRef.current })
      .eq("id", boardId);
    return !error;
  }

  async function handleEndSession() {
    setSaveStatus("Saving…");
    const ok = await saveGrid();
    setSaveStatus(ok ? "Saved" : "Save failed");
    setTimeout(() => setSaveStatus(""), 3000);
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(window.location.href);
    setSaveStatus("Link copied");
    setTimeout(() => setSaveStatus(""), 2000);
  }

  function handleToggleRuler() {
    setRulerActive((prev) => {
      const next = !prev;
      if (next) {
        setRulerPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
        setCompassActive(false);
        setGridToolActive(false);
        setPanToolActive(false);
      }
      return next;
    });
  }

  function handleToggleCompass() {
    setCompassActive((prev) => {
      const next = !prev;
      if (next) {
        setCompassCenter({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
        setCompassRadius(100);
        setCompassAngle(-Math.PI / 2);
        setRulerActive(false);
        setGridToolActive(false);
        setPanToolActive(false);
      }
      return next;
    });
  }

  function handleToggleGrid() {
    setGridToolActive((prev) => {
      const next = !prev;
      if (next) {
        setRulerActive(false);
        setCompassActive(false);
        setPanToolActive(false);
      }
      fullRedraw();
      return next;
    });
  }

  function handleTogglePan() {
    setPanToolActive((prev) => {
      const next = !prev;
      if (next) {
        setRulerActive(false);
        setCompassActive(false);
        setGridToolActive(false);
      }
      return next;
    });
  }

  function handleRemoveGrid() {
    if (!gridConfigRef.current) return;
    gridConfigRef.current = null;
    fullRedraw();
    channelRef.current?.send({ type: "broadcast", event: "grid-set", payload: { grid: null } });
    saveGrid();
  }

  function handleDismissPencilTip() {
    setShowPencilTip(false);
    try {
      window.localStorage.setItem("whiteboard_scribble_tip_dismissed", "true");
    } catch (err) {}
  }

  function handleTextBlur(e) {
    const info = editingTextRef.current;
    const value = e.target.value.trim();
    editingTextRef.current = null;
    setEditingText(null);
    if (!info || !value) return;

    const textObj = {
      id: info.id,
      x: info.x,
      y: info.y,
      text: value,
      color: info.color,
      fontSize: info.fontSize,
    };
    setTexts((prev) => [...prev, textObj]);
    myStrokeStack.current.push({ kind: "text", id: textObj.id });
    myRedoStack.current = [];
    setMyUndoAvailable(true);
    setMyRedoAvailable(false);

    channelRef.current?.send({ type: "broadcast", event: "text-add", payload: { text: textObj } });
    insertText(textObj);
    fullRedraw();
  }

  useEffect(() => {
    if (!editingText) return;
    repositionEditingTextarea();
    // The click that created this text box is still being resolved by the
    // browser (mousedown -> mouseup -> click) when this effect first runs.
    // Focusing synchronously here loses the race against the browser's own
    // default focus handling for that click, which blurs us again almost
    // immediately. Deferring to the next tick lets that resolve first.
    const timerId = setTimeout(() => {
      textareaElRef.current?.focus();
    }, 0);
    return () => clearTimeout(timerId);
  }, [editingText]);

  useEffect(() => {
    if (!boardId) return;
    const channel = supabase.channel(`board-${boardId}`, {
      config: { broadcast: { self: false } },
    });

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
      const newCount = payload.points.length;
      s.points.push(...payload.points);
      if (ctxRef.current) drawNewSegment(ctxRef.current, s, newCount);
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
        setStrokes((prev) => [...prev, s]);
      }
    });

    channel.on("broadcast", { event: "stroke-remove" }, ({ payload }) => {
      setStrokes((prev) => prev.filter((s) => s.id !== payload.strokeId));
    });

    channel.on("broadcast", { event: "stroke-restore" }, ({ payload }) => {
      setStrokes((prev) => [...prev, payload.stroke]);
    });

    channel.on("broadcast", { event: "text-add" }, ({ payload }) => {
      setTexts((prev) => (prev.some((t) => t.id === payload.text.id) ? prev : [...prev, payload.text]));
    });

    channel.on("broadcast", { event: "text-remove" }, ({ payload }) => {
      setTexts((prev) => prev.filter((t) => t.id !== payload.textId));
    });

    channel.on("broadcast", { event: "text-move" }, ({ payload }) => {
      setTexts((prev) =>
        prev.map((t) => (t.id === payload.textId ? { ...t, x: payload.x, y: payload.y } : t))
      );
    });

    channel.on("broadcast", { event: "grid-set" }, ({ payload }) => {
      gridConfigRef.current = payload.grid;
      fullRedraw();
    });

    channel.on("broadcast", { event: "clear" }, () => {
      performClear();
      myStrokeStack.current = [];
      myRedoStack.current = [];
      setMyUndoAvailable(false);
      setMyRedoAvailable(false);
    });

    channel.subscribe();
    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [boardId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctxRef.current = ctx;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    isMobileRef.current =
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(hover: none) and (pointer: coarse)").matches
        : false;

    function resizeCanvas() {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * ratio;
      canvas.height = window.innerHeight * ratio;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      fullRedraw();
    }

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function scheduleBroadcastFlush() {
      if (rafId.current) return;
      rafId.current = requestAnimationFrame(() => {
        rafId.current = null;
        if (pendingBroadcastPoints.current.length === 0) return;
        const pointsToSend = pendingBroadcastPoints.current;
        pendingBroadcastPoints.current = [];
        channelRef.current?.send({
          type: "broadcast",
          event: "stroke-points",
          payload: {
            strokeKey: `${clientId.current}-${currentStrokeId.current}`,
            points: pointsToSend,
          },
        });
      });
    }

    function scheduleStraightBroadcast(worldStart, worldEnd) {
      pendingStraightUpdate.current = { start: worldStart, end: worldEnd };
      if (rafId.current) return;
      rafId.current = requestAnimationFrame(() => {
        rafId.current = null;
        if (!pendingStraightUpdate.current) return;
        const { start, end } = pendingStraightUpdate.current;
        pendingStraightUpdate.current = null;
        channelRef.current?.send({
          type: "broadcast",
          event: "stroke-straight",
          payload: {
            strokeKey: `${clientId.current}-${currentStrokeId.current}`,
            start,
            end,
          },
        });
      });
    }

    function scheduleShapeBroadcast(worldPoints) {
      pendingShapeUpdate.current = worldPoints;
      if (rafId.current) return;
      rafId.current = requestAnimationFrame(() => {
        rafId.current = null;
        if (!pendingShapeUpdate.current) return;
        const points = pendingShapeUpdate.current;
        pendingShapeUpdate.current = null;
        channelRef.current?.send({
          type: "broadcast",
          event: "stroke-shape",
          payload: {
            strokeKey: `${clientId.current}-${currentStrokeId.current}`,
            points,
          },
        });
      });
    }

    function scheduleGridBroadcast(grid) {
      pendingGridUpdate.current = grid;
      if (gridRafId.current) return;
      gridRafId.current = requestAnimationFrame(() => {
        gridRafId.current = null;
        if (!pendingGridUpdate.current) return;
        const g = pendingGridUpdate.current;
        pendingGridUpdate.current = null;
        channelRef.current?.send({ type: "broadcast", event: "grid-set", payload: { grid: g } });
      });
    }

    function scheduleTextMoveBroadcast(textId, x, y) {
      pendingTextMoveUpdate.current = { textId, x, y };
      if (textMoveRafId.current) return;
      textMoveRafId.current = requestAnimationFrame(() => {
        textMoveRafId.current = null;
        if (!pendingTextMoveUpdate.current) return;
        const payload = pendingTextMoveUpdate.current;
        pendingTextMoveUpdate.current = null;
        channelRef.current?.send({ type: "broadcast", event: "text-move", payload });
      });
    }

    function finalizeStroke(strokeId) {
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      if (pendingBroadcastPoints.current.length > 0 && strokeId) {
        const pointsToSend = pendingBroadcastPoints.current;
        pendingBroadcastPoints.current = [];
        channelRef.current?.send({
          type: "broadcast",
          event: "stroke-points",
          payload: { strokeKey: `${clientId.current}-${strokeId}`, points: pointsToSend },
        });
      }
      if (pendingStraightUpdate.current && strokeId) {
        const { start, end } = pendingStraightUpdate.current;
        pendingStraightUpdate.current = null;
        channelRef.current?.send({
          type: "broadcast",
          event: "stroke-straight",
          payload: { strokeKey: `${clientId.current}-${strokeId}`, start, end },
        });
      }
      if (pendingShapeUpdate.current && strokeId) {
        const points = pendingShapeUpdate.current;
        pendingShapeUpdate.current = null;
        channelRef.current?.send({
          type: "broadcast",
          event: "stroke-shape",
          payload: { strokeKey: `${clientId.current}-${strokeId}`, points },
        });
      }
      if (strokeId) {
        channelRef.current?.send({
          type: "broadcast",
          event: "stroke-end",
          payload: { strokeKey: `${clientId.current}-${strokeId}` },
        });
      }
    }

    function ingestPoint(screenPt, timeMs) {
      const gapPoints = lastRawScreenPos.current
        ? interpolateGap(lastRawScreenPos.current, screenPt, INTERP_MAX_STEP)
        : [];
      const isEraser = currentStroke.current.tool === "eraser";

      for (const gp of gapPoints) {
        const gwp = screenToWorld(gp);
        if (isEraser) {
          const gWidth = currentStroke.current.width * eraserSpeedMultiplier.current;
          currentStroke.current.points.push({ ...gwp, w: gWidth });
          pendingBroadcastPoints.current.push({ ...gwp, w: gWidth });
        } else {
          currentStroke.current.points.push(gwp);
          pendingBroadcastPoints.current.push(gwp);
        }
      }

      const wp = screenToWorld(screenPt);

      if (isEraser) {
        const dt = Math.max(1, timeMs - eraserLastPointTime.current);
        const dist = eraserLastScreenPos.current ? distance(screenPt, eraserLastScreenPos.current) : 0;
        const speed = dist / dt;
        const targetMultiplier = 1 + Math.min(ERASER_MAX_BOOST, speed * ERASER_SENSITIVITY);
        eraserSpeedMultiplier.current +=
          (targetMultiplier - eraserSpeedMultiplier.current) * ERASER_SMOOTHING;
        eraserLastPointTime.current = timeMs;
        eraserLastScreenPos.current = screenPt;

        const pointWidth = currentStroke.current.width * eraserSpeedMultiplier.current;
        currentStroke.current.points.push({ ...wp, w: pointWidth });
        pendingBroadcastPoints.current.push({ ...wp, w: pointWidth });
      } else {
        currentStroke.current.points.push(wp);
        pendingBroadcastPoints.current.push(wp);
      }

      lastRawScreenPos.current = screenPt;
    }

    function commitFinishedStroke(finished) {
      setStrokes((prev) => [...prev, finished]);
      myStrokeStack.current.push({ kind: "stroke", id: finished.id });
      myRedoStack.current = [];
      setMyUndoAvailable(true);
      setMyRedoAvailable(false);
      insertStroke(finished);
    }

    function cancelActiveDrawing() {
      if (!isDrawing.current) return;
      isDrawing.current = false;
      const finished = currentStroke.current;
      const strokeId = currentStrokeId.current;
      currentStroke.current = null;
      currentStrokeId.current = null;
      activePointerId.current = null;
      activePointerType.current = null;
      activeCompassParams.current = null;
      touchDrivenStrokeActive.current = false;

      finalizeStroke(strokeId);

      if (finished && finished.points.length > 1) {
        commitFinishedStroke(finished);
      }
    }

    function beginPanZoom() {
      const pts = Array.from(touchPoints.current.values());
      if (pts.length < 2) return;
      const [p1, p2] = pts;
      const c = centroid(p1, p2);
      panZoomState.current = {
        initialDistance: distance(p1, p2),
        initialScale: scaleRef.current,
        worldAnchor: screenToWorld(c),
      };
    }

    function updatePanZoom() {
      const pz = panZoomState.current;
      if (!pz) return;
      const pts = Array.from(touchPoints.current.values());
      if (pts.length < 2) return;
      const [p1, p2] = pts;
      const c = centroid(p1, p2);
      const dist = distance(p1, p2);
      const rawScale = pz.initialScale * (dist / pz.initialDistance);
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, rawScale));
      panRef.current = {
        x: c.x - pz.worldAnchor.x * newScale,
        y: c.y - pz.worldAnchor.y * newScale,
      };
      scaleRef.current = newScale;
      setZoomPercent(Math.round(newScale * 100));
      fullRedraw();
    }

    function handleWheel(e) {
      e.preventDefault();
      const screenPos = getPos(e);

      if (e.ctrlKey) {
        const zoomFactor = Math.exp(-e.deltaY * 0.01);
        const worldPos = screenToWorld(screenPos);
        const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scaleRef.current * zoomFactor));
        panRef.current = {
          x: screenPos.x - worldPos.x * newScale,
          y: screenPos.y - worldPos.y * newScale,
        };
        scaleRef.current = newScale;
        setZoomPercent(Math.round(newScale * 100));
      } else {
        panRef.current = {
          x: panRef.current.x - e.deltaX,
          y: panRef.current.y - e.deltaY,
        };
      }
      fullRedraw();
    }

    function sampleArc(center, radius, startAngle, sweep) {
      const stepAngle = Math.PI / 90;
      const steps = Math.max(1, Math.ceil(Math.abs(sweep) / stepAngle));
      const points = [];
      for (let i = 0; i <= steps; i++) {
        const a = startAngle + (sweep * i) / steps;
        const screenPt = {
          x: center.x + Math.cos(a) * radius,
          y: center.y + Math.sin(a) * radius,
        };
        points.push(screenToWorld(screenPt));
      }
      return points;
    }

    function handleGridPointerDown(pos) {
      const grid = gridConfigRef.current;

      if (!grid) {
        const worldPos = screenToWorld(pos);
        const defaultWorldSize = 300 / scaleRef.current;
        const newGrid = {
          x: worldPos.x - defaultWorldSize / 2,
          y: worldPos.y - defaultWorldSize / 2,
          size: defaultWorldSize,
          cols: 10,
        };
        gridConfigRef.current = newGrid;
        fullRedraw();
        scheduleGridBroadcast(newGrid);
        return;
      }

      const topLeftScreen = worldToScreen({ x: grid.x, y: grid.y });
      const bottomRightScreen = worldToScreen({ x: grid.x + grid.size, y: grid.y + grid.size });
      const nearCorner = distance(pos, bottomRightScreen) < 24;
      const inBounds =
        pos.x >= topLeftScreen.x - 10 && pos.x <= bottomRightScreen.x + 10 &&
        pos.y >= topLeftScreen.y - 10 && pos.y <= bottomRightScreen.y + 10;

      if (nearCorner) {
        gridDragMode.current = "resize";
        gridDragStart.current = { pos, orig: { ...grid } };
      } else if (inBounds) {
        gridDragMode.current = "move";
        gridDragStart.current = { pos, orig: { ...grid } };
      }
    }

    function handleGridPointerMove(pos) {
      const { pos: startPos, orig } = gridDragStart.current;
      const dxWorld = (pos.x - startPos.x) / scaleRef.current;
      const dyWorld = (pos.y - startPos.y) / scaleRef.current;

      let updated;
      if (gridDragMode.current === "move") {
        updated = { ...orig, x: orig.x + dxWorld, y: orig.y + dyWorld };
      } else {
        const newSize = Math.max(40 / scaleRef.current, orig.size + Math.max(dxWorld, dyWorld));
        updated = { ...orig, size: newSize };
      }
      gridConfigRef.current = updated;
      fullRedraw();
      scheduleGridBroadcast(updated);
    }

    function openTextEditor(worldPos) {
      const id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2);
      const info = { id, x: worldPos.x, y: worldPos.y, color: colorRef.current, fontSize: 24 };
      editingTextRef.current = info;
      setEditingText(info);
    }

    function handlePointerDown(e) {
      const pos = getPos(e);

      if (e.pointerType === "touch") {
        touchPoints.current.set(e.pointerId, pos);
      }

      if (touchPoints.current.size >= 2) {
        cancelActiveDrawing();
        movingTextRef.current = null;
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
        beginPanZoom();
        return;
      }

      if (panToolActiveRef.current) {
        panDragActive.current = true;
        panDragStart.current = { pos, origPan: { ...panRef.current } };
        canvas.setPointerCapture(e.pointerId);
        return;
      }

      if (gridToolActiveRef.current) {
        canvas.setPointerCapture(e.pointerId);
        handleGridPointerDown(pos);
        return;
      }

      if (isDrawing.current) {
        if (e.pointerType === "touch") touchPoints.current.delete(e.pointerId);
        return;
      }

      if (toolRef.current === "text") {
        const worldPos = screenToWorld(pos);
        const hit = hitTestText(worldPos);
        if (hit) {
          movingTextRef.current = { id: hit.id, startScreenPos: pos, origX: hit.x, origY: hit.y };
          canvas.setPointerCapture(e.pointerId);
          return;
        }
        openTextEditor(worldPos);
        return;
      }

      if (
        e.pointerType === "pen" &&
        isMobileRef.current &&
        !pencilTipCheckedRef.current
      ) {
        pencilTipCheckedRef.current = true;
        try {
          if (!window.localStorage.getItem("whiteboard_scribble_tip_dismissed")) {
            setShowPencilTip(true);
          }
        } catch (err) {}
      }

      isDrawing.current = true;
      activePointerId.current = e.pointerId;
      activePointerType.current = e.pointerType;
      strokeScreenStart.current = pos;
      lastRawScreenPos.current = pos;

      const t = toolRef.current;
      const strokeId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2);
      currentStrokeId.current = strokeId;

      let firstWorldPoint;

      if (compassActiveRef.current) {
        const center = { ...compassCenterRef.current };
        const radius = compassRadiusRef.current;
        activeCompassParams.current = { center, radius };
        const startAngle = Math.atan2(pos.y - center.y, pos.x - center.x);
        compassStartAngle.current = startAngle;
        compassCumulativeAngle.current = 0;
        compassLastRawAngle.current = startAngle;
        firstWorldPoint = screenToWorld({
          x: center.x + Math.cos(startAngle) * radius,
          y: center.y + Math.sin(startAngle) * radius,
        });
      } else {
        firstWorldPoint = screenToWorld(pos);
      }

      const baseWidth = widthForTool(t, widthRef.current);

      if (t === "eraser") {
        eraserSpeedMultiplier.current = 1;
        eraserLastPointTime.current = e.timeStamp;
        eraserLastScreenPos.current = pos;
      }

      currentStroke.current = {
        id: strokeId,
        tool: t,
        color: colorRef.current,
        width: baseWidth,
        opacity: opacityForTool(t),
        points: [t === "eraser" ? { ...firstWorldPoint, w: baseWidth } : firstWorldPoint],
      };
      canvas.setPointerCapture(e.pointerId);

      touchDrivenStrokeActive.current =
        isMobileRef.current && !compassActiveRef.current && !rulerActiveRef.current;

      channelRef.current?.send({
        type: "broadcast",
        event: "stroke-start",
        payload: {
          strokeKey: `${clientId.current}-${strokeId}`,
          strokeId,
          tool: currentStroke.current.tool,
          color: currentStroke.current.color,
          width: currentStroke.current.width,
          opacity: currentStroke.current.opacity,
          point: firstWorldPoint,
        },
      });
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
        panRef.current = {
          x: panDragStart.current.origPan.x + dx,
          y: panDragStart.current.origPan.y + dy,
        };
        fullRedraw();
        return;
      }

      if (gridDragMode.current) {
        handleGridPointerMove(getPos(e));
        return;
      }

      if (movingTextRef.current) {
        const pos = getPos(e);
        const dxWorld = (pos.x - movingTextRef.current.startScreenPos.x) / scaleRef.current;
        const dyWorld = (pos.y - movingTextRef.current.startScreenPos.y) / scaleRef.current;
        const newX = movingTextRef.current.origX + dxWorld;
        const newY = movingTextRef.current.origY + dyWorld;
        movingTextRef.current.lastX = newX;
        movingTextRef.current.lastY = newY;
        const textId = movingTextRef.current.id;
        setTexts((prev) => prev.map((t) => (t.id === textId ? { ...t, x: newX, y: newY } : t)));
        scheduleTextMoveBroadcast(textId, newX, newY);
        return;
      }

      if (e.pointerId !== activePointerId.current) return;
      if (!isDrawing.current || !currentStroke.current) return;

      const screenPos = getPos(e);

      if (activeCompassParams.current) {
        const { center, radius } = activeCompassParams.current;
        const rawAngle = Math.atan2(screenPos.y - center.y, screenPos.x - center.x);
        const delta = angleDelta(compassLastRawAngle.current, rawAngle);
        compassLastRawAngle.current = rawAngle;
        let cumulative = compassCumulativeAngle.current + delta;
        cumulative = Math.max(-2 * Math.PI, Math.min(2 * Math.PI, cumulative));
        compassCumulativeAngle.current = cumulative;

        const worldPoints = sampleArc(center, radius, compassStartAngle.current, cumulative);
        currentStroke.current.points = worldPoints;
        fullRedraw();
        scheduleShapeBroadcast(worldPoints);
        return;
      }

      if (rulerActiveRef.current) {
        const projectedScreen = projectOntoAngle(strokeScreenStart.current, screenPos, rulerAngleRef.current);
        const worldStart = screenToWorld(strokeScreenStart.current);
        const worldEnd = screenToWorld(projectedScreen);
        currentStroke.current.points = [worldStart, worldEnd];
        fullRedraw();
        scheduleStraightBroadcast(worldStart, worldEnd);
        return;
      }

      if (e.shiftKey) {
        const worldStart = screenToWorld(strokeScreenStart.current);
        const worldEnd = screenToWorld(screenPos);
        currentStroke.current.points = [worldStart, worldEnd];
        fullRedraw();
        scheduleStraightBroadcast(worldStart, worldEnd);
        return;
      }

      if (touchDrivenStrokeActive.current) return;

      const coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      const eventsToProcess = coalesced.length > 0 ? coalesced : [e];

      const before = currentStroke.current.points.length;
      for (const ev of eventsToProcess) {
        const sp = getPos(ev);
        const t = ev.timeStamp || performance.now();
        ingestPoint(sp, t);
      }
      const newCount = currentStroke.current.points.length - before;

      drawNewSegment(ctxRef.current, currentStroke.current, newCount);
      scheduleBroadcastFlush();
    }

    function handleTouchMove(e) {
      if (!touchDrivenStrokeActive.current) return;
      if (!isDrawing.current || !currentStroke.current) return;
      e.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const before = currentStroke.current.points.length;
      const t = e.timeStamp || performance.now();

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        const sp = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
        ingestPoint(sp, t);
      }

      const newCount = currentStroke.current.points.length - before;
      drawNewSegment(ctxRef.current, currentStroke.current, newCount);
      scheduleBroadcastFlush();
    }

    function handlePointerUp(e) {
      if (e.pointerType === "touch") {
        touchPoints.current.delete(e.pointerId);
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
      }

      if (panZoomState.current) {
        if (touchPoints.current.size < 2) {
          panZoomState.current = null;
        }
        return;
      }

      if (panDragActive.current) {
        panDragActive.current = false;
        panDragStart.current = null;
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
        return;
      }

      if (gridDragMode.current) {
        gridDragMode.current = null;
        gridDragStart.current = null;
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
        saveGrid();
        return;
      }

      if (movingTextRef.current) {
        const { id, lastX, lastY, origX, origY } = movingTextRef.current;
        const finalX = lastX ?? origX;
        const finalY = lastY ?? origY;
        movingTextRef.current = null;
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
        supabase.from("texts").update({ x: finalX, y: finalY }).eq("id", id).then(({ error }) => {
          if (error) console.error("Error saving text position:", error);
        });
        return;
      }

      if (e.pointerId !== activePointerId.current) return;
      if (!isDrawing.current) return;
      isDrawing.current = false;
      activePointerId.current = null;
      activePointerType.current = null;
      activeCompassParams.current = null;
      touchDrivenStrokeActive.current = false;

      const finished = currentStroke.current;
      const strokeId = currentStrokeId.current;
      currentStroke.current = null;
      currentStrokeId.current = null;

      finalizeStroke(strokeId);

      if (finished && finished.points.length > 1) {
        commitFinishedStroke(finished);
      }
    }

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    if (isMobileRef.current) {
      canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    }

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
      canvas.removeEventListener("wheel", handleWheel);
      if (isMobileRef.current) {
        canvas.removeEventListener("touchmove", handleTouchMove);
      }
    };
  }, []);

  useEffect(() => {
    if (ctxRef.current) fullRedraw();
  }, [strokes, texts]);

  function handleUndo() {
    const last = myStrokeStack.current[myStrokeStack.current.length - 1];
    if (!last) return;

    if (last.kind === "stroke") {
      const strokeToUndo = strokes.find((s) => s.id === last.id);
      if (!strokeToUndo) return;
      myStrokeStack.current.pop();
      myRedoStack.current.push({ kind: "stroke", data: strokeToUndo });
      setStrokes((prev) => prev.filter((s) => s.id !== last.id));
      channelRef.current?.send({
        type: "broadcast",
        event: "stroke-remove",
        payload: { strokeId: last.id },
      });
      supabase.from("strokes").delete().eq("id", last.id).then(({ error }) => {
        if (error) console.error("Error deleting stroke:", error);
      });
    } else {
      const textToUndo = texts.find((t) => t.id === last.id);
      if (!textToUndo) return;
      myStrokeStack.current.pop();
      myRedoStack.current.push({ kind: "text", data: textToUndo });
      setTexts((prev) => prev.filter((t) => t.id !== last.id));
      channelRef.current?.send({
        type: "broadcast",
        event: "text-remove",
        payload: { textId: last.id },
      });
      supabase.from("texts").delete().eq("id", last.id).then(({ error }) => {
        if (error) console.error("Error deleting text:", error);
      });
    }

    setMyUndoAvailable(myStrokeStack.current.length > 0);
    setMyRedoAvailable(true);
  }

  function handleRedo() {
    const last = myRedoStack.current[myRedoStack.current.length - 1];
    if (!last) return;
    myRedoStack.current.pop();

    if (last.kind === "stroke") {
      setStrokes((prev) => [...prev, last.data]);
      myStrokeStack.current.push({ kind: "stroke", id: last.data.id });
      channelRef.current?.send({
        type: "broadcast",
        event: "stroke-restore",
        payload: { stroke: last.data },
      });
      insertStroke(last.data);
    } else {
      setTexts((prev) => [...prev, last.data]);
      myStrokeStack.current.push({ kind: "text", id: last.data.id });
      channelRef.current?.send({
        type: "broadcast",
        event: "text-add",
        payload: { text: last.data },
      });
      insertText(last.data);
    }

    setMyRedoAvailable(myRedoStack.current.length > 0);
    setMyUndoAvailable(true);
  }

  function handleClear() {
    if (strokes.length === 0 && texts.length === 0) return;
    if (window.confirm("Clear the whole board for everyone? This can't be undone.")) {
      performClear();
      myStrokeStack.current = [];
      myRedoStack.current = [];
      setMyUndoAvailable(false);
      setMyRedoAvailable(false);
      channelRef.current?.send({ type: "broadcast", event: "clear", payload: {} });
      supabase.from("strokes").delete().eq("board_id", boardId).then(({ error }) => {
        if (error) console.error("Error clearing strokes:", error);
      });
      supabase.from("texts").delete().eq("board_id", boardId).then(({ error }) => {
        if (error) console.error("Error clearing texts:", error);
      });
    }
  }

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden" }}>
      <a
        href="/"
        style={{
          position: "fixed",
          top: "max(16px, env(safe-area-inset-top))",
          left: 16,
          zIndex: 10,
          width: 40,
          height: 40,
          borderRadius: "50%",
          background: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 1px 6px rgba(0,0,0,0.15)",
          color: "#333",
        }}
      >
        <ArrowLeft size={18} />
      </a>
      <canvas
        ref={canvasRef}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          display: "block",
          touchAction: "none",
          background: "#ffffff",
          WebkitUserSelect: "none",
          userSelect: "none",
          WebkitTouchCallout: "none",
          WebkitTapHighlightColor: "transparent",
          cursor: panToolActive ? "grab" : "default",
        }}
      />
      {editingText && (
        <textarea
          ref={textareaElRef}
          defaultValue=""
          onBlur={handleTextBlur}
          onKeyDown={(e) => {
            if (e.key === "Escape") e.target.blur();
          }}
          onInput={(e) => {
            e.target.style.height = "auto";
            e.target.style.height = e.target.scrollHeight + "px";
          }}
          style={{
            position: "fixed",
            zIndex: 15,
            border: "1.5px dashed #1E88E5",
            background: "rgba(255,255,255,0.9)",
            outline: "none",
            resize: "none",
            padding: 2,
            minWidth: 60,
            minHeight: 30,
            fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
            color: editingText.color,
            lineHeight: 1.3,
            overflow: "hidden",
          }}
        />
      )}
      {rulerActive && (
        <RulerOverlay
          angle={rulerAngle}
          setAngle={setRulerAngle}
          position={rulerPos}
          setPosition={setRulerPos}
        />
      )}
      {compassActive && (
        <CompassOverlay
          center={compassCenter}
          setCenter={setCompassCenter}
          radius={compassRadius}
          setRadius={setCompassRadius}
          angle={compassAngle}
          setAngle={setCompassAngle}
        />
      )}
      {showPencilTip && (
        <div
          style={{
            position: "fixed",
            top: "max(16px, env(safe-area-inset-top))",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 30,
            maxWidth: "min(92vw, 380px)",
            background: "#1a1a1a",
            color: "#fff",
            borderRadius: 12,
            padding: "12px 14px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            fontSize: 13,
            lineHeight: 1.4,
          }}
        >
          <span style={{ flex: 1 }}>
            <strong>Tip for the smoothest drawing:</strong> turn off Scribble —
            Settings → Apple Pencil → Scribble → off. iPadOS intercepts some
            Pencil strokes for handwriting recognition otherwise, even here.
          </span>
          <button
            onClick={handleDismissPencilTip}
            style={{
              border: "none",
              background: "rgba(255,255,255,0.15)",
              color: "#fff",
              borderRadius: 8,
              padding: "4px 8px",
              fontSize: 12,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            Got it
          </button>
        </div>
      )}
      <ZoomMenu zoomPercent={zoomPercent} onSelect={handleSetZoom} />
      <Toolbar
        tool={tool}
        setTool={setTool}
        color={color}
        setColor={setColor}
        strokeWidth={strokeWidth}
        setStrokeWidth={setStrokeWidth}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onClear={handleClear}
        canUndo={myUndoAvailable}
        canRedo={myRedoAvailable}
        isOwner={isOwner}
        onCopyLink={handleCopyLink}
        onEndSession={handleEndSession}
        saveStatus={saveStatus}
        rulerActive={rulerActive}
        onToggleRuler={handleToggleRuler}
        onResetView={handleResetView}
        compassActive={compassActive}
        onToggleCompass={handleToggleCompass}
        gridToolActive={gridToolActive}
        onToggleGrid={handleToggleGrid}
        onRemoveGrid={handleRemoveGrid}
        panToolActive={panToolActive}
        onTogglePan={handleTogglePan}
      />
    </div>
  );
}