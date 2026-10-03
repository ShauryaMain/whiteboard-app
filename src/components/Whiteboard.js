"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import Toolbar from "./Toolbar";
import RulerOverlay from "./RulerOverlay";
import CompassOverlay from "./CompassOverlay";
import ZoomMenu from "./ZoomMenu";
import SplitDivider from "./SplitDivider";
import PalmSafeButton from "./PalmSafeButton";
import { FileText, PanelLeftClose, PanelTopClose, Copy, Scissors, CopyPlus, Trash2, Moon } from "lucide-react";
import ReferencePane from "./ReferencePane";
import Calculator from "./Calculator";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { getStoredClassCode, clearClassCode } from "@/lib/classroomCode";
import TeacherStudentBoardView from "./TeacherStudentBoardView";
import GridToolModal from "./GridToolModal";
import SimEmbed from "./SimEmbed";
import SimEmbedModal from "./SimEmbedModal";
import { renderGrid, withDefaults as withGridDefaults, WORLD_UNITS_PER_CM } from "@/lib/gridRenderer";
import { browserCanOpenPdfs, loadPdfjs, PDF_UNSUPPORTED_MESSAGE } from "@/lib/loadPdfjs";
import { notePenActivity, msSincePenActivity } from "@/lib/penActivity";
import { applyBackground, normalizeBackground } from "@/lib/boardBackground";
import { loadCalcPosition } from "@/lib/calcMath";
import { detectScratchOut } from "@/lib/scratchOut";
import {
  createSyncTracker,
  fetchBoardContents,
  fetchBoardPart,
  fetchBoardSettings,
  forgetUnsaved,
  mergeServerList,
  noteList,
  nudgeRealtime,
  retryUnsaved,
  saveRow,
  setExistsCheck,
  subscribeUnsaved,
  syncSince,
  touchBoard,
  unsavedCount,
} from "@/lib/boardSync";
import { getServerIdlePaused, isIdlePaused, noteRemoteActivity, resumeFromIdle, startIdleWatch, subscribeIdle } from "@/lib/idleWatch";
import {
  subscribeInkPrefs, getEraserMode, getServerEraserMode, setEraserMode,
  getScribbleErase, getServerScribbleErase, setScribbleErase,
} from "@/lib/inkPrefs";
import { renderBoardThumbnail } from "@/lib/boardThumbnail";
import {
  emptySelection, selectionCount, selectionFromData, strokeBounds, imageBounds, textBounds, unionBounds,
  rectFromPoints, hitTestStrokes, hitTestImages, objectsInRect, translateStroke, translateText,
  translateImage, cloneObjects, chunkObjects, newId, writeInternalClipboard, readInternalClipboard,
  CLIPBOARD_MARKER, prepareImageFile, makeInlineImage, imageFilesFrom, writeClipboardMarker, readSystemClipboard,
} from "@/lib/boardObjects";
import chrome from "./StudioChrome.module.css";
import {
  subscribeViewport, getViewportWidth, getServerViewportWidth,
  subscribeRefFraction, getRefFractionSide, getRefFractionStacked, getServerRefFraction,
  setRefFraction, DEFAULT_REF_FRACTION,
} from "@/lib/layoutPrefs";
import {
  subscribePencilPrefs, getPencilOnly, getPenSeen, getServerPrefSnapshot,
  isPencilOnlyUndecided, setPencilOnly, markPenSeen,
} from "@/lib/pencilPrefs";

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const ERASER_MAX_BOOST = 2;
const ERASER_SENSITIVITY = 0.6;
const ERASER_SMOOTHING = 0.25;
const INTERP_MAX_STEP = 6;
// A "world unit" is a CSS pixel at 100% zoom. Browsers define a CSS pixel
// as 1/96 inch regardless of a device's actual physical pixel density —
// there's no reliable way to know a screen's true DPI from a browser, so
// this is the most accurate basis available (the same one print-to-PDF
// and other browser-native "physical size" features use).

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

