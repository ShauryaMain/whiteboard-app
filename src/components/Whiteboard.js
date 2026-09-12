"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import Toolbar from "./Toolbar";
import RulerOverlay from "./RulerOverlay";
import CompassOverlay from "./CompassOverlay";
import ZoomMenu from "./ZoomMenu";
import ReferencePane from "./ReferencePane";
import Calculator from "./Calculator";
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
  const boardPaneRef = useRef(null);
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
  const resizingTextRef = useRef(null);
  const rotatingTextRef = useRef(null);
  const lastTextTapRef = useRef(null);
  const pendingTextMoveUpdate = useRef(null);
  const textMoveRafId = useRef(null);
  const pendingTextTransformUpdate = useRef(null);
  const textTransformRafId = useRef(null);
  const selectedTextIdRef = useRef(null);

  // Mirrors referenceDoc state so the channel-setup effect (which only
  // runs once on mount) can always read the current value when responding
  // to a late-joiner's "is anything loaded?" request.
  const referenceDocRef = useRef(null);
  const myReferenceStrokeStack = useRef([]);

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
  const [calculatorActive, setCalculatorActive] = useState(false);
  const [calculatorPos, setCalculatorPos] = useState({ x: 300, y: 200 });
  const [zoomPercent, setZoomPercent] = useState(100);
  const [gridToolActive, setGridToolActive] = useState(false);
  const [canUseReferencePane, setCanUseReferencePane] = useState(false);
  const [panToolActive, setPanToolActive] = useState(false);
  const [showPencilTip, setShowPencilTip] = useState(false);
  const [referenceStrokes, setReferenceStrokes] = useState([]);
  const [referenceTool, setReferenceTool] = useState("pen");
  const [referenceColor, setReferenceColor] = useState("#E53935");
  const [myReferenceUndoAvailable, setMyReferenceUndoAvailable] = useState(false);
  const [editingText, setEditingText] = useState(null);
  const [selectedTextId, setSelectedTextId] = useState(null);
  const [referenceDoc, setReferenceDoc] = useState(null);
  const [referenceUploadStatus, setReferenceUploadStatus] = useState("");
  const referenceFileInputRef = useRef(null);

  useEffect(() => { strokesRef.current = strokes; }, [strokes]);
  useEffect(() => { textsRef.current = texts; }, [texts]);
  useEffect(() => { selectedTextIdRef.current = selectedTextId; }, [selectedTextId]);
  useEffect(() => {
    if (tool !== "select") setSelectedTextId(null);
  }, [tool]);
  useEffect(() => {
    if (selectedTextId && !texts.some((t) => t.id === selectedTextId)) {
      setSelectedTextId(null);
    }
  }, [texts, selectedTextId]);
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
  useEffect(() => { referenceDocRef.current = referenceDoc; }, [referenceDoc]);

  // Reference docs are desktop/tablet only for now — a true side-by-side
  // split isn't usable on a narrow phone screen. Re-checked on resize so
  // rotating a tablet or resizing a browser window updates it live.
  useEffect(() => {
    function checkWidth() {
      setCanUseReferencePane(window.innerWidth >= 680);
    }
    checkWidth();
    window.addEventListener("resize", checkWidth);
    return () => window.removeEventListener("resize", checkWidth);
  }, []);

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

  // The whiteboard's own visible size — not always the full window, since
  // a reference-doc pane can now take up part of the screen alongside it.
  function getPaneSize() {
    const el = boardPaneRef.current;
    if (!el) return { width: window.innerWidth, height: window.innerHeight };
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  function repositionEditingTextarea() {
    const info = editingTextRef.current;
    const el = textareaElRef.current;
    if (!info || !el) return;
    const screenPos = worldToScreen({ x: info.x, y: info.y });
    el.style.left = screenPos.x + "px";
    el.style.top = screenPos.y + "px";
    el.style.width = info.width * scaleRef.current + "px";
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

  // Word-wraps text within maxWidth, respecting explicit line breaks too
  // — shared by rendering, hit-testing, and box-height calculations so
  // they all agree on exactly the same layout.
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

  function getTextLineHeight(t) {
    return t.fontSize * 1.3;
  }

  function getTextBoxHeight(ctx, t) {
    const lines = wrapTextLines(ctx, t.text, t.fontSize, t.width);
    return lines.length * getTextLineHeight(t);
  }

  function getTextCenter(ctx, t) {
    return { x: t.x + t.width / 2, y: t.y + getTextBoxHeight(ctx, t) / 2 };
  }

  // Un-rotates a world point around a text box's own center, so a
  // rotated box can still be hit-tested with ordinary axis-aligned math
  // — the standard technique for interacting with rotated shapes.
  function toLocalUnrotated(worldPos, center, rotation) {
    if (!rotation) return worldPos;
    const dx = worldPos.x - center.x;
    const dy = worldPos.y - center.y;
    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);
    return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
  }

  function getTextHandlePositions(t, boxHeight) {
    const scale = scaleRef.current;
    return {
      resize: { x: t.x + t.width, y: t.y + boxHeight },
      rotate: { x: t.x + t.width / 2, y: t.y - 30 / scale },
    };
  }

  function drawTexts(ctx, textsArr, selectedId) {
    for (const t of textsArr) {
      const lines = wrapTextLines(ctx, t.text, t.fontSize, t.width);
      const lineHeight = getTextLineHeight(t);
      const boxHeight = lines.length * lineHeight;
      const center = { x: t.x + t.width / 2, y: t.y + boxHeight / 2 };
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

      if (t.id === selectedId) {
        const scale = scaleRef.current;
        ctx.strokeStyle = "rgba(30,136,229,0.7)";
        ctx.lineWidth = 1.5 / scale;
        ctx.setLineDash([4 / scale, 3 / scale]);
        ctx.strokeRect(t.x - 4, t.y - 4, t.width + 8, boxHeight + 8);
        ctx.setLineDash([]);

        const handles = getTextHandlePositions(t, boxHeight);

        ctx.strokeStyle = "rgba(30,136,229,0.7)";
        ctx.lineWidth = 1.5 / scale;
        ctx.beginPath();
        ctx.moveTo(t.x + t.width / 2, t.y);
        ctx.lineTo(handles.rotate.x, handles.rotate.y);
        ctx.stroke();

        ctx.fillStyle = "#1E88E5";
        ctx.beginPath();
        ctx.arc(handles.resize.x, handles.resize.y, 7 / scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(handles.rotate.x, handles.rotate.y, 7 / scale, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  // Checks whether a tap landed on the selected text's resize or rotate
  // handle specifically — checked before the general body hit-test.
  function hitTestTextHandle(ctx, t, worldPos) {
    const boxHeight = getTextBoxHeight(ctx, t);
    const center = getTextCenter(ctx, t);
    const local = toLocalUnrotated(worldPos, center, t.rotation || 0);
    const handles = getTextHandlePositions(t, boxHeight);
    const hitRadius = 14 / scaleRef.current;

    if (distance(local, handles.resize) < hitRadius) return "resize";
    if (distance(local, handles.rotate) < hitRadius) return "rotate";
    return null;
  }

  // Finds the topmost existing text box under a world-space point, if
  // any — accounts for rotation by un-rotating the tap point first.
  function hitTestText(worldPos) {
    const ctx = ctxRef.current;
    if (!ctx) return null;
    const arr = textsRef.current;
    for (let i = arr.length - 1; i >= 0; i--) {
      const t = arr[i];
      const boxHeight = getTextBoxHeight(ctx, t);
      const center = getTextCenter(ctx, t);
      const local = toLocalUnrotated(worldPos, center, t.rotation || 0);
      const pad = 6;
      if (
        local.x >= t.x - pad && local.x <= t.x + t.width + pad &&
        local.y >= t.y - pad && local.y <= t.y + boxHeight + pad
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
    const { width: paneW, height: paneH } = getPaneSize();
    ctx.clearRect(-pan.x / scale, -pan.y / scale, paneW / scale, paneH / scale);

    for (const stroke of strokesRef.current) drawStroke(ctx, stroke);
    for (const key in remoteStrokes.current) drawStroke(ctx, remoteStrokes.current[key]);
    if (currentStroke.current) drawStroke(ctx, currentStroke.current);
    ctx.globalAlpha = 1;

    drawTexts(ctx, textsRef.current, selectedTextIdRef.current);
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
      width: t.width,
      rotation: t.rotation || 0,
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
    const { width: paneW, height: paneH } = getPaneSize();
    const center = { x: paneW / 2, y: paneH / 2 };
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

      // .maybeSingle() (not .single()) so an empty result comes back as
      // null instead of throwing — a genuinely empty result can happen
      // transiently right after the access-grant RPC above, especially
      // under React's dev-mode double-effect invocation. One short retry
      // covers that without surfacing a scary error for what's usually
      // just a timing blip.
      async function fetchBoardRow() {
        const { data, error } = await supabase
          .from("boards")
          .select("grid_config, owner_id")
          .eq("id", boardId)
          .maybeSingle();
        return { data, error };
      }

      let { data: boardRow, error: boardError } = await fetchBoardRow();
      if (!boardError && !boardRow) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        ({ data: boardRow, error: boardError } = await fetchBoardRow());
      }

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
        .select("id, x, y, text, color, font_size, width, rotation")
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
            width: r.width || 240,
            rotation: r.rotation || 0,
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
        const { width, height } = getPaneSize();
        setRulerPos({ x: width / 2, y: height / 2 });
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
        const { width, height } = getPaneSize();
        setCompassCenter({ x: width / 2, y: height / 2 });
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

  function handleToggleCalculator() {
    setCalculatorActive((prev) => {
      const next = !prev;
      if (next) {
        const { width, height } = getPaneSize();
        setCalculatorPos({ x: Math.max(20, width / 2 - 150), y: Math.max(20, height / 2 - 220) });
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

  async function handleReferenceFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !isOwner) return;

    const allowedTypes = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      alert("Please choose a PDF, PNG, JPG, or WEBP file.");
      return;
    }
    const MAX_BYTES = 25 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      alert("That file is too large — please choose one under 25MB.");
      return;
    }

    setReferenceUploadStatus("Checking file…");

    let pageCount = 1;
    if (file.type === "application/pdf") {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        pageCount = pdfDoc.numPages;
      } catch (err) {
        console.error("Error reading PDF:", err);
        setReferenceUploadStatus("");
        alert("Couldn't read that PDF — it may be corrupted or password-protected.");
        return;
      }
      if (pageCount > 30) {
        setReferenceUploadStatus("");
        alert(`That PDF has ${pageCount} pages — please choose one with 30 pages or fewer.`);
        return;
      }
    }

    setReferenceUploadStatus("Uploading…");

    const path = `${boardId}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from("reference-docs")
      .upload(path, file, { contentType: file.type, upsert: false });

    if (uploadError) {
      console.error("Error uploading reference doc:", uploadError);
      setReferenceUploadStatus("");
      alert("Upload failed: " + uploadError.message);
      return;
    }

    const { data: urlData } = supabase.storage.from("reference-docs").getPublicUrl(path);

    const doc = {
      url: urlData.publicUrl,
      path,
      pageCount,
      fileType: file.type,
      fileName: file.name,
    };
    setReferenceDoc(doc);
    setReferenceUploadStatus("");
    setReferenceStrokes([]);
    myReferenceStrokeStack.current = [];
    setMyReferenceUndoAvailable(false);
    channelRef.current?.send({ type: "broadcast", event: "reference-set", payload: { doc } });
  }

  async function handleRemoveReferenceDoc() {
    if (!referenceDoc) return;
    if (!window.confirm("Remove this document? Any annotations on it will be lost.")) return;
    const path = referenceDoc.path;
    setReferenceDoc(null);
    setReferenceStrokes([]);
    myReferenceStrokeStack.current = [];
    setMyReferenceUndoAvailable(false);
    channelRef.current?.send({ type: "broadcast", event: "reference-remove", payload: {} });
    const { error } = await supabase.storage.from("reference-docs").remove([path]);
    if (error) console.error("Error removing reference doc:", error);
  }

  function handleReferenceToolClick() {
    if (referenceDoc) {
      handleRemoveReferenceDoc();
    } else {
      referenceFileInputRef.current?.click();
    }
  }

  function handleReferenceStrokeComplete(stroke) {
    setReferenceStrokes((prev) => [...prev, stroke]);
    myReferenceStrokeStack.current.push(stroke.id);
    setMyReferenceUndoAvailable(true);
    channelRef.current?.send({ type: "broadcast", event: "reference-stroke", payload: { stroke } });
  }

  function handleReferenceUndo() {
    const lastId = myReferenceStrokeStack.current.pop();
    if (!lastId) return;
    setReferenceStrokes((prev) => prev.filter((s) => s.id !== lastId));
    setMyReferenceUndoAvailable(myReferenceStrokeStack.current.length > 0);
    channelRef.current?.send({
      type: "broadcast",
      event: "reference-stroke-remove",
      payload: { strokeId: lastId },
    });
  }

  function handleDismissPencilTip() {
    setShowPencilTip(false);
    try {
      window.localStorage.setItem("whiteboard_scribble_tip_dismissed", "true");
    } catch (err) {}
  }

  function handleTextBlur(e) {
    const info = editingTextRef.current;
    const rawValue = e.target.value;
    const trimmedForCheck = rawValue.trim();
    editingTextRef.current = null;
    setEditingText(null);
    if (!info) return;

    if (info.isEditingExisting) {
      if (!trimmedForCheck) {
        // Cleared out entirely while editing — treat that as deleting it.
        setTexts((prev) => prev.filter((t) => t.id !== info.id));
        setSelectedTextId(null);
        channelRef.current?.send({ type: "broadcast", event: "text-remove", payload: { textId: info.id } });
        supabase.from("texts").delete().eq("id", info.id).then(({ error }) => {
          if (error) console.error("Error deleting text:", error);
        });
        return;
      }
      const updated = {
        id: info.id,
        x: info.x,
        y: info.y,
        text: rawValue,
        color: info.color,
        fontSize: info.fontSize,
        width: info.width,
        rotation: info.rotation,
      };
      setTexts((prev) => prev.map((t) => (t.id === info.id ? updated : t)));
      channelRef.current?.send({ type: "broadcast", event: "text-add", payload: { text: updated } });
      insertText(updated);
      fullRedraw();
      return;
    }

    if (!trimmedForCheck) return;

    const textObj = {
      id: info.id,
      x: info.x,
      y: info.y,
      text: rawValue,
      color: info.color,
      fontSize: info.fontSize,
      width: info.width,
      rotation: info.rotation,
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

    if (editingText.isEditingExisting) {
      const existing = textsRef.current.find((t) => t.id === editingText.id);
      const el = textareaElRef.current;
      if (existing && el) {
        el.value = existing.text;
        el.style.height = "auto";
        el.style.height = el.scrollHeight + "px";
      }
    }

    // The click that created this text box is still being resolved by the
    // browser (mousedown -> mouseup -> click) when this effect first runs.
    // Focusing synchronously here loses the race against the browser's own
    // default focus handling for that click, which blurs us again almost
    // immediately. Deferring to the next tick lets that resolve first.
    const timerId = setTimeout(() => {
      const el = textareaElRef.current;
      el?.focus();
      if (editingText.isEditingExisting && el) {
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
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
      setTexts((prev) => {
        const exists = prev.some((t) => t.id === payload.text.id);
        return exists
          ? prev.map((t) => (t.id === payload.text.id ? payload.text : t))
          : [...prev, payload.text];
      });
    });

    channel.on("broadcast", { event: "text-remove" }, ({ payload }) => {
      setTexts((prev) => prev.filter((t) => t.id !== payload.textId));
    });

    channel.on("broadcast", { event: "text-move" }, ({ payload }) => {
      setTexts((prev) =>
        prev.map((t) => (t.id === payload.textId ? { ...t, x: payload.x, y: payload.y } : t))
      );
    });

    channel.on("broadcast", { event: "text-transform" }, ({ payload }) => {
      const { textId, ...partial } = payload;
      setTexts((prev) => prev.map((t) => (t.id === textId ? { ...t, ...partial } : t)));
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

    channel.on("broadcast", { event: "reference-set" }, ({ payload }) => {
      setReferenceDoc(payload.doc);
      setReferenceStrokes([]);
      myReferenceStrokeStack.current = [];
      setMyReferenceUndoAvailable(false);
    });

    channel.on("broadcast", { event: "reference-remove" }, () => {
      setReferenceDoc(null);
      setReferenceStrokes([]);
      myReferenceStrokeStack.current = [];
      setMyReferenceUndoAvailable(false);
    });

    // A late-joining viewer has no database to query for the reference
    // doc (it's intentionally never persisted) — so instead they ask
    // whoever's already here, and whoever currently has one loaded
    // answers back.
    channel.on("broadcast", { event: "reference-request" }, () => {
      if (referenceDocRef.current) {
        channelRef.current?.send({
          type: "broadcast",
          event: "reference-set",
          payload: { doc: referenceDocRef.current },
        });
      }
    });

    channel.on("broadcast", { event: "reference-stroke" }, ({ payload }) => {
      setReferenceStrokes((prev) => [...prev, payload.stroke]);
    });

    channel.on("broadcast", { event: "reference-stroke-remove" }, ({ payload }) => {
      setReferenceStrokes((prev) => prev.filter((s) => s.id !== payload.strokeId));
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        channel.send({ type: "broadcast", event: "reference-request", payload: {} });
      }
    });
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
      const { width, height } = getPaneSize();
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      fullRedraw();
    }

    resizeCanvas();
    // A ResizeObserver on the pane itself (rather than a window resize
    // listener) also correctly catches the canvas needing to resize when
    // the reference-doc pane appears/disappears, not just when the
    // browser window itself changes size.
    const resizeObserver = new ResizeObserver(() => resizeCanvas());
    if (boardPaneRef.current) resizeObserver.observe(boardPaneRef.current);

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

    function scheduleTextTransformBroadcast(textId, partial) {
      pendingTextTransformUpdate.current = { textId, ...partial };
      if (textTransformRafId.current) return;
      textTransformRafId.current = requestAnimationFrame(() => {
        textTransformRafId.current = null;
        if (!pendingTextTransformUpdate.current) return;
        const payload = pendingTextTransformUpdate.current;
        pendingTextTransformUpdate.current = null;
        channelRef.current?.send({ type: "broadcast", event: "text-transform", payload });
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
      const info = {
        id,
        x: worldPos.x,
        y: worldPos.y,
        color: colorRef.current,
        fontSize: 24,
        width: 240,
        rotation: 0,
        isEditingExisting: false,
      };
      editingTextRef.current = info;
      setEditingText(info);
    }

    function openTextEditorForEdit(existingText) {
      const info = {
        id: existingText.id,
        x: existingText.x,
        y: existingText.y,
        color: existingText.color,
        fontSize: existingText.fontSize,
        width: existingText.width,
        rotation: existingText.rotation || 0,
        isEditingExisting: true,
      };
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

      if (toolRef.current === "select") {
        const worldPos = screenToWorld(pos);

        if (selectedTextIdRef.current) {
          const selectedText = textsRef.current.find((t) => t.id === selectedTextIdRef.current);
          if (selectedText) {
            const handleHit = hitTestTextHandle(ctxRef.current, selectedText, worldPos);
            if (handleHit === "resize") {
              const center = getTextCenter(ctxRef.current, selectedText);
              resizingTextRef.current = {
                id: selectedText.id,
                center,
                startDistance: Math.max(1, distance(center, worldPos)),
                origWidth: selectedText.width,
                origFontSize: selectedText.fontSize,
              };
              canvas.setPointerCapture(e.pointerId);
              return;
            }
            if (handleHit === "rotate") {
              const center = getTextCenter(ctxRef.current, selectedText);
              rotatingTextRef.current = {
                id: selectedText.id,
                center,
                startAngle: Math.atan2(worldPos.y - center.y, worldPos.x - center.x),
                origRotation: selectedText.rotation || 0,
              };
              canvas.setPointerCapture(e.pointerId);
              return;
            }
          }
        }

        const hit = hitTestText(worldPos);

        const now = Date.now();
        const isDoubleTap =
          hit &&
          lastTextTapRef.current &&
          lastTextTapRef.current.id === hit.id &&
          now - lastTextTapRef.current.time < 400;
        lastTextTapRef.current = hit ? { id: hit.id, time: now } : null;

        if (isDoubleTap) {
          setSelectedTextId(hit.id);
          openTextEditorForEdit(hit);
          return;
        }

        if (hit) {
          setSelectedTextId(hit.id);
          movingTextRef.current = { id: hit.id, startScreenPos: pos, origX: hit.x, origY: hit.y };
          canvas.setPointerCapture(e.pointerId);
        } else {
          setSelectedTextId(null);
        }
        return;
      }

      if (toolRef.current === "text") {
        openTextEditor(screenToWorld(pos));
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

      if (resizingTextRef.current) {
        const pos = getPos(e);
        const worldPos = screenToWorld(pos);
        const r = resizingTextRef.current;
        const currentDistance = distance(r.center, worldPos);
        const scaleFactor = Math.max(0.25, Math.min(6, currentDistance / r.startDistance));
        const newWidth = Math.max(60, r.origWidth * scaleFactor);
        const newFontSize = Math.max(8, r.origFontSize * scaleFactor);
        r.lastWidth = newWidth;
        r.lastFontSize = newFontSize;
        const textId = r.id;
        setTexts((prev) =>
          prev.map((t) => (t.id === textId ? { ...t, width: newWidth, fontSize: newFontSize } : t))
        );
        scheduleTextTransformBroadcast(textId, { width: newWidth, fontSize: newFontSize });
        return;
      }

      if (rotatingTextRef.current) {
        const pos = getPos(e);
        const worldPos = screenToWorld(pos);
        const r = rotatingTextRef.current;
        const currentAngle = Math.atan2(worldPos.y - r.center.y, worldPos.x - r.center.x);
        const newRotation = r.origRotation + (currentAngle - r.startAngle);
        r.lastRotation = newRotation;
        const textId = r.id;
        setTexts((prev) => prev.map((t) => (t.id === textId ? { ...t, rotation: newRotation } : t)));
        scheduleTextTransformBroadcast(textId, { rotation: newRotation });
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

      if (resizingTextRef.current) {
        const r = resizingTextRef.current;
        const finalWidth = r.lastWidth ?? r.origWidth;
        const finalFontSize = r.lastFontSize ?? r.origFontSize;
        resizingTextRef.current = null;
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
        supabase
          .from("texts")
          .update({ width: finalWidth, font_size: finalFontSize })
          .eq("id", r.id)
          .then(({ error }) => {
            if (error) console.error("Error saving text size:", error);
          });
        return;
      }

      if (rotatingTextRef.current) {
        const r = rotatingTextRef.current;
        const finalRotation = r.lastRotation ?? r.origRotation;
        rotatingTextRef.current = null;
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
        supabase.from("texts").update({ rotation: finalRotation }).eq("id", r.id).then(({ error }) => {
          if (error) console.error("Error saving text rotation:", error);
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
      resizeObserver.disconnect();
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

  const showReferencePane = canUseReferencePane && !!referenceDoc;

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", display: "flex" }}>
      {showReferencePane && (
        <div
          style={{
          width: "clamp(340px, 42%, 600px)",
            height: "100%",
            flexShrink: 0,
            borderRight: "1px solid #ddd",
            background: "#e8eaed",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              background: "#fff",
              borderBottom: "1px solid #eee",
              fontSize: 13,
              color: "#333",
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {referenceDoc.fileName}
            </span>
            {isOwner && (
              <button
                onClick={handleRemoveReferenceDoc}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#c62828",
                  fontSize: 12,
                  cursor: "pointer",
                  flexShrink: 0,
                  marginLeft: 10,
                }}
              >
                Remove
              </button>
            )}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ReferencePane
              doc={referenceDoc}
              strokes={referenceStrokes}
              onStrokeComplete={handleReferenceStrokeComplete}
              tool={referenceTool}
              setTool={setReferenceTool}
              color={referenceColor}
              setColor={setReferenceColor}
              canUndo={myReferenceUndoAvailable}
              onUndo={handleReferenceUndo}
            />
          </div>
        </div>
      )}

      <div
        ref={boardPaneRef}
        style={{
          position: "relative",
          flex: 1,
          height: "100%",
          overflow: "hidden",
          // A transform on this container makes it the "containing block"
          // for any position:fixed descendant inside it (toolbar, ruler,
          // zoom menu, etc.) instead of the full browser viewport — so all
          // of that UI automatically anchors to just this pane, with zero
          // changes needed inside those components themselves.
          transform: "translate(0, 0)",
        }}
      >
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
        {calculatorActive && (
          <Calculator
            position={calculatorPos}
            setPosition={setCalculatorPos}
            onClose={() => setCalculatorActive(false)}
          />
        )}
        {isOwner && (
          <input
            ref={referenceFileInputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            onChange={handleReferenceFileSelected}
            style={{ display: "none" }}
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
          canUseReferencePane={canUseReferencePane}
          hasReferenceDoc={!!referenceDoc}
          onReferenceToolClick={handleReferenceToolClick}
          referenceUploadStatus={referenceUploadStatus}
          calculatorActive={calculatorActive}
          onToggleCalculator={handleToggleCalculator}
        />
      </div>
    </div>
  );
}