export default function Whiteboard({ boardId, demo = false }) {
  const { user } = useAuth();
  // Only who's signed in matters here — not the session object, which is
  // replaced on every token refresh and whenever the tab regains focus.
  const userId = user ? user.id : null;
  const router = useRouter();
  const [isOwner, setIsOwner] = useState(false);
  const [liveClassCode, setLiveClassCode] = useState(null);
  const liveClassChannelRef = useRef(null);
  const [classRoster, setClassRoster] = useState([]); // [{studentId, name, joinedAt}]
  const [viewingStudent, setViewingStudent] = useState(null); // {studentId, name} | null
  const [showRoster, setShowRoster] = useState(false);

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
  const gridCellSizeCmRef = useRef(10);
  const toolBeforeGridRef = useRef("pen");

  const panToolActiveRef = useRef(false);
  const panDragActive = useRef(false);
  const toolBeforePanRef = useRef("pen");
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
  const referenceStrokesRef = useRef([]);
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
  const [gridCellSizeCm, setGridCellSizeCm] = useState(10);
  const [gridModalOpen, setGridModalOpen] = useState(false);
  const [gridModalInitialConfig, setGridModalInitialConfig] = useState(null);
  // Captured when the dialog opens (never read from a ref during render) so
  // the dialog can show/derive its "cell size" in terms of the zoom level
  // you're actually looking at right now, instead of an absolute physical
  // unit that has no relationship to what's comfortably visible.
  const [gridModalZoomScale, setGridModalZoomScale] = useState(1);

  // Embedded simulations (e.g. PhET links) placed on the board. `sims`
  // (state) only tracks WHICH boxes exist, so add/remove re-renders the
  // list — each box's actual on-screen position/size is driven
  // imperatively (see repositionSimEmbeds), same reasoning as the pan/zoom
  // system and the text-editing overlay: pan/scale are refs, not state.
  const [sims, setSims] = useState([]);
  const simsRef = useRef([]);
  // Page background ("blank" | "lined" | "graph" | "dots" | "iso"). The ref
  // is what fullRedraw reads; the state drives the Page menu.
  const [boardBackground, setBoardBackground] = useState("blank");
  const backgroundRef = useRef("blank");
  const backgroundCssKeyRef = useRef("");
  const pageBgRef = useRef(null);
  const simNodesRef = useRef({});
  const pendingSimBroadcast = useRef(null);
  const simBroadcastTimer = useRef(null);
  const [simModalOpen, setSimModalOpen] = useState(false);
  // Reference pane layout: side-by-side on wide screens, stacked (document
  // on top, board below) on narrower tablets / portrait, so it's usable on
  // every tablet instead of hidden below 680px as before.
  const viewportWidth = useSyncExternalStore(subscribeViewport, getViewportWidth, getServerViewportWidth);
  const canUseReferencePane = viewportWidth >= 560;
  const refStacked = viewportWidth < 900;
  const savedRefFractionSide = useSyncExternalStore(subscribeRefFraction, getRefFractionSide, getServerRefFraction);
  const savedRefFractionStacked = useSyncExternalStore(subscribeRefFraction, getRefFractionStacked, getServerRefFraction);
  const [refDragFraction, setRefDragFraction] = useState(null);
  const [refCollapsed, setRefCollapsed] = useState(false);
  const workAreaRef = useRef(null);
  const [panToolActive, setPanToolActive] = useState(false);
  const [showPencilTip, setShowPencilTip] = useState(false);
  const [showPencilOnlyNotice, setShowPencilOnlyNotice] = useState(false);
  const [boardName, setBoardName] = useState("");
  // Per-device stylus preferences (see pencilPrefs.js). The server render
  // always sees "off"; the saved values take over after hydration.
  const pencilOnly = useSyncExternalStore(subscribePencilPrefs, getPencilOnly, getServerPrefSnapshot);
  const penSeen = useSyncExternalStore(subscribePencilPrefs, getPenSeen, getServerPrefSnapshot);
  const eraserMode = useSyncExternalStore(subscribeInkPrefs, getEraserMode, getServerEraserMode);
  const scribbleErase = useSyncExternalStore(subscribeInkPrefs, getScribbleErase, getServerScribbleErase);
  const [referenceStrokes, setReferenceStrokes] = useState([]);
  const [referenceTool, setReferenceTool] = useState("pen");
  const [referenceColor, setReferenceColor] = useState("#E53935");
  const [myReferenceUndoAvailable, setMyReferenceUndoAvailable] = useState(false);
  const [editingText, setEditingText] = useState(null);
  const [selectedTextId, setSelectedTextId] = useState(null);
  // Phase 5: images on the board + multi-object selection.
  const [images, setImages] = useState([]);
  const imagesRef = useRef([]);
  const imageNodesRef = useRef({});
  const imageInputRef = useRef(null);
  const [selection, setSelectionState] = useState(emptySelection);
  const selectionRef = useRef(emptySelection());
  const selectionBoundsCacheRef = useRef(null);
  const selectionBoxElRef = useRef(null);
  const selectionBarElRef = useRef(null);
  const marqueeRef = useRef(null);
  const marqueeElRef = useRef(null);
  const groupMoveRef = useRef(null);
  const imageResizeRef = useRef(null);
  const pasteCountRef = useRef(0);
  const clipboardMarkedRef = useRef(false);
  const copiedOnThisPageRef = useRef(false);
  const imagesTableWarnedRef = useRef(false);
  const [boardNotice, setBoardNotice] = useState("");
  const noticeTimerRef = useRef(null);
  const rlsNoticeShownRef = useRef(false);
  // Whole-stroke eraser drag in progress: { pointerId, last, removed[] }
  const strokeEraseRef = useRef(null);
  // "Scribbled out … · Undo" note after a scratch-out
  const [scratchNotice, setScratchNotice] = useState(null);
  const scratchEntryRef = useRef(null);
  const scratchTimerRef = useRef(null);
  // Saves in flight / waiting to retry, and what's arrived or left the
  // screen recently — used to merge server data without wiping new work.
  const [sync] = useState(createSyncTracker);
  const unsaved = useSyncExternalStore(
    (listener) => subscribeUnsaved(sync, listener),
    () => unsavedCount(sync),
    () => 0
  );
  const idlePaused = useSyncExternalStore(subscribeIdle, isIdlePaused, getServerIdlePaused);
  // Live classes never pause (the teacher's board is the class's hub).
  const syncPaused = idlePaused && !liveClassCode;
  const [catchingUp, setCatchingUp] = useState(false);
  const connectedOnceRef = useRef(false);
  const catchUpRunningRef = useRef(false);
  const shortcutHandlersRef = useRef(null);
  // Boards-list preview picture (boards.thumbnail).
  const boardLoadedRef = useRef(false);
  const lastThumbRef = useRef(undefined);
  const thumbTimerRef = useRef(null);
  const thumbWarnedRef = useRef(false);
  const [referenceDoc, setReferenceDoc] = useState(null);
  const [referenceUploadStatus, setReferenceUploadStatus] = useState("");
  const referenceFileInputRef = useRef(null);

  useEffect(() => {
    strokesRef.current = strokes;
    noteList(sync, "strokes", strokes);
  }, [strokes]);
  useEffect(() => {
    textsRef.current = texts;
    noteList(sync, "texts", texts);
  }, [texts]);
  useEffect(() => {
    imagesRef.current = images;
    noteList(sync, "images", images);
  }, [images]);
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
  useEffect(() => { gridCellSizeCmRef.current = gridCellSizeCm; }, [gridCellSizeCm]);
  useEffect(() => { panToolActiveRef.current = panToolActive; }, [panToolActive]);
  useEffect(() => { referenceDocRef.current = referenceDoc; }, [referenceDoc]);
  useEffect(() => { referenceStrokesRef.current = referenceStrokes; }, [referenceStrokes]);

  useEffect(() => {
    if (!boardId) return;
    setLiveClassCode(getStoredClassCode(boardId));
  }, [boardId]);

  // Kept open for the whole time a class is live, rather than opened
  // fresh for each individual action — this is what lets a rejoining
  // student reliably ask "has this already started?" and get an answer,
  // and what makes the End button's broadcast land reliably instead of
  // racing a connection that's still settling.
  useEffect(() => {
    if (!liveClassCode) return;
    const channel = supabase.channel(`classroom-${liveClassCode}`, {
      config: { presence: { key: "teacher" } },
    });
    channel.on("broadcast", { event: "request-session-status" }, () => {
      channel.send({ type: "broadcast", event: "session-started", payload: { boardId } });
    });

    // Live roster: students track their own presence on this same
    // channel for as long as they're on the join/view pages, so the
    // teacher can always see who's currently in class and open their
    // mini-board — not just during the pre-Start waiting room.
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      const students = [];
      for (const key in state) {
        if (key === "teacher") continue;
        const presence = state[key]?.[0];
        if (presence) students.push(presence);
      }
      students.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
      setClassRoster(students);
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ role: "teacher" });
      }
    });
    liveClassChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      liveClassChannelRef.current = null;
      setClassRoster([]);
    };
  }, [liveClassCode, boardId]);

  // Locks the actual page/body from scrolling for as long as the
  // whiteboard is open — restored when navigating away. The canvas
  // already handles all panning internally via its own transform; a
  // scrollable page underneath it is what causes mobile Chrome's
  // fixed-position toolbar to glitch or briefly vanish during a scroll.
  useEffect(() => {
    const body = document.body;
    const html = document.documentElement;
    const prev = {
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyWidth: body.style.width,
      bodyHeight: body.style.height,
      bodyOverscroll: body.style.overscrollBehavior,
      htmlOverflow: html.style.overflow,
      htmlOverscroll: html.style.overscrollBehavior,
    };

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.width = "100%";
    body.style.height = "100%";
    body.style.overscrollBehavior = "none";
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";

    return () => {
      body.style.overflow = prev.bodyOverflow;
      body.style.position = prev.bodyPosition;
      body.style.width = prev.bodyWidth;
      body.style.height = prev.bodyHeight;
      body.style.overscrollBehavior = prev.bodyOverscroll;
      html.style.overflow = prev.htmlOverflow;
      html.style.overscrollBehavior = prev.htmlOverscroll;
    };
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

  // Keeps every embedded-simulation box's on-screen position/size in sync
  // with the current pan/zoom (and with its own world x/y/width/height,
  // e.g. right after a drag). Called from fullRedraw() (every pan/zoom
  // tick) and directly during a sim's own move/resize drag for instant
  // feedback.
  function repositionSimEmbeds() {
    const scale = scaleRef.current;
    for (const sim of simsRef.current) {
      const el = simNodesRef.current[sim.id];
      if (!el) continue;
      const screenPos = worldToScreen({ x: sim.x, y: sim.y });
      el.style.left = screenPos.x + "px";
      el.style.top = screenPos.y + "px";
      el.style.width = sim.width * scale + "px";
      el.style.height = sim.height * scale + "px";
    }
  }

  // The eraser punches transparent holes ("destination-out") instead of
  // painting white, so the page background (lined, dots…) shows through
  // where you erase instead of being wiped out.
  function drawStroke(ctx, stroke) {
    if (!stroke || !stroke.points || stroke.points.length < 2) return;
    if (stroke.tool === "eraser") {
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
    // rows is cartesian-only and defaults to cols (a square) - see
    // gridRenderer.js. Polar grids are always radially symmetric.
    const rows = grid.type === "polar" ? cols : grid.rows || cols;
    const cell = size / cols;
    const height = cell * rows;
    const scale = scaleRef.current;

    // The actual grid/graph-paper drawing (lines, axes, numbers, polar
    // rings/spokes, unit circle...) is shared with the customization
    // dialog's live preview — see gridRenderer.js — so what you configure
    // there is guaranteed to be exactly what lands on the board.
    renderGrid(ctx, grid, { cellPx: cell, originXPx: x, originYPx: y, lineScale: 1 / scale });

    if (gridToolActiveRef.current) {
      ctx.save();
      ctx.fillStyle = "#1E88E5";
      ctx.beginPath();
      ctx.arc(x + size, y + height, 8 / scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ---- Selection overlay + board images (positioned on every redraw) ----

  function textHeightOf(t) {
    return ctxRef.current ? getTextBoxHeight(ctxRef.current, t) : (t.fontSize || 24) * 1.3;
  }

  function getObjectsData(sel) {
    const s = new Set(sel.strokes), t = new Set(sel.texts), i = new Set(sel.images);
    return {
      strokes: s.size ? strokesRef.current.filter((x) => s.has(x.id)) : [],
      texts: t.size ? textsRef.current.filter((x) => t.has(x.id)) : [],
      images: i.size ? imagesRef.current.filter((x) => i.has(x.id)) : [],
    };
  }

  function boundsOfData(data) {
    return unionBounds([
      ...data.strokes.map(strokeBounds),
      ...data.texts.map((t) => textBounds(t, textHeightOf(t))),
      ...data.images.map(imageBounds),
    ]);
  }

  function getSelectionBounds() {
    const move = groupMoveRef.current;
    if (move && move.origBounds) {
      const b = move.origBounds;
      return { minX: b.minX + move.dx, minY: b.minY + move.dy, maxX: b.maxX + move.dx, maxY: b.maxY + move.dy };
    }
    const key = [selectionRef.current, strokesRef.current, textsRef.current, imagesRef.current];
    const cache = selectionBoundsCacheRef.current;
    if (cache && cache.key.every((v, idx) => v === key[idx])) return cache.bounds;
    const bounds = boundsOfData(getObjectsData(selectionRef.current));
    selectionBoundsCacheRef.current = { key, bounds };
    return bounds;
  }

  function repositionImages() {
    for (const img of imagesRef.current) {
      const el = imageNodesRef.current[img.id];
      if (!el) continue;
      const p = worldToScreen({ x: img.x, y: img.y });
      const scale = scaleRef.current;
      el.style.left = p.x + "px";
      el.style.top = p.y + "px";
      el.style.width = img.width * scale + "px";
      el.style.height = img.height * scale + "px";
    }
  }

  function repositionSelectionOverlay() {
    const box = selectionBoxElRef.current;
    const bar = selectionBarElRef.current;
    const marquee = marqueeElRef.current;
    if (marquee) {
      const m = marqueeRef.current;
      if (m) {
        const a = worldToScreen(m.start), b = worldToScreen(m.current);
        marquee.style.display = "block";
        marquee.style.left = Math.min(a.x, b.x) + "px";
        marquee.style.top = Math.min(a.y, b.y) + "px";
        marquee.style.width = Math.abs(a.x - b.x) + "px";
        marquee.style.height = Math.abs(a.y - b.y) + "px";
      } else {
        marquee.style.display = "none";
      }
    }
    if (!box || !bar) return;
    const sel = selectionRef.current;
    const bounds = toolRef.current === "select" && selectionCount(sel) > 0 ? getSelectionBounds() : null;
    if (!bounds) {
      box.style.display = "none";
      bar.style.display = "none";
      return;
    }
    const scale = scaleRef.current;
    const pad = 6;
    const tl = worldToScreen({ x: bounds.minX, y: bounds.minY });
    const w = (bounds.maxX - bounds.minX) * scale;
    const h = (bounds.maxY - bounds.minY) * scale;
    const singleText = sel.texts.length === 1 && sel.strokes.length === 0 && sel.images.length === 0;
    const singleImage = sel.images.length === 1 && sel.strokes.length === 0 && sel.texts.length === 0;
    box.style.display = singleText ? "none" : "block";
    box.style.left = tl.x - pad + "px";
    box.style.top = tl.y - pad + "px";
    box.style.width = w + pad * 2 + "px";
    box.style.height = h + pad * 2 + "px";
    const handle = box.firstChild;
    if (handle) handle.style.display = singleImage && !groupMoveRef.current ? "block" : "none";

    // Action bar: above the selection if there's room, otherwise below,
    // always kept inside the board.
    const { width: paneW, height: paneH } = getPaneSize();
    bar.style.display = groupMoveRef.current || imageResizeRef.current ? "none" : "flex";
    const barW = bar.offsetWidth || 300;
    const barH = bar.offsetHeight || 48;
    const extraTop = singleText ? 44 : 0; // clear the text box's rotate handle
    let top = tl.y - pad - barH - 10 - extraTop;
    if (top < 8) top = tl.y + h + pad + 10;
    top = Math.max(8, Math.min(paneH - barH - 8, top));
    let left = tl.x + w / 2 - barW / 2;
    left = Math.max(8, Math.min(paneW - barW - 8, left));
    bar.style.left = left + "px";
    bar.style.top = top + "px";
  }

  // ---------- saving + broadcasting ----------

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

    applyBackground(pageBgRef.current, backgroundRef.current, scale, pan, backgroundCssKeyRef);

    repositionEditingTextarea();
    repositionSimEmbeds();
    repositionImages();
    repositionSelectionOverlay();
  }

  function drawNewSegment(ctx, styleStroke, newPointsCount) {
    const pts = styleStroke.points;
    if (pts.length < 2 || newPointsCount < 1) return;
    const lookback = 3;
    const startIdx = Math.max(0, pts.length - newPointsCount - 1 - lookback);
    const endIdx = pts.length - 1;
    if (styleStroke.tool === "eraser") {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "#000000";
      drawVariableWidthPath(ctx, pts, startIdx, endIdx, styleStroke.width);
      ctx.globalCompositeOperation = "source-over";
    } else {
      ctx.globalAlpha = styleStroke.opacity ?? 1;
      ctx.strokeStyle = styleStroke.color;
      ctx.lineWidth = styleStroke.width;
      ctx.lineCap = "butt";
      smoothPath(ctx, pts, startIdx, endIdx);
    }
    ctx.globalAlpha = 1;

    if (gridConfigRef.current) drawGrid(ctx, gridConfigRef.current);
  }

  // Supabase errors print as "{}" in the console, so spell them out. A
  // row-level-security refusal (code 42501) when re-saving something that
  // already exists means the table has no "update" rule yet — moving
  // strokes is the first thing that ever updates a saved stroke — so say
  // that once, in plain words, instead of an error every time.
  function reportSaveError(kind, error) {
    const detail = [error.code, error.message, error.details, error.hint].filter(Boolean).join(" — ");
    if (error.code === "42501") {
      console.warn(`Could not save a moved ${kind} (the ${kind}s table needs an update rule in Supabase): ${detail}`);
      if (!rlsNoticeShownRef.current) {
        rlsNoticeShownRef.current = true;
        setBoardNotice(
          "Moved items show for everyone now, but won't stay moved after a reload until the Supabase update rule is added (see the SQL file)."
        );
        if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = setTimeout(() => setBoardNotice(""), 8000);
      }
      return;
    }
    console.error(`Error saving ${kind}: ${detail || String(error)}`);
  }

  async function insertStroke(stroke) {
    if (!boardId || !stroke?.id) return;
    const error = await saveRow(sync, "strokes", {
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
    if (error) reportSaveError("stroke", error);
  }

  async function insertText(t) {
    if (!boardId || !t?.id) return;
    const error = await saveRow(sync, "texts", {
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
    if (error) reportSaveError("text", error);
  }

  function performClear() {
    setStrokes([]);
    setTexts([]);
    setImages([]);
    selectionRef.current = emptySelection();
    setSelectionState(emptySelection());
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

  // Server copy + what's on screen -> what should be on screen. Work
  // still saving (or drawn in the last minute) is kept; things someone
  // else rubbed out while we were away are dropped.
  function applyServerContents(contents, fetchStartedAt) {
    const since = syncSince(fetchStartedAt);
    if (contents.strokes) setStrokes((prev) => mergeServerList(prev, contents.strokes, sync, since));
    if (contents.texts) setTexts((prev) => mergeServerList(prev, contents.texts, sync, since));
    if (contents.images) setImages((prev) => mergeServerList(prev, contents.images, sync, since));
  }

  // Catch up after the live connection was down (idle pause, sleep,
  // network drop): anything saved by others meanwhile appears, anything
  // they rubbed out disappears, and our own unsaved work is re-sent.
  async function catchUpWithServer() {
    if (!boardId || catchUpRunningRef.current) return;
    catchUpRunningRef.current = true;
    setCatchingUp(true);
    const fetchStartedAt = Date.now();
    const [contents, settings] = await Promise.all([fetchBoardContents(boardId), fetchBoardSettings(boardId)]);
    applyServerContents(contents, fetchStartedAt);
    if (settings) {
      if ("grid_config" in settings) gridConfigRef.current = settings.grid_config || null;
      if ("background" in settings) {
        backgroundRef.current = normalizeBackground(settings.background);
        setBoardBackground(backgroundRef.current);
      }
      if ("sim_embeds" in settings) {
        simsRef.current = settings.sim_embeds || [];
        setSims(simsRef.current);
      }
      if (settings.name) setBoardName(settings.name);
    }
    retryUnsaved(sync);
    catchUpRunningRef.current = false;
    setCatchingUp(false);
    fullRedraw();
  }

  useEffect(() => {
    if (!boardId || !userId) return;
    connectedOnceRef.current = false;
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
          .select("grid_config, owner_id, name")
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
        setIsOwner(userId === boardRow.owner_id);
        setBoardName(boardRow.name || "");
      } else if (boardError) {
        console.error("Error loading board:", boardError);
      }

      // Kept as a separate, failure-tolerant query: `sim_embeds` is a new
      // column and older boards' Supabase projects may not have it yet
      // (needs a one-time `alter table boards add column sim_embeds
      // jsonb;`). Failing quietly here just means embedded sims start
      // empty until that column exists, instead of breaking the whole
      // board load the way including it in the query above would.
      // These newer extras are each fetched on their own: one failing
      // (column/table not created yet) or being slow never holds up or
      // breaks the others, or the board itself.
      supabase.from("boards").select("sim_embeds").eq("id", boardId).maybeSingle().then(({ data, error }) => {
        if (!error && data) {
          simsRef.current = data.sim_embeds || [];
          setSims(simsRef.current);
        } else if (error) {
          console.warn("Could not load embedded simulations (has the sim_embeds column been added yet?):", error);
        }
      });

      // The saved preview picture, so an unchanged board isn't re-saved.
      supabase.from("boards").select("thumbnail").eq("id", boardId).maybeSingle().then(({ data, error }) => {
        if (!error && data) lastThumbRef.current = data.thumbnail || null;
      });

      // Page background: `alter table boards add column background text;`
      supabase.from("boards").select("background").eq("id", boardId).maybeSingle().then(({ data, error }) => {
        if (!error && data) {
          backgroundRef.current = normalizeBackground(data.background);
          setBoardBackground(backgroundRef.current);
          fullRedraw();
        } else if (error) {
          console.warn("Could not load the page background (has the background column been added yet?):", error);
        }
      });

      // Everything drawn so far (all of it — Supabase hands rows back
      // 1,000 at a time), merged with anything drawn while it loaded.
      // Each part shows as soon as it arrives.
      const fetchStartedAt = Date.now();
      await Promise.all(
        ["strokes", "texts", "images"].map((kind) =>
          fetchBoardPart(boardId, kind).then((list) => applyServerContents({ [kind]: list }, fetchStartedAt))
        )
      );
      boardLoadedRef.current = true;
      fullRedraw();
      touchBoard(boardId);
    }
    loadBoard();
  }, [boardId, userId]);


  async function saveGrid() {
    if (!boardId) return;
    const { error } = await supabase
      .from("boards")
      .update({ grid_config: gridConfigRef.current })
      .eq("id", boardId);
    return !error;
  }

  async function saveSimEmbeds() {
    if (!boardId) return;
    const { error } = await supabase
      .from("boards")
      .update({ sim_embeds: simsRef.current })
      .eq("id", boardId);
    if (error) console.warn("Could not save embedded simulations (has the sim_embeds column been added yet?):", error);
    return !error;
  }

  async function handleSetBackground(next) {
    const value = normalizeBackground(next);
    if (value === backgroundRef.current) return;
    backgroundRef.current = value;
    setBoardBackground(value);
    fullRedraw();
    channelRef.current?.send({ type: "broadcast", event: "background-set", payload: { background: value } });
    if (!boardId) return;
    const { error } = await supabase.from("boards").update({ background: value }).eq("id", boardId);
    if (error) console.warn("Could not save the page background (has the background column been added yet?):", error);
  }

  // ================= Selection, copy / cut / paste, images =================
  // Everything here works from refs so it can be called from the canvas
  // pointer handlers (registered once) as well as from React handlers.

  function flashNotice(text, ms = 2600) {
    setBoardNotice(text);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setBoardNotice(""), ms);
  }

  function setSelection(next) {
    const sel = next || emptySelection();
    selectionRef.current = sel;
    selectionBoundsCacheRef.current = null;
    setSelectionState(sel);
    const singleText = sel.texts.length === 1 && sel.strokes.length === 0 && sel.images.length === 0;
    setSelectedTextId(singleText ? sel.texts[0] : null);
    repositionSelectionOverlay();
  }

  function warnImagesTable(error) {
    console.warn("Could not save images (has the images table been created yet?):", error);
    if (!imagesTableWarnedRef.current) {
      imagesTableWarnedRef.current = true;
      flashNotice("Images show for everyone now, but won't be saved until the images table is set up in Supabase.", 6000);
    }
  }

  async function insertImage(img) {
    if (!boardId || !img?.id) return;
    const error = await saveRow(sync, "images", {
      id: img.id,
      board_id: boardId,
      x: img.x,
      y: img.y,
      width: img.width,
      height: img.height,
      src: img.src,
    });
    if (error) warnImagesTable(error);
  }

  function persistAdd(data) {
    data.strokes.forEach((s) => insertStroke(s));
    data.texts.forEach((t) => insertText(t));
    data.images.forEach((img) => insertImage(img));
  }

  function persistRemove(sel) {
    const run = (table, ids) => {
      if (!ids.length) return;
      supabase.from(table).delete().in("id", ids).then(({ error }) => {
        if (error) {
          if (table === "images") warnImagesTable(error);
          else console.error(`Error deleting from ${table}:`, error);
        }
      });
    };
    run("strokes", sel.strokes);
    run("texts", sel.texts);
    run("images", sel.images);
  }

  function broadcastAdd(data) {
    for (const chunk of chunkObjects(data)) {
      channelRef.current?.send({ type: "broadcast", event: "objects-add", payload: chunk });
    }
  }

  function mergeById(prev, added) {
    if (!added.length) return prev;
    const ids = new Set(added.map((o) => o.id));
    return [...prev.filter((o) => !ids.has(o.id)), ...added];
  }

  // Low-level apply (no undo bookkeeping). `remote` skips broadcast/save.
  function applyAdd(data, { remote = false } = {}) {
    const d = { strokes: data.strokes || [], texts: data.texts || [], images: data.images || [] };
    if (d.strokes.length) setStrokes((prev) => mergeById(prev, d.strokes));
    if (d.texts.length) setTexts((prev) => mergeById(prev, d.texts));
    if (d.images.length) setImages((prev) => mergeById(prev, d.images));
    if (!remote) {
      broadcastAdd(d);
      persistAdd(d);
    }
  }

  function applyRemove(sel, { remote = false } = {}) {
    const s = new Set(sel.strokes || []), t = new Set(sel.texts || []), i = new Set(sel.images || []);
    if (s.size) setStrokes((prev) => prev.filter((x) => !s.has(x.id)));
    if (t.size) setTexts((prev) => prev.filter((x) => !t.has(x.id)));
    if (i.size) setImages((prev) => prev.filter((x) => !i.has(x.id)));
    if (!remote) {
      channelRef.current?.send({ type: "broadcast", event: "objects-remove", payload: { strokes: [...s], texts: [...t], images: [...i] } });
      persistRemove({ strokes: [...s], texts: [...t], images: [...i] });
    }
  }

  function applyMove(sel, dx, dy, { remote = false } = {}) {
    if (!dx && !dy) return;
    const s = new Set(sel.strokes || []), t = new Set(sel.texts || []), i = new Set(sel.images || []);
    if (s.size) setStrokes((prev) => prev.map((x) => (s.has(x.id) ? translateStroke(x, dx, dy) : x)));
    if (t.size) setTexts((prev) => prev.map((x) => (t.has(x.id) ? translateText(x, dx, dy) : x)));
    if (i.size) setImages((prev) => prev.map((x) => (i.has(x.id) ? translateImage(x, dx, dy) : x)));
    if (!remote) {
      channelRef.current?.send({ type: "broadcast", event: "objects-move", payload: { strokes: [...s], texts: [...t], images: [...i], dx, dy } });
      // Save the moved copies (computed from the current refs, which don't
      // include this move yet).
      const moved = getObjectsData({ strokes: [...s], texts: [...t], images: [...i] });
      persistAdd({
        strokes: moved.strokes.map((x) => translateStroke(x, dx, dy)),
        texts: moved.texts.map((x) => translateText(x, dx, dy)),
        images: moved.images.map((x) => translateImage(x, dx, dy)),
      });
    }
  }

  function pushUndo(entry) {
    myStrokeStack.current.push(entry);
    myRedoStack.current = [];
    setMyUndoAvailable(true);
    setMyRedoAvailable(false);
  }

  // ---------- selection actions ----------

  function copySelection({ silent = false } = {}) {
    const data = getObjectsData(selectionRef.current);
    if (selectionCount(selectionFromData(data)) === 0) return false;
    writeInternalClipboard({ boardId, bounds: boundsOfData(data), ...data });
    pasteCountRef.current = 0;
    copiedOnThisPageRef.current = true;
    clipboardMarkedRef.current = false;
    writeClipboardMarker().then((ok) => {
      if (ok) clipboardMarkedRef.current = true;
    });
    if (!silent) flashNotice("Copied — paste it here or on another board.");
    return true;
  }

  function deleteSelection() {
    const data = getObjectsData(selectionRef.current);
    const sel = selectionFromData(data);
    if (selectionCount(sel) === 0) return;
    applyRemove(sel);
    pushUndo({ op: "remove", data });
    setSelection(emptySelection());
  }

  function cutSelection() {
    if (!copySelection({ silent: true })) return;
    deleteSelection();
    flashNotice("Cut — paste it wherever you like.");
  }

  function addAsNewSelection(data) {
    applyAdd(data);
    const sel = selectionFromData(data);
    pushUndo({ op: "add", sel });
    toolRef.current = "select";
    setPanToolActive(false);
    setTool("select");
    setSelection(sel);
  }

  function duplicateSelection() {
    const data = getObjectsData(selectionRef.current);
    if (selectionCount(selectionFromData(data)) === 0) return;
    const off = 24 / scaleRef.current;
    addAsNewSelection(cloneObjects(data, off, off));
  }

  function viewportCenterWorld() {
    const { width, height } = getPaneSize();
    return screenToWorld({ x: width / 2, y: height / 2 });
  }

  function isWorldPointVisible(p) {
    const s = worldToScreen(p);
    const { width, height } = getPaneSize();
    return s.x >= 0 && s.y >= 0 && s.x <= width && s.y <= height;
  }

  function pasteInternal(clip) {
    const data = { strokes: clip.strokes || [], texts: clip.texts || [], images: clip.images || [] };
    const bounds = clip.bounds || boundsOfData(data);
    if (!bounds) return false;
    const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    let dx, dy;
    if (isWorldPointVisible(center)) {
      // Original is on screen: step each paste down-right so copies don't
      // sit exactly on top of each other.
      pasteCountRef.current += 1;
      dx = dy = (24 * pasteCountRef.current) / scaleRef.current;
    } else {
      const target = viewportCenterWorld();
      dx = target.x - center.x;
      dy = target.y - center.y;
    }
    addAsNewSelection(cloneObjects(data, dx, dy));
    return true;
  }

  function pastePlainText(text) {
    const value = String(text).slice(0, 5000);
    const at = viewportCenterWorld();
    const t = {
      id: newId(),
      x: at.x - 160,
      y: at.y - 20,
      text: value,
      color: colorRef.current,
      fontSize: 24,
      width: 320,
      rotation: 0,
    };
    addAsNewSelection({ strokes: [], texts: [t], images: [] });
  }

  async function uploadBoardImage(prepared, id) {
    const ext = prepared.type === "image/jpeg" ? "jpg" : "png";
    const path = `${boardId}/${id}.${ext}`;
    let failure = null;
    try {
      const { error } = await supabase.storage
        .from("board-images")
        .upload(path, prepared.blob, { contentType: prepared.type, upsert: true });
      failure = error;
    } catch (err) {
      failure = err;
    }
    if (failure) {
      console.warn("Image upload failed (has the board-images bucket been created?):", failure);
      return null;
    }
    const { data } = supabase.storage.from("board-images").getPublicUrl(path);
    return data?.publicUrl || null;
  }

  async function insertImageFiles(fileList, atWorld) {
    const files = imageFilesFrom(fileList).slice(0, 6);
    if (!files.length) {
      flashNotice("That isn't an image this board can use — try a PNG or JPG.");
      return;
    }
    flashNotice(files.length > 1 ? `Adding ${files.length} images…` : "Adding image…", 20000);
    const center = atWorld || viewportCenterWorld();
    const scale = scaleRef.current;
    const { width: paneW, height: paneH } = getPaneSize();
    const added = [];
    for (let n = 0; n < files.length; n++) {
      let prepared;
      try {
        prepared = await prepareImageFile(files[n]);
      } catch (err) {
        console.error("Image processing failed:", err);
        continue;
      }
      const id = newId();
      let src = await uploadBoardImage(prepared, id);
      if (!src) src = await makeInlineImage(prepared);
      if (!src) continue;
      // Shown at its own pixel size, but never more than ~60% of the board.
      const fit = Math.min(1, (paneW * 0.6) / prepared.width, (paneH * 0.6) / prepared.height);
      const width = (prepared.width * fit) / scale;
      const height = (prepared.height * fit) / scale;
      const offset = (n * 24) / scale;
      added.push({ id, x: center.x - width / 2 + offset, y: center.y - height / 2 + offset, width, height, src });
    }
    if (!added.length) {
      flashNotice("Couldn't add that image — please try a smaller PNG or JPG.", 5000);
      return;
    }
    setBoardNotice("");
    addAsNewSelection({ strokes: [], texts: [], images: added });
  }

  // Decides what a paste means: our own copied selection, a picture, or
  // plain text (which becomes a text box).
  function pasteFromSources({ files = [], text = "" } = {}) {
    if (files.length) {
      insertImageFiles(files);
      return;
    }
    const clip = readInternalClipboard();
    const trimmed = (text || "").trim();
    if (trimmed && trimmed !== CLIPBOARD_MARKER) {
      // Text from somewhere else is newer than our copy — unless we never
      // managed to put our marker on the system clipboard, in which case a
      // selection copied on this page is the most recent thing.
      if (clip && copiedOnThisPageRef.current && !clipboardMarkedRef.current) {
        if (pasteInternal(clip)) return;
      }
      pastePlainText(text);
      return;
    }
    if (clip && pasteInternal(clip)) return;
    flashNotice("Nothing to paste yet — copy something on a board first, or use Insert ▸ Image.");
  }

  async function handlePasteButton() {
    const { files, text } = await readSystemClipboard();
    pasteFromSources({ files, text });
  }

  function selectAll() {
    const sel = {
      strokes: strokesRef.current.map((s) => s.id),
      texts: textsRef.current.map((t) => t.id),
      images: imagesRef.current.map((i) => i.id),
    };
    toolRef.current = "select";
    setPanToolActive(false);
    setTool("select");
    setSelection(sel);
  }

  // ---------- images ----------

  function handleInsertImageClick() {
    imageInputRef.current?.click();
  }

  function handleImageInputChange(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length) insertImageFiles(files);
  }

  function handleBoardDragOver(e) {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }

  function handleBoardDrop(e) {
    const files = imageFilesFrom(e.dataTransfer?.files);
    if (!files.length) return;
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    insertImageFiles(files, screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top }));
  }

  // ---------- boards-list preview ----------

  function saveThumbnail() {
    if (thumbTimerRef.current) {
      clearTimeout(thumbTimerRef.current);
      thumbTimerRef.current = null;
    }
    if (!boardId || !boardLoadedRef.current) return;
    const url = renderBoardThumbnail({
      strokes: strokesRef.current,
      texts: textsRef.current,
      images: imagesRef.current,
      grid: gridConfigRef.current,
      background: backgroundRef.current,
    });
    if (url === lastThumbRef.current) return;
    lastThumbRef.current = url;
    supabase.from("boards").update({ thumbnail: url }).eq("id", boardId).then(({ error }) => {
      if (error && !thumbWarnedRef.current) {
        thumbWarnedRef.current = true;
        console.warn("Could not save the board preview (has the thumbnail column been added yet?):", error);
      }
    });
  }

  function scheduleThumbnail() {
    if (!boardLoadedRef.current) return;
    if (thumbTimerRef.current) clearTimeout(thumbTimerRef.current);
    thumbTimerRef.current = setTimeout(saveThumbnail, 5000);
  }

  async function handleEndSession() {
    setSaveStatus("Saving…");
    saveThumbnail();
    const ok = await saveGrid();
    setSaveStatus(ok ? "Saved" : "Save failed");
    setTimeout(() => setSaveStatus(""), 3000);
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(window.location.href);
    setSaveStatus("Link copied");
    setTimeout(() => setSaveStatus(""), 2000);
  }

  function handleStartLiveClass() {
    router.push(`/board/${boardId}/live`);
  }

  async function handleEndLiveClass() {
    if (!liveClassCode) return;
    if (!window.confirm("End the live class? Students currently watching will be disconnected.")) return;

    if (liveClassChannelRef.current) {
      await liveClassChannelRef.current.send({ type: "broadcast", event: "class-ended", payload: {} });
    }

    clearClassCode(boardId);
    setLiveClassCode(null);
    setShowRoster(false);
    setViewingStudent(null);
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
        toolBeforeGridRef.current = tool;
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
        toolBeforePanRef.current = tool;
        setRulerActive(false);
        setCompassActive(false);
        setGridToolActive(false);
      }
      return next;
    });
  }

  // Toolbar: picking a drawing/select/text tool always leaves Move mode
  // and graph-placement mode, so the tool you tapped is the one you get.
  function handleSelectTool(name) {
    setPanToolActive(false);
    if (gridToolActive) {
      setGridToolActive(false);
      fullRedraw();
    }
    if (name !== "select") setSelection(emptySelection());
    setTool(name);
  }

  function handleSelectMove() {
    if (!panToolActive) handleTogglePan();
  }

  // Maths ▸ Graph: open the graph dialog and switch on placement mode so
  // the graph can be dragged/resized afterwards (same flow as the old grid
  // button). "Done placing graph" in the context bar switches it back off.
  function handleOpenGraph() {
    if (!gridToolActive) handleToggleGrid();
    handleOpenGridModal();
  }

  function handleFinishGraphMove() {
    if (!gridToolActive) return;
    handleToggleGrid();
    setTool(toolBeforeGridRef.current || "pen");
  }

  function getHasGrid() {
    return !!gridConfigRef.current;
  }

  function handleToggleCalculator() {
    if (!calculatorActive) {
      // Open where it was last left on this device (kept on screen),
      // otherwise on the right-hand side of the board.
      const { width, height } = getPaneSize();
      const saved = loadCalcPosition();
      const x = saved ? saved.x : width - 336 - 24;
      const y = saved ? saved.y : 64; // below the zoom control
      setCalculatorPos({
        x: Math.max(8, Math.min(x, width - 336 - 8)),
        y: Math.max(8, Math.min(y, height - 58)), // the calculator nudges itself fully on screen
      });
    }
    setCalculatorActive((prev) => !prev);
  }

  function handleRemoveGrid() {
    if (!gridConfigRef.current) return;
    gridConfigRef.current = null;
    setGridCellSizeCm(10);
    fullRedraw();
    channelRef.current?.send({ type: "broadcast", event: "grid-set", payload: { grid: null } });
    saveGrid();
  }

  function handleSetGridCellSize(cm) {
    if (!cm || cm <= 0) return;
    const isNewGrid = !gridConfigRef.current;
    const cols = gridConfigRef.current?.cols || 10;
    const newSize = cm * WORLD_UNITS_PER_CM * cols;

    let updated;
    if (gridConfigRef.current) {
      updated = { ...gridConfigRef.current, size: newSize };
    } else {
      const { width, height } = getPaneSize();
      const centerWorld = screenToWorld({ x: width / 2, y: height / 2 });
      updated = { x: centerWorld.x - newSize / 2, y: centerWorld.y - newSize / 2, size: newSize, cols };
    }

    gridConfigRef.current = updated;
    setGridCellSizeCm(cm);
    fullRedraw();
    channelRef.current?.send({ type: "broadcast", event: "grid-set", payload: { grid: updated } });
    saveGrid();

    if (isNewGrid) {
      setGridToolActive(false);
      setTool(toolBeforeGridRef.current || "pen");
    }
  }

  function handleOpenGridModal() {
    setGridModalInitialConfig(gridConfigRef.current);
    setGridModalZoomScale(scaleRef.current);
    setGridModalOpen(true);
  }

  function handleCloseGridModal() {
    setGridModalOpen(false);
  }

  // Applies the "ultimate grid tool" dialog's configuration. The dialog's
  // `cellSizePx` field (a target ON-SCREEN size, not a physical unit) is
  // the one source of truth for the grid's scale, converted to world units
  // through the CURRENT zoom level (scaleRef.current) — that's what makes
  // "more columns/rows/rings" REPEAT the same-size cell outward (stretching
  // the grid, like resizing an image while keeping its resolution) instead
  // of squeezing a fixed-size box into finer slices (which is what used to
  // make cells shrink to invisibility whenever the division count went
  // up), while ALSO keeping the grid's total footprint reasonable relative
  // to whatever you're currently looking at — since the cell size is tied
  // to zoom rather than a fixed real-world measurement, adding a lot more
  // sections can't balloon the grid into something "massive" that no
  // longer fits your view. An existing grid keeps its current top-left
  // corner as the anchor it grows/shrinks from (matching the on-canvas
  // corner-drag gesture); a brand new grid is centered in the current view.
  function handleApplyGridConfig(config) {
    const cols = config.cols || 10;
    const rows = config.type === "polar" ? cols : config.rows || cols;
    const cellScreenPx = Math.max(4, config.cellSizePx || 48);
    const cellWorldSize = cellScreenPx / scaleRef.current;
    const newSize = cellWorldSize * cols;

    let updated;
    if (gridConfigRef.current) {
      updated = { ...gridConfigRef.current, ...config, cols, rows, size: newSize };
    } else {
      const newHeight = cellWorldSize * rows;
      const { width, height } = getPaneSize();
      const centerWorld = screenToWorld({ x: width / 2, y: height / 2 });
      updated = {
        ...config,
        cols,
        rows,
        x: centerWorld.x - newSize / 2,
        y: centerWorld.y - newHeight / 2,
        size: newSize,
      };
    }
    gridConfigRef.current = updated;
    setGridCellSizeCm(cellWorldSize / WORLD_UNITS_PER_CM);
    fullRedraw();
    channelRef.current?.send({ type: "broadcast", event: "grid-set", payload: { grid: updated } });
    saveGrid();
    setGridModalOpen(false);
  }

  function scheduleSimBroadcast() {
    pendingSimBroadcast.current = true;
    if (simBroadcastTimer.current) return;
    simBroadcastTimer.current = setTimeout(() => {
      simBroadcastTimer.current = null;
      if (!pendingSimBroadcast.current) return;
      pendingSimBroadcast.current = null;
      channelRef.current?.send({ type: "broadcast", event: "sim-embeds-set", payload: { sims: simsRef.current } });
    }, 60);
  }

  function handleOpenSimModal() {
    setSimModalOpen(true);
  }

  function handleCloseSimModal() {
    setSimModalOpen(false);
  }

  function handleAddSimEmbed({ url, title }) {
    const { width, height } = getPaneSize();
    const centerWorld = screenToWorld({ x: width / 2, y: height / 2 });
    const boxW = 480;
    const boxH = 360;
    const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    const sim = { id, url, title, x: centerWorld.x - boxW / 2, y: centerWorld.y - boxH / 2, width: boxW, height: boxH };
    simsRef.current = [...simsRef.current, sim];
    setSims(simsRef.current);
    channelRef.current?.send({ type: "broadcast", event: "sim-embeds-set", payload: { sims: simsRef.current } });
    saveSimEmbeds();
    setSimModalOpen(false);
  }

  function handleRemoveSimEmbed(id) {
    simsRef.current = simsRef.current.filter((s) => s.id !== id);
    delete simNodesRef.current[id];
    setSims(simsRef.current);
    channelRef.current?.send({ type: "broadcast", event: "sim-embeds-set", payload: { sims: simsRef.current } });
    saveSimEmbeds();
  }

  function handleMoveSimEmbed(id, x, y) {
    simsRef.current = simsRef.current.map((s) => (s.id === id ? { ...s, x, y } : s));
    repositionSimEmbeds();
    scheduleSimBroadcast();
  }

  function handleResizeSimEmbed(id, width, height) {
    simsRef.current = simsRef.current.map((s) => (s.id === id ? { ...s, width, height } : s));
    repositionSimEmbeds();
    scheduleSimBroadcast();
  }

  function handleCommitSimEmbed() {
    setSims(simsRef.current);
    channelRef.current?.send({ type: "broadcast", event: "sim-embeds-set", payload: { sims: simsRef.current } });
    saveSimEmbeds();
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
      if (!browserCanOpenPdfs()) {
        setReferenceUploadStatus("");
        alert(PDF_UNSUPPORTED_MESSAGE);
        return;
      }
      try {
        const pdfjsLib = await loadPdfjs();
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
    setRefCollapsed(false);
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
        setSelection(emptySelection());
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

  // Registers new sim boxes' DOM nodes right after they mount / re-syncs
  // all of them after the list itself changes (add/remove).
  useEffect(() => {
    repositionSimEmbeds();
  }, [sims]);

  useEffect(() => {
    if (!boardId || syncPaused) return;
    const channel = supabase.channel(`board-${boardId}`, {
      config: { broadcast: { self: false } },
    });

    // Someone else changing the board keeps a watching viewer "active",
    // so a student following along never gets paused.
    channel.on("broadcast", { event: "*" }, ({ event }) => {
      if (!/-request$/.test(String(event || ""))) noteRemoteActivity();
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
      if (payload.grid) {
        setGridCellSizeCm(payload.grid.size / payload.grid.cols / WORLD_UNITS_PER_CM);
      }
      fullRedraw();
    });

    channel.on("broadcast", { event: "objects-add" }, ({ payload }) => {
      applyAdd(payload, { remote: true });
    });

    channel.on("broadcast", { event: "objects-remove" }, ({ payload }) => {
      applyRemove(payload, { remote: true });
    });

    channel.on("broadcast", { event: "objects-move" }, ({ payload }) => {
      applyMove(payload, payload.dx, payload.dy, { remote: true });
    });

    channel.on("broadcast", { event: "image-update" }, ({ payload }) => {
      const img = payload.image;
      if (img) setImages((prev) => prev.map((x) => (x.id === img.id ? img : x)));
    });

    channel.on("broadcast", { event: "background-set" }, ({ payload }) => {
      backgroundRef.current = normalizeBackground(payload.background);
      setBoardBackground(backgroundRef.current);
      fullRedraw();
    });

    channel.on("broadcast", { event: "sim-embeds-set" }, ({ payload }) => {
      simsRef.current = payload.sims || [];
      setSims(simsRef.current);
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

    // Classroom Mode: a read-only student viewer has no database access
    // (they never logged in), so it asks over this same channel for the
    // board's current state instead. This board just answers with
    // whatever it already has in memory — no new state, no new tracking,
    // reusing refs that are already kept current for other reasons.
    channel.on("broadcast", { event: "classroom-state-request" }, () => {
      channelRef.current?.send({
        type: "broadcast",
        event: "classroom-state-snapshot",
        payload: {
          strokes: strokesRef.current,
          texts: textsRef.current,
          grid: gridConfigRef.current,
          background: backgroundRef.current,
          images: imagesRef.current,
          referenceDoc: referenceDocRef.current,
          referenceStrokes: referenceStrokesRef.current,
        },
      });
    });

    let joined = false;
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        joined = true;
        channel.send({ type: "broadcast", event: "reference-request", payload: {} });
        // Re-joined after being away (idle pause, sleep, dropped Wi-Fi):
        // fetch what changed meanwhile. The first join is covered by the
        // initial load.
        if (connectedOnceRef.current) catchUpWithServer();
        else retryUnsaved(sync);
        connectedOnceRef.current = true;
      }
    });
    channelRef.current = channel;
    // If the join hasn't gone through after a few seconds (the old
    // connection was still closing), give the connection a nudge.
    const joinWatchdog = setInterval(() => {
      if (joined) clearInterval(joinWatchdog);
      else nudgeRealtime();
    }, 4000);

    return () => {
      clearInterval(joinWatchdog);
      supabase.removeChannel(channel);
      channelRef.current = null;
      // Half-drawn strokes from others would otherwise stay stuck on screen.
      remoteStrokes.current = {};
    };
  }, [boardId, syncPaused]);

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
    // Coalesced to one resize per animation frame, so dragging the
    // reference-pane divider doesn't reallocate the canvas many times per
    // frame (noticeable on older iPads).
    let resizeFrame = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrame !== null) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        resizeCanvas();
      });
    });
    if (boardPaneRef.current) resizeObserver.observe(boardPaneRef.current);

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    // Every throttled broadcast in this file shares this interval. It was
    // previously requestAnimationFrame-based, which ties message rate to
    // display refresh rate — up to ~120/sec on newer high-refresh-rate
    // iPads/phones, not just the ~60/sec a normal screen implies. That
    // was the dominant source of Supabase Realtime message volume: a
    // single sustained stroke could generate hundreds of messages by
    // itself. A fixed, lower interval cuts that by roughly 3.5-7x
    // depending on the device, while still looking live to whoever's
    // watching — their OWN drawing is never affected, since local
    // rendering never goes through the network at all, and incoming
    // points are already smoothed into curves on arrival regardless of
    // how large a batch they come in.
    const BROADCAST_THROTTLE_MS = 60;

    function scheduleBroadcastFlush() {
      if (rafId.current) return;
      rafId.current = setTimeout(() => {
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
      }, BROADCAST_THROTTLE_MS);
    }

    function scheduleStraightBroadcast(worldStart, worldEnd) {
      pendingStraightUpdate.current = { start: worldStart, end: worldEnd };
      if (rafId.current) return;
      rafId.current = setTimeout(() => {
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
      }, BROADCAST_THROTTLE_MS);
    }

    function scheduleShapeBroadcast(worldPoints) {
      pendingShapeUpdate.current = worldPoints;
      if (rafId.current) return;
      rafId.current = setTimeout(() => {
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
      }, BROADCAST_THROTTLE_MS);
    }

    function scheduleGridBroadcast(grid) {
      pendingGridUpdate.current = grid;
      if (gridRafId.current) return;
      gridRafId.current = setTimeout(() => {
        gridRafId.current = null;
        if (!pendingGridUpdate.current) return;
        const g = pendingGridUpdate.current;
        pendingGridUpdate.current = null;
        channelRef.current?.send({ type: "broadcast", event: "grid-set", payload: { grid: g } });
      }, BROADCAST_THROTTLE_MS);
    }

    function scheduleTextMoveBroadcast(textId, x, y) {
      pendingTextMoveUpdate.current = { textId, x, y };
      if (textMoveRafId.current) return;
      textMoveRafId.current = setTimeout(() => {
        textMoveRafId.current = null;
        if (!pendingTextMoveUpdate.current) return;
        const payload = pendingTextMoveUpdate.current;
        pendingTextMoveUpdate.current = null;
        channelRef.current?.send({ type: "broadcast", event: "text-move", payload });
      }, BROADCAST_THROTTLE_MS);
    }

    function scheduleTextTransformBroadcast(textId, partial) {
      pendingTextTransformUpdate.current = { textId, ...partial };
      if (textTransformRafId.current) return;
      textTransformRafId.current = setTimeout(() => {
        textTransformRafId.current = null;
        if (!pendingTextTransformUpdate.current) return;
        const payload = pendingTextTransformUpdate.current;
        pendingTextTransformUpdate.current = null;
        channelRef.current?.send({ type: "broadcast", event: "text-transform", payload });
      }, BROADCAST_THROTTLE_MS);
    }

    function finalizeStroke(strokeId) {
      if (rafId.current) {
        clearTimeout(rafId.current);
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
      setScratchNotice(null);
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

    // Browsers don't actually expose whether a wheel event came from a
    // mouse or a trackpad — this is the same practical heuristic most
    // canvas apps rely on in its place: a traditional wheel reports one
    // big, fixed-size "tick" per notch (often exactly 100, or line/page
    // mode entirely), while a trackpad reports lots of small, continuous,
    // often-fractional movement with no fixed step. Not literally
    // guaranteed on every device, but correct for the vast majority.
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
        // Trackpad pinch (or explicit Ctrl+scroll) — deltaY is small and
        // continuous, so a proportional exponential step feels smooth.
        const zoomFactor = Math.exp(-e.deltaY * 0.01);
        newScale = scaleRef.current * zoomFactor;
      } else if (isLikelyMouseWheel(e)) {
        // A plain mouse wheel tick — a fixed percentage step per tick
        // feels natural here; reusing the trackpad's proportional
        // formula against a wheel's much larger delta would produce a
        // jarring, oversized jump instead of a gentle zoom step.
        const step = 0.1;
        newScale = scaleRef.current * (e.deltaY < 0 ? 1 + step : 1 - step);
      }

      if (newScale !== null) {
        newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
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
        const cols = 10;
        // Same zoom-relative sizing as the dialog (see handleApplyGridConfig)
        // so a grid placed directly with the armed tool looks just as
        // reasonable at your current zoom as one placed via the dialog.
        const defaultWorldSize = (48 / scaleRef.current) * cols;
        const newGrid = {
          x: worldPos.x - defaultWorldSize / 2,
          y: worldPos.y - defaultWorldSize / 2,
          size: defaultWorldSize,
          cols,
        };
        gridConfigRef.current = newGrid;
        fullRedraw();
        scheduleGridBroadcast(newGrid);
        setGridToolActive(false);
        setTool(toolBeforeGridRef.current || "pen");
        return;
      }

      const rows = grid.type === "polar" ? grid.cols : grid.rows || grid.cols;
      const height = (grid.size / grid.cols) * rows;
      const topLeftScreen = worldToScreen({ x: grid.x, y: grid.y });
      const bottomRightScreen = worldToScreen({ x: grid.x + grid.size, y: grid.y + height });
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
        setGridCellSizeCm(newSize / updated.cols / WORLD_UNITS_PER_CM);
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

    // ---------- whole-stroke eraser ----------
    function strokeEraseAt(from, to) {
      const session = strokeEraseRef.current;
      if (!session) return;
      const scale = scaleRef.current;
      const tolerance = widthForTool("eraser", widthRef.current) / 2 + 2 / scale;
      const steps = Math.max(1, Math.ceil(distance(from, to) / 4));
      let changed = false;
      for (let i = 0; i <= steps; i++) {
        const p = screenToWorld({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
        for (let guard = 0; guard < 20; guard++) {
          const hit = hitTestStrokes(strokesRef.current, p, tolerance);
          if (!hit) break;
          session.removed.push(hit);
          strokesRef.current = strokesRef.current.filter((x) => x.id !== hit.id);
          changed = true;
        }
      }
      if (changed) fullRedraw();
    }

    function finishStrokeErase() {
      const session = strokeEraseRef.current;
      strokeEraseRef.current = null;
      if (!session || !session.removed.length) return;
      const ids = session.removed.map((x) => x.id);
      applyRemove({ strokes: ids, texts: [], images: [] });
      pushUndo({ op: "remove", data: { strokes: session.removed, texts: [], images: [] } });
    }

    // ---------- scribble to erase ----------
    function tryScratchOut(stroke) {
      if (stroke.tool !== "pen" || !getScribbleErase()) return false;
      if (rulerActiveRef.current || compassActiveRef.current) return false;
      const hit = detectScratchOut(
        stroke,
        { strokes: strokesRef.current, texts: textsRef.current, textHeight: textHeightOf },
        scaleRef.current
      );
      if (!hit) return false;
      const data = getObjectsData({ strokes: hit.strokeIds, texts: hit.textIds, images: [] });
      // The scribble itself goes too (other people already saw it arrive).
      applyRemove({ strokes: [...hit.strokeIds, stroke.id], texts: hit.textIds, images: [] });
      const entry = { op: "remove", data };
      pushUndo(entry);
      scratchEntryRef.current = entry;
      setScratchNotice({ count: hit.strokeIds.length + hit.textIds.length, at: Date.now() });
      if (scratchTimerRef.current) clearTimeout(scratchTimerRef.current);
      scratchTimerRef.current = setTimeout(() => setScratchNotice(null), 5000);
      fullRedraw();
      return true;
    }

    function startGroupMove(pos, pointerId) {
      const data = getObjectsData(selectionRef.current);
      groupMoveRef.current = {
        startPos: pos,
        dx: 0,
        dy: 0,
        moved: false,
        sel: selectionFromData(data),
        orig: {
          strokes: new Map(data.strokes.map((o) => [o.id, o])),
          texts: new Map(data.texts.map((o) => [o.id, o])),
          images: new Map(data.images.map((o) => [o.id, o])),
        },
        origBounds: boundsOfData(data),
      };
      try { canvas.setPointerCapture(pointerId); } catch (err) {}
    }

    // Live preview of a group drag: the refs are updated directly for
    // speed; React state is only updated once, on release.
    function previewGroupMove(dx, dy) {
      const g = groupMoveRef.current;
      g.dx = dx;
      g.dy = dy;
      const map = (list, orig, fn) => list.map((o) => (orig.has(o.id) ? fn(orig.get(o.id), dx, dy) : o));
      if (g.orig.strokes.size) strokesRef.current = map(strokesRef.current, g.orig.strokes, translateStroke);
      if (g.orig.texts.size) textsRef.current = map(textsRef.current, g.orig.texts, translateText);
      if (g.orig.images.size) imagesRef.current = map(imagesRef.current, g.orig.images, translateImage);
      fullRedraw();
    }

    function cancelSelectionDrag() {
      if (groupMoveRef.current) {
        previewGroupMove(0, 0);
        groupMoveRef.current = null;
      }
      if (imageResizeRef.current) {
        const { orig } = imageResizeRef.current;
        imagesRef.current = imagesRef.current.map((i) => (i.id === orig.id ? orig : i));
        imageResizeRef.current = null;
      }
      marqueeRef.current = null;
      fullRedraw();
    }

    function handlePointerDown(e) {
      const pos = getPos(e);

      if (e.pointerType === "pen") {
        notePenActivity();
        markPenSeen();
        // First time a stylus is used on this device: switch to
        // Pencil-only drawing automatically (the user can turn it back off
        // from the toolbar, and that choice sticks).
        if (isPencilOnlyUndecided()) {
          setPencilOnly(true);
          setShowPencilOnlyNotice(true);
        }
      }

      if (e.pointerType === "touch") {
        touchPoints.current.set(e.pointerId, pos);
      }

      if (touchPoints.current.size >= 2) {
        cancelActiveDrawing();
        cancelSelectionDrag();
        finishStrokeErase();
        movingTextRef.current = null;
        if (panDragActive.current) {
          panDragActive.current = false;
          panDragStart.current = null;
          setPanToolActive(false);
          setTool(toolBeforePanRef.current || "pen");
        }
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
        // Pencil-only + a touch right after the Pencil was used = a resting
        // palm: don't let it drop or replace what the Pencil selected.
        if (e.pointerType === "touch" && getPencilOnly() && msSincePenActivity() < 1500) {
          return;
        }
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

        const sel = selectionRef.current;
        const count = selectionCount(sel);

        // A single selected image: its corner handle resizes it.
        if (count === 1 && sel.images.length === 1) {
          const img = imagesRef.current.find((i) => i.id === sel.images[0]);
          if (img) {
            const corner = worldToScreen({ x: img.x + img.width, y: img.y + img.height });
            if (distance(pos, corner) < 24) {
              imageResizeRef.current = { id: img.id, startPos: pos, orig: { ...img } };
              canvas.setPointerCapture(e.pointerId);
              repositionSelectionOverlay();
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
          setSelection({ strokes: [], texts: [hit.id], images: [] });
          openTextEditorForEdit(hit);
          return;
        }

        // Pressing inside the current (multi-)selection drags all of it.
        const singleText = count === 1 && sel.texts.length === 1;
        if (count > 0 && !singleText) {
          const b = getSelectionBounds();
          const pad = 8 / scaleRef.current;
          if (b && worldPos.x >= b.minX - pad && worldPos.x <= b.maxX + pad && worldPos.y >= b.minY - pad && worldPos.y <= b.maxY + pad) {
            startGroupMove(pos, e.pointerId);
            return;
          }
        }

        if (hit) {
          setSelection({ strokes: [], texts: [hit.id], images: [] });
          startGroupMove(pos, e.pointerId);
          return;
        }

        const hitStroke = hitTestStrokes(strokesRef.current, worldPos, 10 / scaleRef.current);
        const hitImage = hitStroke ? null : hitTestImages(imagesRef.current, worldPos);
        if (hitStroke || hitImage) {
          setSelection({
            strokes: hitStroke ? [hitStroke.id] : [],
            texts: [],
            images: hitImage ? [hitImage.id] : [],
          });
          startGroupMove(pos, e.pointerId);
          return;
        }

        // Empty space: start a selection box.
        setSelection(emptySelection());
        marqueeRef.current = { start: worldPos, current: worldPos, startPos: pos };
        canvas.setPointerCapture(e.pointerId);
        repositionSelectionOverlay();
        return;
      }

      if (toolRef.current === "text") {
        // Tapping the board while a text box is open finishes that box
        // first (it used to jump the half-typed text to the new spot).
        if (editingTextRef.current) {
          textareaElRef.current?.blur();
          return;
        }
        openTextEditor(screenToWorld(pos));
        return;
      }

      // Pencil-only mode: fingers (and resting palms) never draw. They can
      // still select, place text and move the board — two fingers pan and
      // zoom through the multi-touch branch above.
      if (e.pointerType === "touch" && getPencilOnly()) {
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

      if (toolRef.current === "eraser" && getEraserMode() === "stroke" && !compassActiveRef.current) {
        strokeEraseRef.current = { pointerId: e.pointerId, last: pos, removed: [] };
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
        strokeEraseAt(pos, pos);
        return;
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
      if (e.pointerType === "pen") notePenActivity();
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

      if (strokeEraseRef.current) {
        if (e.pointerId !== strokeEraseRef.current.pointerId) return;
        const pos = getPos(e);
        strokeEraseAt(strokeEraseRef.current.last, pos);
        if (strokeEraseRef.current) strokeEraseRef.current.last = pos;
        return;
      }

      if (groupMoveRef.current) {
        const pos = getPos(e);
        const g = groupMoveRef.current;
        if (!g.moved && distance(pos, g.startPos) < 3) return;
        g.moved = true;
        previewGroupMove((pos.x - g.startPos.x) / scaleRef.current, (pos.y - g.startPos.y) / scaleRef.current);
        return;
      }

      if (imageResizeRef.current) {
        const pos = getPos(e);
        const r = imageResizeRef.current;
        const dx = (pos.x - r.startPos.x) / scaleRef.current;
        const dy = (pos.y - r.startPos.y) / scaleRef.current;
        const aspect = r.orig.height / r.orig.width;
        // Follow whichever direction was dragged further, keeping the shape.
        const grow = Math.abs(dx) >= Math.abs(dy) ? dx : dy / aspect;
        const width = Math.max(24 / scaleRef.current, r.orig.width + grow);
        r.last = { ...r.orig, width, height: width * aspect };
        imagesRef.current = imagesRef.current.map((i) => (i.id === r.orig.id ? r.last : i));
        selectionBoundsCacheRef.current = null;
        fullRedraw();
        return;
      }

      if (marqueeRef.current) {
        marqueeRef.current.current = screenToWorld(getPos(e));
        repositionSelectionOverlay();
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
      if (strokeEraseRef.current && e.changedTouches.length) {
        // iPad: the Pencil's movement arrives here while it's on the glass.
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          const pos = { x: t.clientX - rect.left, y: t.clientY - rect.top };
          strokeEraseAt(strokeEraseRef.current.last, pos);
          if (strokeEraseRef.current) strokeEraseRef.current.last = pos;
        }
        return;
      }
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
      if (e.pointerType === "pen") notePenActivity();
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
        setPanToolActive(false);
        setTool(toolBeforePanRef.current || "pen");
        return;
      }

      if (gridDragMode.current) {
        gridDragMode.current = null;
        gridDragStart.current = null;
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
        saveGrid();
        return;
      }

      if (groupMoveRef.current) {
        const g = groupMoveRef.current;
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
        const { dx, dy } = g;
        if (g.moved && (dx || dy)) {
          // Put the refs back and let the state update (plus broadcast +
          // save) apply the move once.
          previewGroupMove(0, 0);
          groupMoveRef.current = null;
          applyMove(g.sel, dx, dy);
          pushUndo({ op: "move", sel: g.sel, dx, dy });
        } else {
          groupMoveRef.current = null;
        }
        repositionSelectionOverlay();
        return;
      }

      if (imageResizeRef.current) {
        const r = imageResizeRef.current;
        imageResizeRef.current = null;
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
        if (r.last) {
          setImages((prev) => prev.map((i) => (i.id === r.last.id ? r.last : i)));
          channelRef.current?.send({ type: "broadcast", event: "image-update", payload: { image: r.last } });
          insertImage(r.last);
        }
        repositionSelectionOverlay();
        return;
      }

      if (marqueeRef.current) {
        const m = marqueeRef.current;
        marqueeRef.current = null;
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
        const endPos = getPos(e);
        if (distance(endPos, m.startPos) > 6) {
          const rect = rectFromPoints(m.start, screenToWorld(endPos));
          setSelection(objectsInRect(rect, {
            strokes: strokesRef.current,
            texts: textsRef.current,
            images: imagesRef.current,
          }, textHeightOf));
        } else {
          repositionSelectionOverlay();
        }
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

      if (strokeEraseRef.current && strokeEraseRef.current.pointerId === e.pointerId) {
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
        finishStrokeErase();
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

      if (finished && finished.points.length > 1 && !tryScratchOut(finished)) {
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
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
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
  }, [strokes, texts, images, tool]);

  // Selection / paste / image operations are stored as { op, ... } entries
  // (one entry per action, however many objects it touched); older
  // single-stroke / single-text entries keep their original handling below.
  function undoOp(entry) {
    if (entry.op === "add") {
      const data = getObjectsData(entry.sel);
      const sel = selectionFromData(data);
      if (selectionCount(sel) === 0) return false;
      applyRemove(sel);
      myRedoStack.current.push({ op: "add", data });
    } else if (entry.op === "remove") {
      applyAdd(entry.data);
      myRedoStack.current.push({ op: "remove", sel: selectionFromData(entry.data) });
    } else if (entry.op === "move") {
      applyMove(entry.sel, -entry.dx, -entry.dy);
      myRedoStack.current.push(entry);
    }
    return true;
  }

  function redoOp(entry) {
    if (entry.op === "add") {
      applyAdd(entry.data);
      myStrokeStack.current.push({ op: "add", sel: selectionFromData(entry.data) });
    } else if (entry.op === "remove") {
      const data = getObjectsData(entry.sel);
      applyRemove(selectionFromData(data));
      myStrokeStack.current.push({ op: "remove", data });
    } else if (entry.op === "move") {
      applyMove(entry.sel, entry.dx, entry.dy);
      myStrokeStack.current.push(entry);
    }
  }

  function handleUndo() {
    const last = myStrokeStack.current[myStrokeStack.current.length - 1];
    if (!last) return;

    if (last.op) {
      myStrokeStack.current.pop();
      undoOp(last);
      setSelection(emptySelection());
      setMyUndoAvailable(myStrokeStack.current.length > 0);
      setMyRedoAvailable(myRedoStack.current.length > 0);
      return;
    }

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

    if (last.op) {
      redoOp(last);
      setSelection(emptySelection());
      setMyRedoAvailable(myRedoStack.current.length > 0);
      setMyUndoAvailable(true);
      return;
    }

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

  // Undo from the "Scribbled out" note — only if that's still the latest
  // thing you did (otherwise it would undo something else).
  function handleResumeFromIdle(e) {
    if (e && e.type === "pointerdown") {
      e.preventDefault();
      e.stopPropagation();
    }
    resumeFromIdle();
  }

  function handleUndoScratch() {
    const stack = myStrokeStack.current;
    if (scratchEntryRef.current && stack[stack.length - 1] === scratchEntryRef.current) handleUndo();
    scratchEntryRef.current = null;
    setScratchNotice(null);
  }

  function handleClear() {
    if (strokes.length === 0 && texts.length === 0 && images.length === 0) return;
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
      supabase.from("images").delete().eq("board_id", boardId).then(({ error }) => {
        if (error) console.warn("Error clearing images:", error);
      });
    }
  }

  // ---------- idle pause + unsaved work ----------

  useEffect(() => startIdleWatch(), []);

  useEffect(() => {
    if (idlePaused && liveClassCode) resumeFromIdle();
  }, [idlePaused, liveClassCode]);

  // While paused, the first key press wakes the board instead of acting
  // as a shortcut on a board that's out of date.
  useEffect(() => {
    if (!syncPaused) return;
    function onKey(e) {
      e.preventDefault();
      e.stopPropagation();
      resumeFromIdle();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [syncPaused]);

  useEffect(() => {
    setExistsCheck(
      sync,
      (id) =>
        strokesRef.current.some((o) => o.id === id) ||
        textsRef.current.some((o) => o.id === id) ||
        imagesRef.current.some((o) => o.id === id)
    );
    function onOnline() {
      retryUnsaved(sync);
    }
    // Leaving with work that hasn't reached the server yet: ask first.
    function onBeforeUnload(e) {
      if (unsavedCount(sync) > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("online", onOnline);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  // Refresh the boards-list preview a few seconds after the board changes,
  // and straight away when leaving the page.
  useEffect(() => {
    scheduleThumbnail();
  }, [strokes, texts, images, boardBackground]);

  useEffect(() => {
    function flush() {
      if (thumbTimerRef.current) saveThumbnail();
    }
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  // Keyboard shortcuts and system copy / cut / paste. The handlers read the
  // latest versions of these functions through a ref, so the listeners are
  // attached only once.
  useEffect(() => {
    shortcutHandlersRef.current = {
      copySelection, cutSelection, deleteSelection, duplicateSelection, selectAll,
      handleUndo, handleRedo, pasteFromSources,
      clearSelection: () => setSelection(emptySelection()),
    };
  });

  useEffect(() => {
    // True when the keys / clipboard belong to something other than the
    // board: a text field, the calculator (its maths box is a <math-field>,
    // which isn't an input as far as the browser is concerned), or anything
    // else that marks itself with data-board-shortcuts="off". Without this,
    // Cmd+A in the calculator selected the whole board, and Backspace there
    // deleted whatever was selected on it.
    function isTypingTarget(el) {
      if (!el || !el.tagName) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "MATH-FIELD" || el.isContentEditable) return true;
      return !!(el.closest && el.closest('math-field, [data-board-shortcuts="off"]'));
    }
    function hasSelection() {
      return toolRef.current === "select" && selectionCount(selectionRef.current) > 0;
    }
    function onKeyDown(e) {
      if (isTypingTarget(e.target) || editingTextRef.current) return;
      const h = shortcutHandlersRef.current;
      if (!h) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = (e.key || "").toLowerCase();
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) h.handleRedo();
        else h.handleUndo();
        return;
      }
      if (mod && key === "y") {
        e.preventDefault();
        h.handleRedo();
        return;
      }
      if (mod && key === "a") {
        e.preventDefault();
        h.selectAll();
        return;
      }
      if (!hasSelection()) return;
      if (mod && key === "c") h.copySelection();
      else if (mod && key === "x") h.cutSelection();
      else if (mod && key === "d") {
        e.preventDefault();
        h.duplicateSelection();
      } else if (!mod && (key === "delete" || key === "backspace")) {
        e.preventDefault();
        h.deleteSelection();
      } else if (key === "escape") {
        h.clearSelection();
      }
    }
    // Marks the system clipboard synchronously during a real copy / cut, so
    // a later paste knows our selection is the newest thing copied.
    function onCopyOrCut(e) {
      if (isTypingTarget(e.target) || editingTextRef.current || !hasSelection()) return;
      if (e.clipboardData) {
        e.clipboardData.setData("text/plain", CLIPBOARD_MARKER);
        e.preventDefault();
        clipboardMarkedRef.current = true;
      }
    }
    function onPaste(e) {
      if (isTypingTarget(e.target) || editingTextRef.current) return;
      const h = shortcutHandlersRef.current;
      const cd = e.clipboardData;
      if (!h || !cd) return;
      const files = imageFilesFrom(cd.files);
      if (!files.length && cd.items) {
        for (const item of Array.from(cd.items)) {
          if (item.kind === "file" && item.type.indexOf("image/") === 0) {
            const f = item.getAsFile();
            if (f) files.push(f);
          }
        }
      }
      e.preventDefault();
      h.pasteFromSources({ files, text: cd.getData("text/plain") });
    }
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("copy", onCopyOrCut);
    document.addEventListener("cut", onCopyOrCut);
    document.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("copy", onCopyOrCut);
      document.removeEventListener("cut", onCopyOrCut);
      document.removeEventListener("paste", onPaste);
    };
  }, []);

  const showReferencePane = canUseReferencePane && !!referenceDoc;
  const refMode = refStacked ? "stacked" : "side";
  const refFraction = refDragFraction ?? (refStacked ? savedRefFractionStacked : savedRefFractionSide);

  // Keeps both panes usable: the document never gets narrower/shorter than
  // a readable minimum, and neither does the board.
  function clampRefFraction(fraction, totalPx) {
    const minPane = refStacked ? 160 : 260;
    const minBoard = (refStacked ? 220 : 320) + 14; // + the divider's width
    if (!totalPx) return Math.min(0.8, Math.max(0.2, fraction));
    const lo = minPane / totalPx;
    const hi = Math.max(lo, (totalPx - minBoard) / totalPx);
    return Math.min(hi, Math.max(lo, fraction));
  }

  function handleRefDividerDrag(fraction, totalPx) {
    setRefDragFraction(clampRefFraction(fraction, totalPx));
  }

  function handleRefDividerDragEnd(fraction, totalPx) {
    setRefFraction(refMode, clampRefFraction(fraction, totalPx));
    setRefDragFraction(null);
  }

  function handleRefSnap(fraction) {
    const rect = workAreaRef.current?.getBoundingClientRect();
    const total = rect ? (refStacked ? rect.height : rect.width) : 0;
    setRefFraction(refMode, clampRefFraction(fraction, total));
  }

  const statusText =
    referenceUploadStatus ||
    saveStatus ||
    (demo ? "Demo board · nothing here is saved" : liveClassCode ? "Live class running" : "Saves automatically");

  return (
    <div className="wb-root">
      <Toolbar
        boardName={boardName}
        statusText={statusText}
        isOwner={isOwner}
        demo={demo}
        tool={tool}
        panToolActive={panToolActive}
        onSelectTool={handleSelectTool}
        onSelectMove={handleSelectMove}
        color={color}
        setColor={setColor}
        strokeWidth={strokeWidth}
        setStrokeWidth={setStrokeWidth}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onClear={handleClear}
        canUndo={myUndoAvailable}
        canRedo={myRedoAvailable}
        rulerActive={rulerActive}
        onToggleRuler={handleToggleRuler}
        compassActive={compassActive}
        onToggleCompass={handleToggleCompass}
        getHasGrid={getHasGrid}
        background={boardBackground}
        onSetBackground={handleSetBackground}
        onInsertImage={handleInsertImageClick}
        eraserMode={eraserMode}
        onSetEraserMode={setEraserMode}
        scribbleErase={scribbleErase}
        onSetScribbleErase={setScribbleErase}
        onPaste={handlePasteButton}
        onSelectAll={selectAll}
        hasSelection={selectionCount(selection) > 0}
        gridToolActive={gridToolActive}
        onOpenGraph={handleOpenGraph}
        onFinishGraphMove={handleFinishGraphMove}
        onRemoveGrid={handleRemoveGrid}
        calculatorActive={calculatorActive}
        onToggleCalculator={handleToggleCalculator}
        canInsertReference={isOwner && canUseReferencePane}
        hasReferenceDoc={!!referenceDoc}
        onReferenceToolClick={handleReferenceToolClick}
        onOpenSimModal={handleOpenSimModal}
        onCopyLink={handleCopyLink}
        onStartLiveClass={handleStartLiveClass}
        onEndSession={handleEndSession}
        liveClassCode={liveClassCode}
        classRoster={classRoster}
        onViewStudent={(student) => setViewingStudent(student)}
        onEndLiveClass={handleEndLiveClass}
        penSeen={penSeen}
        pencilOnly={pencilOnly}
        onSetPencilOnly={setPencilOnly}
        zoomPercent={zoomPercent}
        onResetView={handleResetView}
      />
      <div
        ref={workAreaRef}
        style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: refStacked ? "column" : "row" }}
      >
      {showReferencePane && refCollapsed && (
        <PalmSafeButton
          aria-label={`Show reference document ${referenceDoc.fileName}`}
          onPress={() => setRefCollapsed(false)}
          style={
            refStacked
              ? {
                  flex: "0 0 44px", display: "flex", alignItems: "center", gap: 8, padding: "0 16px",
                  border: "none", borderBottom: "2px solid var(--ink-line)", background: "var(--sticky-y)",
                  color: "var(--ink)", fontSize: 13.5, cursor: "pointer", textAlign: "left",
                }
              : {
                  flex: "0 0 44px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
                  padding: "14px 0", border: "none", borderRight: "2px solid var(--ink-line)",
                  background: "var(--sticky-y)", color: "var(--ink)", fontSize: 13, cursor: "pointer",
                }
          }
        >
          <FileText size={18} strokeWidth={1.8} />
          <span style={refStacked ? { fontWeight: 600 } : { writingMode: "vertical-rl", fontWeight: 600 }}>
            Show reference
          </span>
          {refStacked && (
            <span style={{ color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {referenceDoc.fileName}
            </span>
          )}
        </PalmSafeButton>
      )}
      {showReferencePane && (
        <div
          style={{
            // Hidden (not unmounted) while collapsed, so the PDF doesn't
            // have to reload when it's shown again.
            display: refCollapsed ? "none" : "flex",
            flexDirection: "column",
            flex: `0 0 ${(refFraction * 100).toFixed(2)}%`,
            minWidth: refStacked ? 0 : 260,
            maxWidth: refStacked ? "none" : "calc(100% - 334px)",
            minHeight: refStacked ? 160 : 0,
            maxHeight: refStacked ? "calc(100% - 234px)" : "none",
            background: "#ECEAE4",
            backgroundImage: "linear-gradient(rgba(27,29,36,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(27,29,36,0.04) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: 46,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 8px 0 14px",
              backgroundColor: "var(--paper)",
              backgroundImage: "var(--paper-grid)",
              backgroundSize: "24px 24px",
              borderBottom: "2px solid var(--ink-line)",
              fontSize: 13,
              color: "var(--ink)",
            }}
          >
            <FileText size={16} strokeWidth={1.8} color="var(--ink-2)" style={{ flexShrink: 0 }} />
            <span style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {referenceDoc.fileName}
            </span>
            <div
              role="group"
              aria-label="Reference document size"
              style={{ display: "flex", flexShrink: 0, border: "1.5px solid var(--ink-line)", borderRadius: 10, overflow: "hidden", background: "var(--surface)" }}
            >
              {[["⅓", 1 / 3, "One third of the screen"], ["½", 1 / 2, "Half the screen"], ["⅔", 2 / 3, "Two thirds of the screen"]].map(
                ([label, value, title], i) => (
                  <PalmSafeButton
                    key={label}
                    aria-label={title}
                    onPress={() => handleRefSnap(value)}
                    style={{
                      width: 32, height: 30, border: "none", borderLeft: i ? "1.5px solid var(--ink-line)" : "none",
                      background: "var(--surface)", color: "var(--ink)", fontSize: 14, fontWeight: 600, cursor: "pointer", padding: 0,
                    }}
                  >
                    {label}
                  </PalmSafeButton>
                )
              )}
            </div>
            <PalmSafeButton
              aria-label="Hide the reference document"
              onPress={() => setRefCollapsed(true)}
              style={{
                width: 36, height: 36, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                border: "1.5px solid var(--ink-line)", borderRadius: 10, background: "var(--surface)", color: "var(--ink)", cursor: "pointer",
              }}
            >
              {refStacked ? <PanelTopClose size={18} strokeWidth={1.8} /> : <PanelLeftClose size={18} strokeWidth={1.8} />}
            </PalmSafeButton>
            {isOwner && (
              <PalmSafeButton
                onPress={handleRemoveReferenceDoc}
                style={{
                  height: 34, flexShrink: 0, padding: "0 11px", border: "1.5px solid var(--danger)", borderRadius: 10,
                  background: "var(--surface)", color: "var(--danger)", fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}
              >
                Remove
              </PalmSafeButton>
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
      {showReferencePane && !refCollapsed && (
        <SplitDivider
          orientation={refStacked ? "horizontal" : "vertical"}
          containerRef={workAreaRef}
          valueNow={refFraction}
          onDrag={handleRefDividerDrag}
          onDragEnd={handleRefDividerDragEnd}
          onReset={() => {
            setRefDragFraction(null);
            setRefFraction(refMode, DEFAULT_REF_FRACTION);
          }}
        />
      )}

      <div
        ref={boardPaneRef}
        data-board-pane="true"
        onDragOver={handleBoardDragOver}
        onDrop={handleBoardDrop}
        style={{
          position: "relative",
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
          // A transform on this container makes it the "containing block"
          // for any position:fixed descendant inside it (toolbar, ruler,
          // zoom menu, etc.) instead of the full browser viewport — so all
          // of that UI automatically anchors to just this pane, with zero
          // changes needed inside those components themselves.
          transform: "translate(0, 0)",
        }}
      >
        {/* The page ("paper") layer: white plus the chosen pattern, drawn
            behind the transparent ink canvas. It's a separate element
            because browsers don't reliably paint background images on a
            GPU-backed canvas itself. z-index -1 keeps it under the canvas
            and everything else in this pane (the transform above makes
            the pane its own stacking context). */}
        <div
          ref={pageBgRef}
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, zIndex: -1, backgroundColor: "#ffffff", pointerEvents: "none" }}
        />
        {/* Pictures sit on the page, under the ink, so you can write on
            top of them and the eraser never rubs them out. Positioned by
            repositionImages() as the board pans and zooms. */}
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
            className={chrome.boardImage}
          />
        ))}
        {viewingStudent && liveClassCode && (
          <TeacherStudentBoardView
            code={liveClassCode}
            student={viewingStudent}
            onBack={() => setViewingStudent(null)}
          />
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
            cursor: panToolActive ? "grab" : "default",
          }}
        />
        <div ref={marqueeElRef} aria-hidden="true" className={chrome.marquee} />
        <div ref={selectionBoxElRef} aria-hidden="true" className={chrome.selectionBox}>
          <span className={chrome.selectionHandle} />
        </div>
        <div ref={selectionBarElRef} role="toolbar" aria-label="Selected items" className={chrome.selectionBar}>
          <PalmSafeButton className={chrome.selBtn} onPress={() => copySelection()}>
            <Copy size={17} strokeWidth={1.9} />
            Copy
          </PalmSafeButton>
          <PalmSafeButton className={chrome.selBtn} onPress={cutSelection}>
            <Scissors size={17} strokeWidth={1.9} />
            Cut
          </PalmSafeButton>
          <PalmSafeButton className={chrome.selBtn} onPress={duplicateSelection}>
            <CopyPlus size={17} strokeWidth={1.9} />
            Duplicate
          </PalmSafeButton>
          <span className={chrome.selDivider} />
          <PalmSafeButton className={`${chrome.selBtn} ${chrome.selBtnDanger}`} onPress={deleteSelection}>
            <Trash2 size={17} strokeWidth={1.9} />
            Delete
          </PalmSafeButton>
        </div>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          onChange={handleImageInputChange}
          style={{ display: "none" }}
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
            onInsertToBoard={pastePlainText}
          />
        )}
        {gridModalOpen && (
          <GridToolModal
            initialConfig={gridModalInitialConfig}
            currentZoomScale={gridModalZoomScale}
            onApply={handleApplyGridConfig}
            onClose={handleCloseGridModal}
          />
        )}
        {sims.map((sim) => (
          <SimEmbed
            key={sim.id}
            sim={sim}
            scaleRef={scaleRef}
            onMove={handleMoveSimEmbed}
            onResize={handleResizeSimEmbed}
            onCommit={handleCommitSimEmbed}
            onRemove={handleRemoveSimEmbed}
            registerNode={(el) => {
              if (el) simNodesRef.current[sim.id] = el;
              else delete simNodesRef.current[sim.id];
            }}
          />
        ))}
        {simModalOpen && <SimEmbedModal onAdd={handleAddSimEmbed} onClose={handleCloseSimModal} />}
        {isOwner && (
          <input
            ref={referenceFileInputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            onChange={handleReferenceFileSelected}
            style={{ display: "none" }}
          />
        )}
        {syncPaused &&
          createPortal(
          <div
            className={chrome.idleOverlay}
            role="dialog"
            aria-modal="true"
            aria-labelledby="idle-title"
            onPointerDown={handleResumeFromIdle}
          >
            <div className={chrome.idleCard}>
              <span className={chrome.idleIcon} aria-hidden="true">
                <Moon size={22} />
              </span>
              <h2 id="idle-title" className={chrome.idleTitle}>
                Paused while you were away
              </h2>
              <p className={chrome.idleBody}>
                Nothing happened on this board for 20 minutes, so live syncing paused to save data.{" "}
                {unsaved > 0 ? "A few changes are still waiting to save — they'll go through when you continue." : "Everything is saved."}
              </p>
              <button type="button" className={chrome.idleBtn} onClick={handleResumeFromIdle} autoFocus>
                Pick up where you left off
              </button>
              <span className={chrome.idleHint}>or tap anywhere</span>
            </div>
          </div>,
            document.body
          )}
        {(showPencilOnlyNotice || showPencilTip || boardNotice || scratchNotice || catchingUp || unsaved > 0) && (
          <div
            style={{
              position: "fixed",
              top: 12,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 30,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            {catchingUp && (
              <div role="status" className={`${chrome.boardNotice} ${chrome.syncNotice}`}>
                <span className={chrome.syncDot} aria-hidden="true" />
                Catching up on changes…
              </div>
            )}
            {unsaved > 0 && !catchingUp && (
              <div role="status" className={`${chrome.boardNotice} ${chrome.syncNotice}`}>
                <span className={`${chrome.syncDot} ${chrome.syncDotWarn}`} aria-hidden="true" />
                {unsaved === 1 ? "1 change hasn't" : `${unsaved} changes haven't`} saved yet — retrying
              </div>
            )}
            {boardNotice && (
              <div role="status" className={chrome.boardNotice}>
                {boardNotice}
              </div>
            )}
            {scratchNotice && (
              <div role="status" className={`${chrome.boardNotice} ${chrome.undoNotice}`}>
                <span>
                  Scribbled out {scratchNotice.count} {scratchNotice.count === 1 ? "item" : "items"}
                </span>
                <button type="button" className={chrome.undoNoticeBtn} onClick={handleUndoScratch}>
                  Undo
                </button>
              </div>
            )}
            {showPencilOnlyNotice && (
              <div
                style={{
                  maxWidth: "min(92vw, 400px)",
                  background: "var(--ink-line)",
                  color: "#fff",
                  border: "2px solid var(--ink-line)",
                  borderRadius: 12,
                  padding: "12px 14px",
                  boxShadow: "3px 3px 0 var(--accent)",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  fontSize: 13,
                  lineHeight: 1.4,
                }}
              >
                <span style={{ flex: 1 }}>
                  <strong>Pencil detected — only the Pencil draws now.</strong> Fingers can
                  still select and type; use two fingers to move and zoom. Switch this off
                  any time with &ldquo;Pencil only&rdquo; next to the pen colours.
                </span>
                <button
                  onClick={() => setShowPencilOnlyNotice(false)}
                  style={{
                    border: "none",
                    background: "var(--sticky-y)",
                    color: "var(--ink)",
                    fontWeight: 700,
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
            {showPencilTip && (
          <div
            style={{
              maxWidth: "min(92vw, 380px)",
              background: "var(--ink-line)",
              color: "#fff",
              border: "2px solid var(--ink-line)",
              borderRadius: 12,
              padding: "12px 14px",
              boxShadow: "3px 3px 0 var(--accent)",
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
                background: "var(--sticky-y)",
                color: "var(--ink)",
                fontWeight: 700,
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
          </div>
        )}
        <ZoomMenu zoomPercent={zoomPercent} onSelect={handleSetZoom} />
      </div>
      </div>
    </div>
  );
}