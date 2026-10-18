"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import Toolbar from "./Toolbar";
import RulerOverlay, { rulerLength, rulerEdgeAt, rulerProject, rulerMeasure } from "./RulerOverlay";
import CompassOverlay from "./CompassOverlay";
import ZoomMenu from "./ZoomMenu";
import SplitDivider from "./SplitDivider";
import PalmSafeButton from "./PalmSafeButton";
import { FileText, PanelLeftClose, PanelTopClose, Copy, Scissors, CopyPlus, Trash2, Moon, PenLine, LocateFixed, PictureInPicture2, LayoutDashboard } from "lucide-react";
import ReferencePane from "./ReferencePane";
import RefPagePicker from "./RefPagePicker";
import ClipWindows from "./ClipWindows";
import refStyles from "./RefPane.module.css";
import Calculator from "./Calculator";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { getStoredClassCode, clearClassCode, generateClassCode, storeClassCode } from "@/lib/classroomCode";
import {
  rosterFromPresence, newHandsNotice, readStatus,
  createAttendance, attendanceJoin, attendanceLeave, attendanceSync, attendanceState,
} from "@/lib/classRoster";
import TeacherStudentBoardView from "./TeacherStudentBoardView";
import ClassOverview from "./ClassOverview";
import { SendBoardDialog, SaveBoardsDialog } from "./ClassDialogs";
import {
  subscribeClassControl, getClassControl, getServerClassControl, setClassControl,
  getSentQuestion, getServerSentQuestion, setSentQuestion, forgetClass,
  classStateMessage, questionFromBoard, createQuestionSender,
} from "@/lib/classControl";
import { NO_COMMENTS, noComments, NO_SAVE_PROBLEM, noSaveProblem, NO_TEACHER_LAYER, noTeacherLayer } from "@/lib/localBoard";
import { createSendGate } from "@/lib/boardWatch";
import { drawTeacherLayer, hasTeacherLayer } from "@/lib/boardRender";
import StudentComments from "./StudentComments";
import GridToolModal from "./GridToolModal";
import { GraphSliderPanels, GraphReadoutBar } from "./GraphBoardBits";
import {
  createGraphStore, withoutTrace, cleanPlot, curvePointNear, traceAlong, pinNear, readoutValues, worldPointOf, tableObjects,
} from "@/lib/graphPlot";
import { sliderOf } from "@/lib/graphMath";
import SimEmbed from "./SimEmbed";
import SimEmbedModal from "./SimEmbedModal";
import ShapeToolModal from "./ShapeToolModal";
import SettingsPanel from "./SettingsPanel";
import { shapeToBoardObjects, browserTextEnv } from "@/lib/shapeBuilder";
import { renderGrid } from "@/lib/gridRenderer";
import { graphsOf, packGraphs, graphBox, graphAt, translateGraph, placeGraph, snapPoint, snapSpacing, MAX_GRAPHS } from "@/lib/graphList";
import { gridFrame } from "@/lib/graphAxes";
import { browserCanOpenPdfs, PDF_UNSUPPORTED_MESSAGE } from "@/lib/loadPdfjs";
import {
  normalizeDoc, normalizeMark, normalizeMarks, applyMarksChange, chunkList, createBus, docFilePaths, newRefId,
  REF_EVENTS, REF_MAX_PICK, REF_MAX_PAGES, REF_MAX_UPLOAD_BYTES, REF_MAX_READ_BYTES,
} from "@/lib/refDoc";
import { loadReference, saveReferenceDoc, markRow, deleteMarkRows, deleteAllMarks, isMissing as isMissingTable, MARKS_TABLE } from "@/lib/refStore";
import { buildPdf } from "@/lib/refPdf";
import { notePenActivity, msSincePenActivity } from "@/lib/penActivity";
import { applyBackground, normalizeBackground, isDarkBackground } from "@/lib/boardBackground";
import { inkOn } from "@/lib/inkColor";
import { drawText, textBoxHeight, plainText, encodeText, decodeText } from "@/lib/richText";
import { subscribeFonts, uploadFont } from "@/lib/fonts";
import TextEditor from "./TextEditor";
import { loadCalcPosition } from "@/lib/calcMath";
import { detectScratchOut } from "@/lib/scratchOut";
import { getSetting, setSetting, useSetting, displayNameFor, PEN_COLORS } from "@/lib/settings";
import { iconCursor, ringLook, isInkTool } from "@/lib/boardCursor";
import { keyFromEvent, keysWith, actionForKey, createTapGesture, GESTURE_WORDS } from "@/lib/shortcuts";
import { nameFor, personId, wherePayload, sameWhere, peopleFrom, facesKey, viewFor, viewBetween, createPenTags } from "@/lib/boardPeople";
import {
  catchUp,
  createSyncTracker,
  fetchBoardPart,
  forgetUnsaved,
  isRealBackend,
  mergeChanges,
  mergeServerList,
  moveObjects,
  openBoard,
  pictureHash,
  previewHashOf,
  savePreview,
  noteList,
  nudgeRealtime,
  retryUnsaved,
  saveRow, saveRows,
  setExistsCheck,
  setGiveUpHandler,
  subscribeUnsaved,
  syncSince,
  touchBoard,
  unsavedCount,
} from "@/lib/boardSync";
import { useLiveMode, liveChannel, openClassReliably, closeClass } from "@/lib/liveMode";
import { createSender, wholeStroke, cleanIncomingStroke } from "@/lib/liveSend";
import { getServerIdlePaused, isIdlePaused, noteRemoteActivity, resumeFromIdle, startIdleWatch, subscribeIdle } from "@/lib/idleWatch";
import {
  subscribeInkPrefs, getEraserMode, getServerEraserMode, setEraserMode,
  getScribbleErase, getServerScribbleErase, setScribbleErase, getScribbleLevel,
} from "@/lib/inkPrefs";
import { renderBoardThumbnail } from "@/lib/boardThumbnail";
import {
  emptySelection, selectionCount, selectionFromData, strokeBounds, imageBounds, textBounds, unionBounds,
  rectFromPoints, hitTestStrokes, hitTestImages, objectsInRect, translateStroke, translateText,
  translateImage, cloneObjects, chunkObjects, newId, strokeDash, writeInternalClipboard, readInternalClipboard,
  CLIPBOARD_MARKER, prepareImageFile, makeInlineImage, imageFilesFrom, writeClipboardMarker, readSystemClipboard,
} from "@/lib/boardObjects";
import { track } from "@/lib/track";
import chrome from "./StudioChrome.module.css";
import cls from "./Classroom.module.css";
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
const performanceNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
// Where you are on the board goes out to the others at most this often.
const PRESENCE_GAP_MS = 800;
const MAX_SCALE = 8;
// A live message can only be so big (Supabase drops anything over about
// 256KB without saying so), so a board sent to someone joining a class
// goes in pieces of at most this many characters.
const SNAPSHOT_CHUNK_CHARS = 60000;
const SNAPSHOT_STROKE_POINTS = 800;
const ERASER_MAX_BOOST = 2;
const ERASER_SENSITIVITY = 0.6;
const ERASER_SMOOTHING = 0.25;
const INTERP_MAX_STEP = 6;
// A "world unit" is a CSS pixel at 100% zoom. Browsers define a CSS pixel
// as 1/96 inch regardless of a device's actual physical pixel density —
// there's no reliable way to know a screen's true DPI from a browser, so
// this is the most accurate basis available (the same one print-to-PDF
// and other browser-native "physical size" features use).

// Clips kept in view over the board (per board, on this screen only).
const CLIP_WINDOWS_KEY = "cleanslate_clip_windows_";
function readClipWindows(boardId) {
  if (!boardId || typeof window === "undefined") return [];
  let raw = null;
  try {
    raw = window.localStorage.getItem(CLIP_WINDOWS_KEY + boardId);
  } catch (err) {
    raw = null;
  }
  let list = [];
  try {
    list = JSON.parse(raw || "[]");
  } catch (err) {
    list = [];
  }
  return Array.isArray(list) ? list.filter((w) => w && w.id && Number.isFinite(w.x) && Number.isFinite(w.y) && Number.isFinite(w.w)).slice(-3) : [];
}
function writeClipWindows(boardId, list) {
  if (!boardId) return;
  try {
    if (list.length) window.localStorage.setItem(CLIP_WINDOWS_KEY + boardId, JSON.stringify(list));
    else window.localStorage.removeItem(CLIP_WINDOWS_KEY + boardId);
  } catch (err) {
    // private browsing: kept for this visit only
  }
}

function opacityForTool(t) {
  return t === "highlighter" ? 0.35 : 1;
}

function widthForTool(t, baseWidth) {
  if (t === "eraser") return baseWidth * 3;
  if (t === "highlighter") return baseWidth * 2.5;
  return baseWidth;
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

// How many strokes / text boxes go to the server in one request.
const SAVE_BATCH = 40;

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

// `student`, `backend`, `active` and `compact` are only passed for a
// student's own board in a live class (see src/app/join/[code]/view/page.js):
//   student  { code, studentId, name } — switches the board to "class board"
//            mode: no app bar, no pictures / simulations / reference
//            documents, and the teacher's comments are shown on it.
//   backend  where the board is kept instead of the database (students
//            never sign in; see src/lib/localBoard.js).
//   active   false while the board is on a hidden tab, so its keyboard
//            shortcuts and paste leave the visible tab alone.
//   compact  true when the board only has part of the screen (shown beside
//            the teacher's board), so the toolbar packs itself tighter.
export default function Whiteboard({
  boardId, demo = false, onDemoClassStart, onDemoClassEnd, initialReferenceDoc = null,
  student = null, backend = null, active = true, compact = false,
}) {
  const { user, signOut } = useAuth();
  // the Settings panel (the gear beside the home button)
  const [settingsOpen, setSettingsOpen] = useState(false); // false, or which tab: "board" | "shortcuts"
  // Loads and saves go here. Live messages always use the real connection.
  const db = backend || supabase;
  // Only who's signed in matters here — not the session object, which is
  // replaced on every token refresh and whenever the tab regains focus.
  const userId = student ? student.studentId : user ? user.id : null;
  const router = useRouter();
  const [isOwner, setIsOwner] = useState(false);
  const [liveClassCode, setLiveClassCode] = useState(null);
  const liveClassChannelRef = useRef(null);
  const [classRoster, setClassRoster] = useState([]); // [{studentId, name, joinedAt, hand, handAt, done}]
  // What students have signalled (studentId -> { hand, handAt, done }), who
  // is here, and whose hands were already up (see src/lib/classRoster.js).
  const classStatusRef = useRef(new Map());
  const classPresenceRef = useRef(null);
  const handsUpRef = useRef(new Map());
  const [viewingStudent, setViewingStudent] = useState(null); // {studentId, name} | null
  const [showRoster, setShowRoster] = useState(false);
  // What the teacher has switched on for the whole class (see
  // src/lib/classControl.js): whose board is being shown to everyone,
  // whether pens are down, and the question that is on every student's board.
  const classControl = useSyncExternalStore(subscribeClassControl, () => getClassControl(liveClassCode), getServerClassControl);
  const sentQuestion = useSyncExternalStore(subscribeClassControl, () => getSentQuestion(liveClassCode), getServerSentQuestion);
  const [classOverview, setClassOverview] = useState(false); // the grid of every student's board
  const [classDialog, setClassDialog] = useState(null); // null | "send" | "save"
  const [sendingQuestion, setSendingQuestion] = useState(false);
  const [questionSender] = useState(createQuestionSender);
  const classStateTimerRef = useRef(null);
  const rosterIdsRef = useRef(new Set());

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

  // Every graph on the board (see graphList.js): saved and sent together
  // as the board's graph setting.
  const graphsRef = useRef([]);
  const gridDragMode = useRef(null); // "trace" while a curve is being read off
  const graphResizeRef = useRef(null); // { id, startPos, orig, last? }
  const lastGraphTapRef = useRef(null); // { id, time }, for a double-tap to edit

  const panToolActiveRef = useRef(false);
  const panDragActive = useRef(false);
  const toolBeforePanRef = useRef("pen");
  // Space held down (or whatever key Settings gives "hold to move"): the
  // Move tool until it's let go
  const holdMoveRef = useRef(false);
  const toolBeforeEraserRef = useRef("pen"); // for the "pen ⇄ eraser" gesture
  // two- and three-finger taps (src/lib/shortcuts.js); the view as it was
  // when the fingers came down, so a tap doesn't nudge the zoom
  const tapViewRef = useRef(null);
  const [tapGesture] = useState(() => createTapGesture({}));
  const panDragStart = useRef(null);

  const clientId = useRef(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  );

  const channelRef = useRef(null);
  const remoteStrokes = useRef({});
  const penTagOwners = useRef({}); // someone else's stroke -> the tab writing it (for the name tag)
  const strokesRef = useRef([]);
  const textsRef = useRef([]);
  const toolRef = useRef("pen");
  const colorRef = useRef("#1a1a1a");
  const widthRef = useRef(4);
  const rulerActiveRef = useRef(false);
  const rulerAngleRef = useRef(0);
  const rulerPosRef = useRef({ x: 300, y: 300 });
  const rulerLenRef = useRef(800);
  // a line being drawn along the ruler's edge: { offset } (null otherwise)
  const rulerEdgeRef = useRef(null);
  const rulerReadoutRef = useRef(null); // the length shown while drawing along it
  const cursorRingRef = useRef(null); // the brush-size ring (boardCursor.js)

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
  const textEditorRef = useRef(null); // TextEditor.js: { place, commit }
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
  const referenceMarksRef = useRef([]);
  // Whether the database can keep the document and its markings (see
  // src/lib/refStore.js), and which document it last said the board had.
  // (null: not known yet, so saves are tried; false: the database can't keep them)
  const refSavedRef = useRef({ docSaved: null, marksSaved: null, serverKey: null });
  // markings rubbed out here whose removal hasn't reached the database yet
  const refDeletingRef = useRef(new Set());
  const refReceiveRef = useRef(null);
  const refRefreshRef = useRef(null);
  const refPaneHandleRef = useRef(null);
  const refAddingRef = useRef(false);
  const imageSourceMissingRef = useRef(false);

  const [strokes, setStrokes] = useState([]);
  const [texts, setTexts] = useState([]);
  const [myUndoAvailable, setMyUndoAvailable] = useState(false);
  const [myRedoAvailable, setMyRedoAvailable] = useState(false);
  const [tool, setTool] = useState("pen");
  // a new board session starts with the teacher's pen colour and size
  // (Settings); a student's board in a live class starts plain
  const [color, setColor] = useState(() => (student ? "#1a1a1a" : getSetting("penColor")));
  const [strokeWidth, setStrokeWidth] = useState(() => (student ? 4 : getSetting("penSize")));
  const [saveStatus, setSaveStatus] = useState("");
  // What the "Finish & save" button shows: idle | saving | saved | error
  const [saveState, setSaveState] = useState("idle");
  const saveStateTimerRef = useRef(null);
  const [rulerActive, setRulerActive] = useState(false);
  const [rulerAngle, setRulerAngle] = useState(0);
  const [rulerPos, setRulerPos] = useState({ x: 300, y: 300 });
  const [rulerLen, setRulerLen] = useState(800);
  const rulerUnits = useSetting("rulerUnits");
  const pointerStyle = useSetting("pointerStyle");
  const [compassActive, setCompassActive] = useState(false);
  const [compassCenter, setCompassCenter] = useState({ x: 300, y: 300 });
  const [compassRadius, setCompassRadius] = useState(100);
  const [compassAngle, setCompassAngle] = useState(-Math.PI / 2);
  const [calculatorActive, setCalculatorActive] = useState(false);
  const [calculatorPos, setCalculatorPos] = useState({ x: 300, y: 200 });
  const [zoomPercent, setZoomPercent] = useState(100);

  // ---------- who else has this board open (src/lib/boardPeople.js) ----------
  // Signed-in boards only: not the demo, not a student's board in a class.
  const peopleOn = !student && !demo && !!user;
  const [people, setPeople] = useState([]); // what the top bar shows
  const peopleRef = useRef({ list: [], byKey: new Map(), faces: "" }); // everything, kept up to date
  // channel: the board's live channel once joined; sent: what we last said
  // about where we are; where: what everyone else last said (tab key ->
  // { view, ink, t }); attendance: who's here (see classRoster.js)
  const presenceRef = useRef({ channel: null, sent: null, timer: null, lastAt: 0, ink: null, where: new Map(), attendance: null, replyTimer: null });
  const [penTags] = useState(() => createPenTags(chrome.penTag));
  const penTagsElRef = useRef(null);
  const outlineElRef = useRef(null);
  const outlineRef = useRef(null); // { rect } of the screen being outlined
  const outlineTimerRef = useRef(null);
  const viewAnimRef = useRef(0);
  const [gridModalOpen, setGridModalOpen] = useState(false);
  // goes up whenever the graphs change (for the boards-list preview)
  const [graphsVersion, setGraphsVersion] = useState(0);
  const [gridModalInitialConfig, setGridModalInitialConfig] = useState(null);
  // the graph the dialog is changing (null: it's adding a new one)
  const editingGraphIdRef = useRef(null);
  // Captured when the dialog opens (never read from a ref during render) so
  // the dialog can show/derive its "cell size" in terms of the zoom level
  // you're actually looking at right now, instead of an absolute physical
  // unit that has no relationship to what's comfortably visible.
  const [gridModalZoomScale, setGridModalZoomScale] = useState(1);
  // The graphs, for the bits of them that sit on the board (the sliders,
  // the read-off bar); the graphs themselves live in graphsRef. A read-off
  // in progress is kept apart: it is shown (and sent to anyone watching)
  // but never saved.
  const [graphStore] = useState(createGraphStore);
  const graphTraceRef = useRef(null); // { graphId, fnId, x, tangent?, pinId? }
  const graphPanelRefs = useRef({}); // the slider panel beside each graph, by id
  const graphBarRef = useRef(null);
  const graphBroadcastTimer = useRef(null);
  const graphSaveTimer = useRef(null);
  const graphSavingRef = useRef({ busy: false, again: false, retries: 0 });

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
  // The Shape dialog: null when closed, otherwise the zoom and the room on
  // screen noted as it opened (never read from a ref during render).
  const [shapeModal, setShapeModal] = useState(null);
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
  // The markings on the reference document (src/lib/refDoc.js).
  const [referenceMarks, setReferenceMarks] = useState([]);
  // "Choose pages" for a PDF that's being added: { file, url, fileName, size, adding, max }
  const [refPicker, setRefPicker] = useState(null);
  // live pointers and "follow me" for the document pane
  const [refBus] = useState(createBus);
  // Phones: the board or the document, full screen.
  const [phoneView, setPhoneView] = useState("board");
  // Clips kept in view over the board, on this screen: [{ id, x, y, w }]
  const [clipWindows, setClipWindows] = useState(() => readClipWindows(boardId));
  const [myRefId] = useState(newRefId);
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
  const restoredNoticeShownRef = useRef(false);
  // "Your work from earlier is back", on a student's board. It waits until
  // the board is actually on screen (after a refresh the class page opens
  // on the teacher's board) and then shows for a few seconds.
  const [restoredNotice, setRestoredNotice] = useState(false);
  // True when the student's device can't keep a copy of the board (its
  // storage is full or switched off). They are told once, for a few
  // seconds, rather than having a note sit on their work all lesson.
  const saveProblemStore = backend && backend.saveProblem ? backend.saveProblem : NO_SAVE_PROBLEM;
  const saveProblem = useSyncExternalStore(saveProblemStore.subscribe, saveProblemStore.get, noSaveProblem);
  const [saveProblemTold, setSaveProblemTold] = useState(false);
  const rlsNoticeShownRef = useRef(false);
  // Whole-stroke eraser drag in progress: { pointerId, last, removed[] }
  const strokeEraseRef = useRef(null);
  // "Scribbled out … · Undo" note after a scratch-out
  const [scratchNotice, setScratchNotice] = useState(null);
  const scratchEntryRef = useRef(null);
  const scratchTimerRef = useRef(null);
  // Saves in flight / waiting to retry, and what's arrived or left the
  // screen recently — used to merge server data without wiping new work.
  const [sync] = useState(() => createSyncTracker(backend));
  const unsaved = useSyncExternalStore(
    (listener) => subscribeUnsaved(sync, listener),
    () => unsavedCount(sync),
    () => 0
  );
  const idlePaused = useSyncExternalStore(subscribeIdle, isIdlePaused, getServerIdlePaused);
  // Live classes never pause (the teacher's board is the class's hub).
  // Neither does a student's board in a class: it has nothing to catch up
  // from, and the teacher may open it at any moment.
  const syncPaused = idlePaused && !liveClassCode && !student;
  const [catchingUp, setCatchingUp] = useState(false);
  const connectedOnceRef = useRef(false);
  const catchUpRunningRef = useRef(false);
  // The server's clock when this board was last caught up with (catching
  // up then fetches only what changed since; see boardSync.js).
  const syncCursorRef = useRef(null);
  const quickSyncTimerRef = useRef(null);
  const catchUpAgainRef = useRef(false);
  // Private live channels (src/lib/liveMode.js): known before connecting.
  const liveMode = useLiveMode();
  const shortcutHandlersRef = useRef(null);
  // Boards-list preview picture (boards.thumbnail).
  const boardLoadedRef = useRef(false);
  const lastThumbRef = useRef(undefined);
  const thumbTimerRef = useRef(null);
  const thumbWarnedRef = useRef(false);
  // (the demo's lesson board opens with its worksheet beside it)
  const [referenceDoc, setReferenceDoc] = useState(() => normalizeDoc(initialReferenceDoc));
  const [referenceUploadStatus, setReferenceUploadStatus] = useState("");
  const referenceFileInputRef = useRef(null);
  // A student's board in a live class: notes the teacher has pinned on it.
  // Each is { id, x, y, text, createdAt }, with x / y in board coordinates.
  // They are kept with the board itself (see src/lib/localBoard.js), so the
  // class page can show a "new comment" badge and a refresh keeps them.
  const commentStore = backend && backend.comments ? backend.comments : NO_COMMENTS;
  const teacherComments = useSyncExternalStore(commentStore.subscribe, commentStore.get, noComments);
  const teacherCommentsRef = useRef([]);
  // …and what the teacher has put on it: the question sent to the whole
  // class, and anything written on this board in particular. The student
  // sees it and can write over it, but can't rub it out, so it is drawn on
  // a canvas of its own on top of theirs (see drawTeacherLayer).
  const teacherStore = backend && backend.teacher ? backend.teacher : NO_TEACHER_LAYER;
  const teacherLayer = useSyncExternalStore(teacherStore.subscribe, teacherStore.get, noTeacherLayer);
  const teacherLayerRef = useRef(teacherLayer);
  const teacherLiveRef = useRef({}); // lines the teacher is writing right now, by key
  const teacherLiveTimerRef = useRef(null);
  // "What's on your board?" requests waiting for their (shared) answer.
  const snapshotTimerRef = useRef(null);
  const snapshotCommentsRef = useRef(false);
  const teacherCanvasRef = useRef(null);
  const questionImageNodesRef = useRef({});
  const commentPinNodesRef = useRef({});
  const [pulsingComment, setPulsingComment] = useState(null);
  const pulseTimerRef = useRef(null);
  const activeRef = useRef(active);

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
  useEffect(() => { rulerPosRef.current = rulerPos; }, [rulerPos]);
  useEffect(() => { rulerLenRef.current = rulerLen; }, [rulerLen]);
  useEffect(() => { compassActiveRef.current = compassActive; }, [compassActive]);
  useEffect(() => { compassCenterRef.current = compassCenter; }, [compassCenter]);
  useEffect(() => { compassRadiusRef.current = compassRadius; }, [compassRadius]);
  useEffect(() => { panToolActiveRef.current = panToolActive; }, [panToolActive]);
  useEffect(() => { referenceDocRef.current = referenceDoc; }, [referenceDoc]);
  useEffect(() => {
    referenceMarksRef.current = referenceMarks;
    noteList(sync, "refMarks", referenceMarks);
  }, [referenceMarks, sync]);
  useEffect(() => { writeClipWindows(boardId, clipWindows); }, [boardId, clipWindows]);
  useEffect(() => {
    activeRef.current = active;
    // The board has just been taken off screen (the student switched tab,
    // or the teacher called "pens down") with the pen still on it: the line
    // being drawn is finished off where it is, as if the pen had lifted.
    if (active) return;
    const canvas = canvasRef.current;
    const pointerId = strokeEraseRef.current ? strokeEraseRef.current.pointerId : isDrawing.current ? activePointerId.current : null;
    if (canvas && pointerId !== null && typeof PointerEvent === "function") {
      canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId, pointerType: activePointerType.current || "mouse" }));
    }
  }, [active]);
  useEffect(() => {
    if (!restoredNotice || !active) return undefined;
    const timer = setTimeout(() => setRestoredNotice(false), 4500);
    return () => clearTimeout(timer);
  }, [restoredNotice, active]);
  useEffect(() => {
    if (!saveProblem || saveProblemTold || !active) return undefined;
    const timer = setTimeout(() => setSaveProblemTold(true), 8000);
    return () => clearTimeout(timer);
  }, [saveProblem, saveProblemTold, active]);
  useEffect(() => { teacherCommentsRef.current = teacherComments; }, [teacherComments]);

  useEffect(() => {
    if (!boardId) return;
    setLiveClassCode(getStoredClassCode(boardId));
  }, [boardId]);

  // Tells every student's page what is switched on for the class right now.
  function broadcastClassState() {
    const channel = liveClassChannelRef.current;
    if (!channel || !liveClassCode) return;
    channel.send({
      type: "broadcast",
      event: "class-state",
      payload: classStateMessage(getClassControl(liveClassCode), getSentQuestion(liveClassCode)),
    });
  }

  // Puts the class question on the live connection (again, when a student
  // who joined late asks for it).
  function broadcastQuestion() {
    const channel = liveClassChannelRef.current;
    if (!channel || !liveClassCode) return Promise.resolve(false);
    return questionSender.run(
      (event, payload) => channel.send({ type: "broadcast", event, payload }),
      () => getSentQuestion(liveClassCode)
    );
  }

  // The class list, from who is here and what they've signalled.
  function refreshClassRoster() {
    if (!classPresenceRef.current) return;
    const students = rosterFromPresence(attendanceState(classPresenceRef.current), classStatusRef.current);
    setClassRoster(students);
    // The student whose board was being shown to the class has left: there
    // is nothing to show any more.
    const spot = getClassControl(liveClassCode).spotlight;
    if (spot && rosterIdsRef.current.has(spot.studentId) && !students.some((st) => st.studentId === spot.studentId)) {
      setClassControl(liveClassCode, { spotlight: null });
      broadcastClassState();
    }
    rosterIdsRef.current = new Set(students.map((st) => st.studentId));
    // A hand going up is worth a nudge: the teacher is usually looking at
    // their own board, not at the Students list.
    const notice = newHandsNotice(students, handsUpRef.current, classStatusRef.current);
    if (notice) {
      setBoardNotice(notice);
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = setTimeout(() => setBoardNotice(""), 4500);
    }
  }

  // Kept open for the whole time a class is live, rather than opened
  // fresh for each individual action — this is what lets a rejoining
  // student reliably ask "has this already started?" and get an answer,
  // and what makes the End button's broadcast land reliably instead of
  // racing a connection that's still settling.
  useEffect(() => {
    if (!liveClassCode || !liveMode.ready) return;
    // (the class is registered first, so its students are let in; tried
    // again until it works)
    let gone = false;
    const opening = demo ? Promise.resolve("ok") : openClassReliably(liveClassCode, boardId, () => gone);
    const channel = liveChannel(`classroom-${liveClassCode}`, { presence: { key: "teacher" } }, liveMode);
    channel.on("broadcast", { event: "request-session-status" }, () => {
      channel.send({ type: "broadcast", event: "session-started", payload: { boardId } });
    });

    // Live roster: students track their own presence on this same
    // channel for as long as they're on the join/view pages, so the
    // teacher can always see who's currently in class and open their
    // board — not just during the pre-Start waiting room.
    // Who is here: kept from the "joined" / "left" events themselves (see
    // src/lib/classRoster.js for why not simply presenceState()).
    const attendance = createAttendance();
    classPresenceRef.current = attendance;
    channel.on("presence", { event: "join" }, ({ key, newPresences, currentPresences }) => {
      attendanceJoin(attendance, key, newPresences, currentPresences);
    });
    channel.on("presence", { event: "leave" }, ({ key, leftPresences, currentPresences }) => {
      attendanceLeave(attendance, key, leftPresences, currentPresences);
    });
    channel.on("presence", { event: "sync" }, () => {
      attendanceSync(attendance, channel.presenceState());
      refreshClassRoster();
    });

    // A student's hand going up or down, or "I'm done".
    channel.on("broadcast", { event: "student-status" }, ({ payload }) => {
      if (!payload || !payload.studentId) return;
      classStatusRef.current.set(payload.studentId, readStatus(payload));
      refreshClassRoster();
    });

    // A student's page has just joined (or come back) and wants to know
    // what is switched on. Several usually ask at once, so they get one
    // answer between them.
    channel.on("broadcast", { event: "class-state-request" }, () => {
      if (classStateTimerRef.current) return;
      classStateTimerRef.current = setTimeout(() => {
        classStateTimerRef.current = null;
        broadcastClassState();
      }, 150);
    });

    // …or has seen there is a question it doesn't have (it joined after the
    // question was sent, or missed part of it): send it again, unless it
    // has only just gone out.
    channel.on("broadcast", { event: "class-question-request" }, () => {
      if (questionSender.isBusy() || Date.now() - questionSender.lastSentAt() < 2500) return;
      broadcastQuestion();
    });

    const subscribeClass = () => channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ role: "teacher" });
        // Hands may already be up (this board was reloaded mid-class):
        // ask every student's page to say where it stands.
        channel.send({ type: "broadcast", event: "status-request", payload: {} });
        // …and say where the class stands (pens down, the question).
        broadcastClassState();
      }
    });
    opening.then((result) => {
      if (gone) return;
      // Someone else's class has this code: this class gets a new one.
      if (result === "taken") {
        const fresh = generateClassCode();
        storeClassCode(boardId, fresh);
        setLiveClassCode(fresh);
        return;
      }
      subscribeClass();
    });
    liveClassChannelRef.current = channel;

    return () => {
      gone = true;
      supabase.removeChannel(channel);
      liveClassChannelRef.current = null;
      if (classStateTimerRef.current) clearTimeout(classStateTimerRef.current);
      classStateTimerRef.current = null;
      // Leaving the board (to the boards list, say) closes whichever
      // student's board was open, so nothing is being shown to the class
      // any more. Without this, coming back would put everyone on that
      // board again with nobody able to stop it.
      setClassControl(liveClassCode, { spotlight: null });
      classStatusRef.current = new Map();
      classPresenceRef.current = null;
      handsUpRef.current = new Map();
      rosterIdsRef.current = new Set();
      setClassRoster([]);
    };
  }, [liveClassCode, boardId, liveMode.ready, liveMode.private]);

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

  // Is the page dark? (Then black writing is shown white: inkColor.js.)
  function pageIsDark() {
    return isDarkBackground(backgroundRef.current);
  }

  function repositionEditingTextarea() {
    const info = editingTextRef.current;
    if (!info || !textEditorRef.current) return;
    const screenPos = worldToScreen({ x: info.x, y: info.y });
    textEditorRef.current.place(screenPos.x, screenPos.y, scaleRef.current);
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

  // A student's board: the teacher's layer, on its own canvas over the ink.
  function drawTeacherOverlay() {
    const overlay = teacherCanvasRef.current;
    const main = canvasRef.current;
    if (!overlay || !main) return;
    // It is always exactly the size of the board's own canvas.
    if (overlay.width !== main.width || overlay.height !== main.height) {
      overlay.width = main.width;
      overlay.height = main.height;
      overlay.style.width = main.style.width;
      overlay.style.height = main.style.height;
    }
    const tctx = overlay.getContext("2d");
    const ratio = window.devicePixelRatio || 1;
    const scale = scaleRef.current;
    const pan = panRef.current;
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.clearRect(0, 0, overlay.width, overlay.height);
    const layer = { ...teacherLayerRef.current, live: teacherLiveRef.current };
    if (hasTeacherLayer(layer)) {
      tctx.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * pan.x, ratio * pan.y);
      drawTeacherLayer(tctx, layer, scale, pageIsDark());
    }
    // Pictures in the teacher's question sit under the ink, like any picture.
    const question = teacherLayerRef.current.question;
    for (const img of (question && question.images) || []) {
      const el = questionImageNodesRef.current[img.id];
      if (!el) continue;
      el.style.left = img.x * scale + pan.x + "px";
      el.style.top = img.y * scale + pan.y + "px";
      el.style.width = img.width * scale + "px";
      el.style.height = img.height * scale + "px";
    }
  }

  useEffect(() => {
    teacherLayerRef.current = teacherLayer;
    drawTeacherOverlay();
  }, [teacherLayer]);

  // The teacher's comment pins on a student's board stay the same size on
  // screen and stick to the spot on the board they were pinned to.
  function repositionCommentPins() {
    for (const c of teacherCommentsRef.current) {
      const el = commentPinNodesRef.current[c.id];
      if (!el) continue;
      const p = worldToScreen({ x: c.x, y: c.y });
      el.style.left = p.x + "px";
      el.style.top = p.y + "px";
    }
  }

  useEffect(() => {
    repositionCommentPins();
  }, [teacherComments]);

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
      // (on a dark page, black ink shows white: inkColor.js)
      ctx.strokeStyle = inkOn(stroke.color, pageIsDark());
      ctx.lineWidth = stroke.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      // dashed lines: hidden edges and construction lines of inserted shapes
      const dash = strokeDash(stroke);
      if (dash) ctx.setLineDash(dash);
      smoothPath(ctx, stroke.points, 0, stroke.points.length - 1);
      if (dash) ctx.setLineDash([]);
    }
  }


  // A text box's height, from the same layout that draws it (richText.js),
  // so drawing, tapping and selecting all agree.
  function getTextBoxHeight(ctx, t) {
    return textBoxHeight(ctx, t);
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
    const dark = pageIsDark();
    for (const t of textsArr) {
      // the one being edited is shown by the editor instead
      if (editingTextRef.current && editingTextRef.current.isEditingExisting && editingTextRef.current.id === t.id) continue;
      const lay = drawText(ctx, t, { dark });
      if (t.id !== selectedId) continue;
      const boxHeight = lay.height;
      const center = { x: t.x + t.width / 2, y: t.y + boxHeight / 2 };
      const rotation = t.rotation || 0;
      ctx.save();
      if (rotation) {
        ctx.translate(center.x, center.y);
        ctx.rotate(rotation);
        ctx.translate(-center.x, -center.y);
      }
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

  // ---------- the graphs ----------

  // The graphs as they are drawn and sent: with the read-off in progress.
  function graphsShown() {
    const t = graphTraceRef.current;
    const list = graphsRef.current;
    if (!t) return list;
    return list.map((g) => (g.id === t.graphId && g.plot ? { ...g, plot: { ...g.plot, trace: { fnId: t.fnId, x: t.x, tangent: !!t.tangent } } } : g));
  }

  // What is saved and sent for the board's graphs (see graphList.js).
  function packedGraphs() {
    return packGraphs(graphsRef.current.map(withoutTrace));
  }

  function graphById(id) {
    return graphsRef.current.find((g) => g.id === id) || null;
  }

  // A read-off on a graph or curve that's gone is put away. (A graph that's
  // gone may still be listed in the selection: everything that reads the
  // selection only finds graphs that are still there.)
  function tidyAfterGraphChange() {
    const t = graphTraceRef.current;
    if (t) {
      const g = graphById(t.graphId);
      if (!g || !((cleanPlot(g.plot) || { fns: [] }).fns.some((f) => f.id === t.fnId))) graphTraceRef.current = null;
    }
    selectionBoundsCacheRef.current = null;
  }

  // Graphs that arrived from elsewhere (the server, another of the
  // teacher's pages).
  function setGraphsFromServer(grid) {
    graphsRef.current = graphsOf(grid);
    tidyAfterGraphChange();
  }

  function graphGeom(grid) {
    return { cellPx: grid.size / grid.cols, originXPx: grid.x, originYPx: grid.y, lineScale: 1 / scaleRef.current };
  }

  // The graph-paper drawing (lines, axes, numbers, what's plotted…) is
  // shared with the dialog's preview, students' screens and thumbnails —
  // see gridRenderer.js — so what you set up is exactly what lands here.
  function drawGrid(ctx, quick = false) {
    for (const g of graphsShown()) {
      renderGrid(ctx, g, { ...graphGeom(g), quick, dark: pageIsDark() });
    }
  }

  // ---- Selection overlay + board images (positioned on every redraw) ----

  function textHeightOf(t) {
    return ctxRef.current ? getTextBoxHeight(ctxRef.current, t) : (t.fontSize || 24) * 1.3;
  }

  function getObjectsData(sel) {
    const s = new Set(sel.strokes || []), t = new Set(sel.texts || []), i = new Set(sel.images || []), g = new Set(sel.graphs || []);
    return {
      strokes: s.size ? strokesRef.current.filter((x) => s.has(x.id)) : [],
      texts: t.size ? textsRef.current.filter((x) => t.has(x.id)) : [],
      images: i.size ? imagesRef.current.filter((x) => i.has(x.id)) : [],
      graphs: g.size ? graphsRef.current.filter((x) => g.has(x.id)) : [],
    };
  }

  function boundsOfData(data) {
    return unionBounds([
      ...data.strokes.map(strokeBounds),
      ...data.texts.map((t) => textBounds(t, textHeightOf(t))),
      ...data.images.map(imageBounds),
      ...(data.graphs || []).map(graphBox),
    ]);
  }

  function getSelectionBounds() {
    const move = groupMoveRef.current;
    if (move && move.origBounds) {
      const b = move.origBounds;
      return { minX: b.minX + move.dx, minY: b.minY + move.dy, maxX: b.maxX + move.dx, maxY: b.maxY + move.dy };
    }
    const key = [selectionRef.current, strokesRef.current, textsRef.current, imagesRef.current, graphsRef.current];
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
    const count = selectionCount(sel);
    const singleText = count === 1 && sel.texts.length === 1;
    // one picture or one graph: its corner handle resizes it
    const singleResizable = count === 1 && (sel.images.length === 1 || (sel.graphs || []).length === 1);
    box.style.display = singleText ? "none" : "block";
    box.style.left = tl.x - pad + "px";
    box.style.top = tl.y - pad + "px";
    box.style.width = w + pad * 2 + "px";
    box.style.height = h + pad * 2 + "px";
    const handle = box.firstChild;
    if (handle) handle.style.display = singleResizable && !groupMoveRef.current ? "block" : "none";

    // Action bar: above the selection if there's room, otherwise below,
    // always kept inside the board.
    const { width: paneW, height: paneH } = getPaneSize();
    bar.style.display = groupMoveRef.current || imageResizeRef.current || graphResizeRef.current ? "none" : "flex";
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

  // Puts each graph's sliders beside its top right corner, and the
  // read-off bar beside the point, wherever the board has been moved to.
  function repositionGraphBits() {
    const { width, height } = getPaneSize();
    for (const g of graphsRef.current) {
      const panel = graphPanelRefs.current[g.id];
      if (!panel) continue;
      const corner = worldToScreen({ x: g.x + g.size, y: g.y });
      const w = panel.offsetWidth || 230;
      const h = panel.offsetHeight || 80;
      let left = corner.x + 12;
      if (left + w > width - 8) left = Math.max(8, width - w - 8);
      const top = Math.max(8, Math.min(height - h - 8, corner.y));
      panel.style.left = left + "px";
      panel.style.top = top + "px";
    }
    const bar = graphBarRef.current;
    const t = graphTraceRef.current;
    const grid = t ? graphById(t.graphId) : null;
    if (bar && grid && t) {
      const v = readoutValues(grid, graphGeom(grid), t.fnId, t.x);
      if (v && Number.isFinite(v.y)) {
        const [wx, wy] = worldPointOf(grid, graphGeom(grid), v.x, v.y);
        const at = worldToScreen({ x: wx, y: wy });
        const w = bar.offsetWidth || 260;
        const h = bar.offsetHeight || 44;
        // above the point, clear of its label on the board
        let left = at.x - w / 2;
        left = Math.max(8, Math.min(width - w - 8, left));
        let top = at.y - h - 40;
        if (top < 8) top = at.y + 40;
        bar.style.left = left + "px";
        bar.style.top = Math.min(height - h - 8, top) + "px";
      }
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
    drawGrid(ctx);

    applyBackground(pageBgRef.current, backgroundRef.current, scale, pan, backgroundCssKeyRef);

    repositionEditingTextarea();
    repositionSimEmbeds();
    repositionImages();
    repositionSelectionOverlay();
    repositionCommentPins();
    repositionPeopleBits();
    sharePresence();
    if (student) drawTeacherOverlay();
    graphStore.set(graphsRef.current, graphTraceRef.current);
    repositionGraphBits();
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
      ctx.strokeStyle = inkOn(styleStroke.color, pageIsDark());
      ctx.lineWidth = styleStroke.width;
      ctx.lineCap = "butt";
      smoothPath(ctx, pts, startIdx, endIdx);
    }
    ctx.globalAlpha = 1;

    if (graphsRef.current.length) drawGrid(ctx, true);
  }

  // Supabase errors print as "{}" in the console, so spell them out. A
  // refusal (code 42501) is queued and tried again (see boardSync: a login
  // that lapsed for a moment looks exactly like one), so it isn't shown
  // here unless this person really has been signed out. A refusal that
  // keeps happening is given up on and shown by onGiveUp below.
  function reportSaveError(kind, error) {
    const detail = [error.code, error.message, error.details, error.hint].filter(Boolean).join(" — ");
    if (error.code === "LOGIN_LAPSED") {
      console.warn(`Saving a ${kind} is waiting for the login to be renewed.`);
      return;
    }
    if (error.code === "42501") {
      console.warn(`The database refused to save a ${kind} (will try again): ${detail}`);
      if (!rlsNoticeShownRef.current) {
        Promise.resolve(db.auth && db.auth.getSession ? db.auth.getSession() : null)
          .then((res) => {
            if (!res || (res.data && res.data.session) || res.error) return;
            rlsNoticeShownRef.current = true;
            flashNotice("You've been signed out, so changes aren't being saved. Sign in again to keep your work.", 9000);
          })
          .catch(() => {});
      }
      return;
    }
    console.error(`Error saving ${kind}: ${detail || String(error)}`);
  }

  // The row a stroke / text box is saved as.
  function strokeRow(stroke) {
    const dash = strokeDash(stroke);
    const data = {
      tool: stroke.tool,
      color: stroke.color,
      width: stroke.width,
      opacity: stroke.opacity,
      points: roundPoints(stroke.points),
    };
    if (dash) data.dash = dash;
    return { id: stroke.id, board_id: boardId, data };
  }

  function textRow(t) {
    return {
      id: t.id,
      board_id: boardId,
      x: t.x,
      y: t.y,
      text: t.text,
      color: t.color,
      font_size: t.fontSize,
      width: t.width,
      rotation: t.rotation || 0,
    };
  }

  async function insertStroke(stroke) {
    if (!boardId || !stroke?.id) return;
    const error = await saveRow(sync, "strokes", strokeRow(stroke));
    if (error) reportSaveError("stroke", error);
  }

  async function insertText(t) {
    if (!boardId || !t?.id) return;
    const error = await saveRow(sync, "texts", textRow(t));
    if (error) reportSaveError("text", error);
  }

  // Several things added at once (a paste, a duplicate, an inserted shape)
  // go to the server a batch at a time instead of one request each.
  function saveBatch(table, rows, kind) {
    if (!boardId) return;
    for (let i = 0; i < rows.length; i += SAVE_BATCH) {
      saveRows(sync, table, rows.slice(i, i + SAVE_BATCH)).then((error) => {
        if (error) reportSaveError(kind, error);
      });
    }
  }

  function performClear() {
    setStrokes([]);
    setTexts([]);
    setImages([]);
    selectionRef.current = emptySelection();
    setSelectionState(emptySelection());
  }

  // Tapping a comment in the list brings its pin into view (the board may
  // have been moved or zoomed since the teacher pinned it) and makes the
  // pin pulse so it's easy to spot.
  function handleShowComment(comment) {
    const { width, height } = getPaneSize();
    const at = worldToScreen({ x: comment.x, y: comment.y });
    const margin = 48;
    const inView = at.x >= margin && at.y >= margin && at.x <= width - margin && at.y <= height - margin;
    if (!inView) {
      const scale = scaleRef.current;
      panRef.current = { x: width / 2 - comment.x * scale, y: height / 2 - comment.y * scale };
      fullRedraw();
    }
    setPulsingComment(comment.id);
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = setTimeout(() => setPulsingComment(null), 1600);
  }

  // ---------- who else is here ----------

  // Where this person is: the part of the board on their screen, and
  // where they last wrote.
  function myWhere() {
    const { width, height } = getPaneSize();
    const scale = scaleRef.current;
    const topLeft = screenToWorld({ x: 0, y: 0 });
    return wherePayload({
      view: { x: topLeft.x, y: topLeft.y, w: width / scale, h: height / scale },
      ink: presenceRef.current.ink,
    });
  }

  function sendWhere(payload) {
    const pr = presenceRef.current;
    if (!pr.channel) return;
    pr.sent = payload;
    pr.lastAt = Date.now();
    // (through the board's sender: skipped while the connection is down)
    (channelRef.current || pr.channel).send({ type: "broadcast", event: "person-where", payload: { key: clientId.current, ...payload } });
  }

  // Tells the others when it changes (no more than every PRESENCE_GAP_MS).
  function sharePresence() {
    const pr = presenceRef.current;
    // nobody else here: nothing to tell (newcomers are answered anyway)
    if (!peopleOn || !pr.channel || pr.timer || !peopleRef.current.list.length) return;
    const wait = Math.max(0, PRESENCE_GAP_MS - (Date.now() - pr.lastAt));
    pr.timer = setTimeout(() => {
      pr.timer = null;
      if (!pr.channel) return;
      const next = myWhere();
      if (!sameWhere(next, pr.sent)) sendWhere(next);
    }, wait);
  }

  // Someone has just arrived: tell them where we are (a moment later, so
  // several arrivals get one message).
  function answerNewcomer() {
    const pr = presenceRef.current;
    if (!pr.channel || pr.replyTimer) return;
    pr.replyTimer = setTimeout(() => {
      pr.replyTimer = null;
      if (pr.channel) sendWhere(myWhere());
    }, 250 + Math.random() * 350);
  }

  function noteMyInk(pt) {
    if (!peopleOn || !pt) return;
    presenceRef.current.ink = { x: pt.x, y: pt.y };
    sharePresence();
  }

  function notePeople() {
    const pr = presenceRef.current;
    const state = pr.attendance ? attendanceState(pr.attendance) : {};
    // forget where people were once they've gone (a message that arrived
    // just before their arrival was announced is kept a little while)
    const now = Date.now();
    for (const [key, w] of [...pr.where]) if (!state[key] && now - w.t > 10000) pr.where.delete(key);
    const { list, byKey } = peopleFrom(state, pr.where, user ? personId(user.id) : null, clientId.current);
    const ref = peopleRef.current;
    ref.list = list;
    ref.byKey = byKey;
    const faces = facesKey(list);
    if (faces !== ref.faces) {
      ref.faces = faces;
      setPeople(list.map(({ key, uid, name, short, initial, color }) => ({ key, uid, name, short, initial, color })));
    }
  }

  function repositionPeopleBits() {
    penTags.reposition(worldToScreen);
    const el = outlineElRef.current;
    const o = outlineRef.current;
    if (!el || !o) return;
    const a = worldToScreen({ x: o.rect.x, y: o.rect.y });
    const scale = scaleRef.current;
    el.style.transform = `translate(${Math.round(a.x)}px, ${Math.round(a.y)}px)`;
    el.style.width = Math.round(o.rect.w * scale) + "px";
    el.style.height = Math.round(o.rect.h * scale) + "px";
  }

  // A dashed outline of their screen for a few seconds after you jump to them.
  function showOutline(person) {
    const el = outlineElRef.current;
    if (!el || !person.view) return;
    outlineRef.current = { rect: person.view };
    el.style.borderColor = person.color;
    const label = el.firstChild;
    if (label) {
      label.textContent = `${person.short}'s screen`;
      label.style.background = person.color;
    }
    repositionPeopleBits();
    el.setAttribute("data-show", "true");
    if (outlineTimerRef.current) clearTimeout(outlineTimerRef.current);
    outlineTimerRef.current = setTimeout(() => {
      el.setAttribute("data-show", "false");
      outlineTimerRef.current = setTimeout(() => {
        outlineRef.current = null;
        outlineTimerRef.current = null;
      }, 400);
    }, 4000);
  }

  // The glide stops the moment you touch the board yourself (so a stroke
  // you start lands where you put it).
  function stopViewGlide() {
    if (!viewAnimRef.current) return;
    cancelAnimationFrame(viewAnimRef.current);
    viewAnimRef.current = 0;
    setZoomPercent(Math.round(scaleRef.current * 100));
  }

  // Tapping someone's initial: the board glides to what they're looking at.
  function handleFindPerson(key) {
    const ref = peopleRef.current;
    const person = ref.list.find((p) => p.key === key) || ref.byKey.get(key);
    if (!person) return;
    const pane = getPaneSize();
    const to = viewFor(person, pane, { scale: scaleRef.current }, MIN_SCALE, MAX_SCALE);
    if (!to) {
      flashNotice(`${person.short} hasn't got anywhere on the board yet.`, 3000);
      return;
    }
    track("board_person_found", { people: ref.list.length });
    cancelAnimationFrame(viewAnimRef.current);
    const from = { scale: scaleRef.current, pan: { ...panRef.current } };
    const finish = () => {
      scaleRef.current = to.scale;
      panRef.current = to.pan;
      fullRedraw();
      setZoomPercent(Math.round(to.scale * 100));
    };
    showOutline(person);
    const calm = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (calm) {
      finish();
      return;
    }
    let started = null; // the first frame's time
    const step = (now) => {
      if (started === null) started = now;
      const t = Math.min(1, (now - started) / 420);
      if (t >= 1) {
        viewAnimRef.current = 0;
        finish();
        return;
      }
      const v = viewBetween(from, to, t, pane);
      scaleRef.current = v.scale;
      panRef.current = v.pan;
      fullRedraw();
      viewAnimRef.current = requestAnimationFrame(step);
    };
    viewAnimRef.current = requestAnimationFrame(step);
  }

  // a font a text box uses has arrived: draw it with that font
  useEffect(() => subscribeFonts(() => fullRedraw()), []);

  useEffect(() => {
    penTags.attach(penTagsElRef.current);
    return () => {
      penTags.attach(null);
      cancelAnimationFrame(viewAnimRef.current);
      if (outlineTimerRef.current) clearTimeout(outlineTimerRef.current);
    };
  }, [penTags]);

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

  // The board's own settings, as saved (after catching up).
  function applyBoardSettings(settings) {
    if (!settings) return;
    // (not over a graph change of ours that's about to be saved)
    if ("grid_config" in settings && !graphSaveTimer.current && !graphSavingRef.current.busy && !graphSavingRef.current.retries) setGraphsFromServer(settings.grid_config);
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

  // Catch up after the live connection was down (idle pause, sleep,
  // network drop), or now and then while others are drawing (`quiet`: no
  // "catching up" chip, and the board's settings aren't asked for): anything
  // saved by others meanwhile appears, anything they rubbed out
  // disappears, and our own unsaved work is re-sent. Only what changed is
  // fetched when the database can say what that is.
  async function catchUpWithServer({ quiet = false } = {}) {
    if (!boardId) return;
    if (catchUpRunningRef.current) {
      // (a full one asked for while a quick one runs: it follows)
      if (!quiet) catchUpAgainRef.current = true;
      return;
    }
    catchUpRunningRef.current = true;
    let q = quiet;
    // (once more, in full, if a full one was asked for meanwhile)
    for (let round = 0; round < 2; round++) {
      if (!q) setCatchingUp(true);
      const result = await catchUp(boardId, db, syncCursorRef.current, { withSettings: !q });
      if (result.mode === "changes") {
        const { changes, deleted } = result;
        if (changes.strokes.length || deleted.strokes.size) setStrokes((prev) => mergeChanges(prev, changes.strokes, deleted.strokes, sync));
        if (changes.texts.length || deleted.texts.size) setTexts((prev) => mergeChanges(prev, changes.texts, deleted.texts, sync));
        if (changes.images.length || deleted.images.size) setImages((prev) => mergeChanges(prev, changes.images, deleted.images, sync));
      } else {
        applyServerContents(result.contents, result.fetchStartedAt);
      }
      if (result.now) syncCursorRef.current = result.now;
      applyBoardSettings(result.settings);
      if (!q && refRefreshRef.current) refRefreshRef.current(false);
      retryUnsaved(sync);
      if (!q) setCatchingUp(false);
      fullRedraw();
      if (!catchUpAgainRef.current) break;
      catchUpAgainRef.current = false;
      q = false;
    }
    catchUpRunningRef.current = false;
  }

  // A quiet check with the server a little later (several reasons in a
  // row make one check).
  function syncSoon(ms = 2500) {
    // (only when only what changed can be asked for)
    if (!isRealBackend(db) || !syncCursorRef.current || quickSyncTimerRef.current) return;
    quickSyncTimerRef.current = setTimeout(() => {
      quickSyncTimerRef.current = null;
      catchUpWithServer({ quiet: true });
    }, ms);
  }

  useEffect(() => {
    if (!boardId || !userId) return;
    connectedOnceRef.current = false;
    // The board's settings: in one request when the database can (and the
    // server's clock, to catch up from later), else the older way.
    function applyOpened(row) {
      graphsRef.current = graphsOf(row.grid_config);
      setIsOwner(userId === row.owner_id);
      setBoardName(row.name || "");
      simsRef.current = row.sim_embeds || [];
      setSims(simsRef.current);
      backgroundRef.current = normalizeBackground(row.background);
      setBoardBackground(backgroundRef.current);
      lastThumbRef.current = previewHashOf(row.thumbnail);
      fullRedraw();
    }

    async function loadBoardSettingsTheOlderWay() {
      const { error: joinError } = await db.rpc("join_board_via_link", { board_id: boardId });
      if (joinError) console.error("Error joining board:", joinError);

      // .maybeSingle() (not .single()) so an empty result comes back as
      // null instead of throwing — a genuinely empty result can happen
      // transiently right after the access-grant RPC above, especially
      // under React's dev-mode double-effect invocation. One short retry
      // covers that without surfacing a scary error for what's usually
      // just a timing blip.
      async function fetchBoardRow() {
        const { data, error } = await db
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
        graphsRef.current = graphsOf(boardRow.grid_config);
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
      db.from("boards").select("sim_embeds").eq("id", boardId).maybeSingle().then(({ data, error }) => {
        if (!error && data) {
          simsRef.current = data.sim_embeds || [];
          setSims(simsRef.current);
        } else if (error) {
          console.warn("Could not load embedded simulations (has the sim_embeds column been added yet?):", error);
        }
      });

      // The saved preview picture, so an unchanged board isn't re-saved.
      db.from("boards").select("thumbnail").eq("id", boardId).maybeSingle().then(({ data, error }) => {
        if (!error && data) lastThumbRef.current = previewHashOf(data.thumbnail);
      });

      // Page background: `alter table boards add column background text;`
      db.from("boards").select("background").eq("id", boardId).maybeSingle().then(({ data, error }) => {
        if (!error && data) {
          backgroundRef.current = normalizeBackground(data.background);
          setBoardBackground(backgroundRef.current);
          fullRedraw();
        } else if (error) {
          console.warn("Could not load the page background (has the background column been added yet?):", error);
        }
      });
    }

    async function loadBoard() {
      const opened = await openBoard(boardId, db);
      if (opened && opened.found) {
        syncCursorRef.current = opened.now;
        applyOpened(opened);
      } else if (opened) {
        // (not there, or not shared with this person)
        syncCursorRef.current = opened.now;
        console.error("Error loading board: not found, or not shared with you.");
      } else {
        await loadBoardSettingsTheOlderWay();
      }

      // Everything drawn so far (all of it — Supabase hands rows back
      // 1,000 at a time), merged with anything drawn while it loaded.
      // Each part shows as soon as it arrives.
      const fetchStartedAt = Date.now();
      await Promise.all(
        ["strokes", "texts", "images"].map((kind) =>
          fetchBoardPart(boardId, kind, db).then((list) => applyServerContents({ [kind]: list }, fetchStartedAt))
        )
      );
      boardLoadedRef.current = true;
      fullRedraw();
      if (!opened) touchBoard(boardId, db);
      // the document beside the board, and what's written on it
      // (open_board brings the document with it, once the database has it)
      const knownDoc = opened && opened.found && "reference_doc" in opened ? { doc: opened.reference_doc } : null;
      if (refRefreshRef.current) refRefreshRef.current(true, knownDoc);
      // A student's class board that came back from an earlier visit (a
      // refresh, or joining again after closing the tab): say so, once.
      if (student && backend && backend.__restored > 0 && !restoredNoticeShownRef.current) {
        restoredNoticeShownRef.current = true;
        setRestoredNotice(true);
      }
    }
    loadBoard();
  }, [boardId, userId]);


  // One save at a time (so a quick run of changes can't land out of order);
  // a change made while one is going is saved straight after it, and a
  // failed save is tried again a little later (a few times).
  // One save of the board's graphs, as they are now: true if it worked.
  async function writeGrid() {
    if (!boardId) return false;
    try {
      const { error } = await db
        .from("boards")
        .update({ grid_config: packedGraphs() })
        .eq("id", boardId);
      return !error;
    } catch (err) {
      return false;
    }
  }

  async function saveGrid() {
    if (!boardId) return;
    const st = graphSavingRef.current;
    if (st.busy) {
      st.again = true;
      return;
    }
    st.busy = true;
    let ok = false;
    let failures = 0;
    while (true) {
      st.again = false;
      ok = await writeGrid();
      if (st.again) continue;
      if (ok || failures >= 3) break;
      failures += 1;
      st.retries = failures;
      await new Promise((resolve) => setTimeout(resolve, 3000 * failures));
    }
    st.busy = false;
    st.retries = 0;
    return ok;
  }

  // ---------- changing the graphs ----------

  // Sends the graphs (as shown) to everyone watching, at most every 100ms.
  function queueGraphBroadcast() {
    if (graphBroadcastTimer.current) return;
    graphBroadcastTimer.current = setTimeout(() => {
      graphBroadcastTimer.current = null;
      channelRef.current?.send({ type: "broadcast", event: "grid-set", payload: { grid: packGraphs(graphsShown()) } });
    }, 100);
  }

  function saveGridSoon() {
    if (graphSaveTimer.current) clearTimeout(graphSaveTimer.current);
    graphSaveTimer.current = setTimeout(() => {
      graphSaveTimer.current = null;
      saveGrid();
    }, 500);
  }

  function saveGridNow() {
    if (graphSaveTimer.current) {
      clearTimeout(graphSaveTimer.current);
      graphSaveTimer.current = null;
    }
    saveGrid();
  }

  // The one way the board's graphs change: redrawn, sent to everyone
  // watching and saved (straight away, or `soon` for a slider being dragged).
  function commitGraphs(next, { soon = false } = {}) {
    graphsRef.current = next.slice(0, MAX_GRAPHS);
    tidyAfterGraphChange();
    fullRedraw();
    queueGraphBroadcast();
    if (soon) saveGridSoon();
    else saveGridNow();
    // (the boards-list preview catches up, as for any other change)
    setGraphsVersion((v) => v + 1);
  }

  // A graph's settings changed (in place).
  function replaceGraph(id, graph, opts) {
    const list = graphsRef.current;
    const at = list.findIndex((g) => g.id === id);
    // (one that was deleted meanwhile comes back, e.g. on undo)
    commitGraphs(at >= 0 ? list.map((g) => (g.id === id ? graph : g)) : [...list, graph], opts);
  }

  function setGraphPlot(id, plot, { save = true } = {}) {
    const g = graphById(id);
    if (!g) return;
    graphsRef.current = graphsRef.current.map((x) => (x.id === id ? { ...x, plot } : x));
    tidyAfterGraphChange();
    fullRedraw();
    queueGraphBroadcast();
    if (save) saveGridSoon();
  }

  // A slider on the board was moved.
  function handleGraphParam(graphId, name, value) {
    const g = graphById(graphId);
    if (!g || !g.plot) return;
    const params = cleanPlot(g.plot).params;
    setGraphPlot(graphId, { ...cleanPlot(g.plot), params: { ...params, [name]: { ...sliderOf(params[name]), value } } });
  }

  function setGraphTrace(next) {
    graphTraceRef.current = next;
    fullRedraw();
    queueGraphBroadcast();
  }

  function handleGraphPin() {
    const t = graphTraceRef.current;
    const g = t ? graphById(t.graphId) : null;
    if (!g || !g.plot) return;
    const pin = { id: newId(), fnId: t.fnId, x: t.x, tangent: !!t.tangent };
    graphTraceRef.current = null;
    setGraphPlot(g.id, { ...cleanPlot(g.plot), pins: [...cleanPlot(g.plot).pins, pin] });
  }

  function handleGraphTangent() {
    const t = graphTraceRef.current;
    const g = t ? graphById(t.graphId) : null;
    if (!g) return;
    const next = { ...t, tangent: !t.tangent };
    graphTraceRef.current = next;
    if (t.pinId && g.plot) {
      setGraphPlot(g.id, { ...cleanPlot(g.plot), pins: cleanPlot(g.plot).pins.map((p) => (p.id === t.pinId ? { ...p, tangent: next.tangent } : p)) });
    } else {
      fullRedraw();
      queueGraphBroadcast();
    }
  }

  function handleGraphUnpin() {
    const t = graphTraceRef.current;
    const g = t ? graphById(t.graphId) : null;
    if (!g || !g.plot) return;
    graphTraceRef.current = null;
    setGraphPlot(g.id, { ...cleanPlot(g.plot), pins: cleanPlot(g.plot).pins.filter((p) => p.id !== t.pinId) });
  }

  function handleGraphCloseReadout() {
    if (graphTraceRef.current) setGraphTrace(null);
  }

  async function saveSimEmbeds() {
    if (!boardId) return;
    const { error } = await db
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
    const { error } = await db.from("boards").update({ background: value }).eq("id", boardId);
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
    const singleText = sel.texts.length === 1 && sel.strokes.length === 0 && sel.images.length === 0 && !(sel.graphs || []).length;
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
    const row = { id: img.id, board_id: boardId, x: img.x, y: img.y, width: img.width, height: img.height, src: img.src };
    // a clip from the reference document remembers where it came from
    // (once the database has the column: supabase/2026-10-19-reference-docs.sql)
    if (img.source && !imageSourceMissingRef.current) row.source = img.source;
    let error = await saveRow(sync, "images", row);
    if (error && row.source && /source|PGRST204|schema cache/i.test(`${error.code || ""} ${error.message || ""}`)) {
      imageSourceMissingRef.current = true;
      delete row.source;
      error = await saveRow(sync, "images", row);
    }
    if (error) warnImagesTable(error);
  }

  function persistAdd(data) {
    saveBatch("strokes", data.strokes.filter((s) => s && s.id).map(strokeRow), "stroke");
    saveBatch("texts", data.texts.filter((t) => t && t.id).map(textRow), "text");
    data.images.forEach((img) => insertImage(img));
  }

  // Saves a change to a text box (moved, resized, turned). Counted as
  // "saving" meanwhile, so a check with the server can't put it back.
  function updateTextRow(id, patch, what) {
    sync.pending.set(id, (sync.pending.get(id) || 0) + 1);
    db.from("texts").update(patch).eq("id", id).then(({ error }) => {
      const left = (sync.pending.get(id) || 1) - 1;
      if (left > 0) sync.pending.set(id, left);
      else sync.pending.delete(id);
      if (error) console.error(`Error saving text ${what}:`, error);
    });
  }

  function persistRemove(sel) {
    const run = (table, ids) => {
      if (!ids.length) return;
      db.from(table).delete().in("id", ids).then(({ error }) => {
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
    // graphs are saved and sent with the board's graph setting
    if (!remote && data.graphs && data.graphs.length) commitGraphs(mergeById(graphsRef.current, data.graphs));
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
    const g = new Set(sel.graphs || []);
    if (!remote && g.size) commitGraphs(graphsRef.current.filter((x) => !g.has(x.id)));
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
    const g = new Set(sel.graphs || []);
    if (!remote && g.size) commitGraphs(graphsRef.current.map((x) => (g.has(x.id) ? translateGraph(x, dx, dy) : x)));
    if (!remote) {
      const ids = { strokes: [...s], texts: [...t], images: [...i] };
      channelRef.current?.send({ type: "broadcast", event: "objects-move", payload: { ...ids, dx, dy } });
      // Saved as "moved by dx, dy" (a few numbers, however much was moved),
      // unless something in it is still being saved, or that can't be done:
      // then the moved copies themselves are saved.
      const all = [...s, ...t, ...i];
      const saveCopies = () => persistAdd(getObjectsData(ids));
      if (!isRealBackend(db) || all.some((id) => sync.pending.has(id) || sync.failed.has(id))) {
        // (computed from the current refs, which don't include this move yet)
        const moved = getObjectsData(ids);
        persistAdd({
          strokes: moved.strokes.map((x) => translateStroke(x, dx, dy)),
          texts: moved.texts.map((x) => translateText(x, dx, dy)),
          images: moved.images.map((x) => translateImage(x, dx, dy)),
        });
      } else {
        // (counted as "saving" meanwhile, so a check with the server can't
        // put them back where they were)
        for (const id of all) sync.pending.set(id, (sync.pending.get(id) || 0) + 1);
        moveObjects(boardId, ids, dx, dy, db).then((count) => {
          for (const id of all) {
            const left = (sync.pending.get(id) || 1) - 1;
            if (left > 0) sync.pending.set(id, left);
            else sync.pending.delete(id);
          }
          // (by now the refs show where everything is)
          if (count === null || count < all.length) saveCopies();
        });
      }
    }
  }

  function pushUndo(entry) {
    myStrokeStack.current.push(entry);
    myRedoStack.current = [];
    setMyUndoAvailable(true);
    setMyRedoAvailable(false);
  }

  // A graph's settings changed by the teacher: can be undone.
  // Only the settings that changed are kept for undo, so undoing (say) a
  // resize doesn't also undo a slider moved or a point pinned since.
  function editGraph(id, after) {
    const before = graphById(id);
    if (!before) return;
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
      (k) => k !== "id" && JSON.stringify(before[k]) !== JSON.stringify(after[k])
    );
    if (!keys.length) return;
    const pick = (g) => {
      const o = {};
      for (const k of keys) if (k in g) o[k] = g[k];
      return o;
    };
    replaceGraph(id, after);
    pushUndo({ op: "graph-edit", id, keys, before: pick(before), after: pick(after), whole: before });
  }

  // Undo / redo of a graph-edit: those settings put on the graph as it is
  // now (or, if it was deleted meanwhile, as it was).
  function applyGraphFields(entry, fields) {
    const next = { ...(graphById(entry.id) || entry.whole) };
    for (const k of entry.keys) {
      if (k in fields) next[k] = fields[k];
      else delete next[k];
    }
    replaceGraph(entry.id, next);
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
    const room = Math.max(0, MAX_GRAPHS - graphsRef.current.length);
    if (data.graphs && data.graphs.length > room) {
      flashNotice(`A board can have up to ${MAX_GRAPHS} graphs.`);
      data = { ...data, graphs: data.graphs.slice(0, room) };
      if (selectionCount(selectionFromData(data)) === 0) return;
    }
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
    // A student's class board takes no pictures (see `student` above).
    const data = { strokes: clip.strokes || [], texts: clip.texts || [], images: student ? [] : clip.images || [], graphs: clip.graphs || [] };
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
      const { error } = await db.storage
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
    const { data } = db.storage.from("board-images").getPublicUrl(path);
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
    if (files.length && !student) {
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
    flashNotice(
      student
        ? files.length
          ? "Pictures can't be added to your class board."
          : "Nothing to paste yet — copy something on your board first."
        : "Nothing to paste yet — copy something on a board first, or use Insert ▸ Image."
    );
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
      graphs: graphsRef.current.map((g) => g.id),
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
    if (student) return;
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }

  function handleBoardDrop(e) {
    if (student) return;
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
    if (!boardId || student || !boardLoadedRef.current) return;
    const url = renderBoardThumbnail({
      strokes: strokesRef.current,
      texts: textsRef.current,
      images: imagesRef.current,
      grid: packedGraphs(),
      background: backgroundRef.current,
    });
    if (!url) return;
    const hash = pictureHash(url);
    if (hash === lastThumbRef.current) return;
    lastThumbRef.current = hash;
    // A picture in storage, beside the board's others (so the boards list
    // doesn't carry every preview in its rows); in the row itself if that
    // can't be done.
    const keepInRow = () =>
      db.from("boards").update({ thumbnail: url }).eq("id", boardId).then(({ error }) => {
        if (error && !thumbWarnedRef.current) {
          thumbWarnedRef.current = true;
          console.warn("Could not save the board preview (has the thumbnail column been added yet?):", error);
        }
      });
    if (!isRealBackend(db)) {
      keepInRow();
      return;
    }
    savePreview(boardId, url, hash, db).then((ok) => {
      if (!ok) keepInRow();
    });
  }

  function scheduleThumbnail() {
    if (student || !boardLoadedRef.current) return;
    if (thumbTimerRef.current) clearTimeout(thumbTimerRef.current);
    thumbTimerRef.current = setTimeout(saveThumbnail, 5000);
  }

  async function handleEndSession() {
    if (saveState === "saving") return;
    if (saveStateTimerRef.current) clearTimeout(saveStateTimerRef.current);
    setSaveStatus("Saving…");
    setSaveState("saving");
    saveThumbnail();
    // (straight away, with the answer: not queued behind other saves)
    const gridOk = await writeGrid();
    // Anything that failed to save earlier (dropped Wi-Fi) gets another go
    // now, so "Saved" is only shown when everything really is.
    await retryUnsaved(sync);
    const ok = gridOk && unsavedCount(sync) === 0;
    setSaveStatus(ok ? "Saved" : "Save failed");
    setSaveState(ok ? "saved" : "error");
    saveStateTimerRef.current = setTimeout(() => {
      setSaveStatus("");
      setSaveState("idle");
    }, ok ? 2600 : 4000);
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(window.location.href);
    setSaveStatus("Link copied");
    setTimeout(() => setSaveStatus(""), 2000);
  }

  function handleStartLiveClass() {
    if (demo) {
      // The demo's class is a pretend one, run right here: no waiting
      // room, and the students are played by src/lib/demoClassroom.js.
      setLiveClassCode(generateClassCode());
      onDemoClassStart?.();
      return;
    }
    track("live_class_started");
    router.push(`/board/${boardId}/live`);
  }

  async function handleEndLiveClass() {
    if (!liveClassCode) return;
    if (!demo && !window.confirm("End the live class? Students currently watching will be disconnected.\n\nTheir boards can't be saved afterwards: use Save boards (in the Students list) first if you want to keep them.")) return;

    if (liveClassChannelRef.current) {
      await liveClassChannelRef.current.send({ type: "broadcast", event: "class-ended", payload: {} });
    }

    if (!demo) {
      track("live_class_ended", { students: classRoster.length });
      closeClass(liveClassCode);
    }
    forgetClass(liveClassCode);
    clearClassCode(boardId);
    setLiveClassCode(null);
    setShowRoster(false);
    setViewingStudent(null);
    setClassOverview(false);
    setClassDialog(null);
    if (demo) onDemoClassEnd?.();
  }

  // A short note at the top of the board about something the teacher did
  // for the whole class.
  function classNote(text) {
    setBoardNotice(text);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setBoardNotice(""), 4500);
  }

  // ---------- showing one student's board to everyone ----------

  function handleStopSpotlight() {
    if (!getClassControl(liveClassCode).spotlight) return;
    setClassControl(liveClassCode, { spotlight: null });
    broadcastClassState();
  }

  function handleSpotlight(who, showName) {
    setClassControl(liveClassCode, { spotlight: { studentId: who.studentId, name: who.name, showName: !!showName } });
    broadcastClassState();
  }

  // Opening one student's board. (A board being shown to the class is the
  // one the teacher is looking at, so looking elsewhere stops the showing.)
  function handleViewStudent(who) {
    const spot = getClassControl(liveClassCode).spotlight;
    if (spot && (!who || spot.studentId !== who.studentId)) handleStopSpotlight();
    setViewingStudent(who);
  }

  function handleOpenOverview() {
    handleViewStudent(null);
    setClassOverview(true);
  }

  // ---------- pens down ----------

  function handleTogglePensDown() {
    const down = !getClassControl(liveClassCode).pensDown;
    setClassControl(liveClassCode, { pensDown: down });
    broadcastClassState();
    classNote(down ? "Pens down: students' boards are paused and they're looking at yours." : "Pens up: students can write again.");
  }

  // ---------- sending the teacher's board to every student ----------

  function handleSendQuestion() {
    const question = questionFromBoard({
      strokes: strokesRef.current, texts: textsRef.current, images: imagesRef.current, grid: packedGraphs(),
    });
    if (!question) {
      setClassDialog(null);
      classNote("There's nothing on your board to send yet.");
      return;
    }
    setSentQuestion(liveClassCode, question);
    setSendingQuestion(true);
    broadcastQuestion().then((ok) => {
      setSendingQuestion(false);
      setClassDialog(null);
      // The state names the question, so a page that missed a piece asks again.
      broadcastClassState();
      classNote(ok ? "Your board is on every student's board." : "That didn't send. Check your connection and try again.");
    });
  }

  function handleTakeBackQuestion() {
    setSentQuestion(liveClassCode, null);
    broadcastClassState();
    setClassDialog(null);
    classNote("Taken off students' boards. Their own work is untouched.");
  }

  // ---------- saving students' boards ----------

  // The boards are fetched over the same live connection the teacher's
  // views of them use, one connection per board: so those views are closed
  // first (see collectBoard in src/lib/boardExport.js).
  function handleOpenSaveBoards() {
    handleViewStudent(null);
    setClassOverview(false);
    setClassDialog("save");
  }

  // The teacher has dealt with a raised hand: tells that student's page to
  // put it down.
  function handleLowerHand(studentId) {
    const was = classStatusRef.current.get(studentId) || {};
    classStatusRef.current.set(studentId, { ...was, hand: false, handAt: 0 });
    refreshClassRoster();
    liveClassChannelRef.current?.send({ type: "broadcast", event: "hand-lower", payload: { studentId } });
  }

  // Ready for the next question: every hand goes down and every "done"
  // tick is cleared, on every student's page.
  function handleResetClassStatus() {
    classStatusRef.current = new Map();
    refreshClassRoster();
    liveClassChannelRef.current?.send({ type: "broadcast", event: "status-reset", payload: {} });
  }

  function handleToggleRuler() {
    setRulerActive((prev) => {
      const next = !prev;
      if (next) {
        const { width, height } = getPaneSize();
        setRulerPos({ x: width / 2, y: height / 2 });
        setRulerLen(rulerLength(width));
        setCompassActive(false);
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
        setPanToolActive(false);
      }
      return next;
    });
  }

  // Leaving the Select tool puts away any read-off (for the class too).
  function putAwayReadout() {
    if (graphTraceRef.current) {
      graphTraceRef.current = null;
      queueGraphBroadcast();
      fullRedraw();
    }
  }

  function handleTogglePan() {
    const next = !panToolActive;
    if (next) {
      toolBeforePanRef.current = tool;
      setRulerActive(false);
      setCompassActive(false);
      putAwayReadout();
    }
    setPanToolActive(next);
  }

  // Toolbar: picking a drawing/select/text tool always leaves Move mode,
  // so the tool you tapped is the one you get.
  function handleSelectTool(name) {
    setPanToolActive(false);
    if (name !== "select") {
      setSelection(emptySelection());
      putAwayReadout();
    }
    setTool(name);
  }

  function handleSelectMove() {
    if (!panToolActive) handleTogglePan();
  }

  // Maths ▸ Graph: the dialog for a new graph. (A graph on the board is
  // changed by double-tapping it, or Edit when it's selected.)
  function handleOpenGraph() {
    editingGraphIdRef.current = null;
    setGridModalInitialConfig(null);
    setGridModalZoomScale(scaleRef.current);
    setGridModalOpen(true);
  }

  function handleEditGraph(id) {
    const g = graphById(id);
    if (!g) return;
    editingGraphIdRef.current = id;
    setGridModalInitialConfig(g);
    setGridModalZoomScale(scaleRef.current);
    setGridModalOpen(true);
  }

  // The graph selected on its own, if one is (for Maths ▸ Edit graph).
  // The graph "Edit graph" changes: the one selected, or else the only one
  // on the board.
  function getSelectedGraphId() {
    const sel = selectionRef.current;
    if (toolRef.current === "select" && selectionCount(sel) === 1 && (sel.graphs || []).length) {
      return graphById(sel.graphs[0]) ? sel.graphs[0] : null;
    }
    if (graphsRef.current.length === 1) return graphsRef.current[0].id;
    return null;
  }

  function handleEditSelectedGraph() {
    const id = getSelectedGraphId();
    if (id) handleEditGraph(id);
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

  function handleCloseGridModal() {
    setGridModalOpen(false);
  }

  // Applies the graph dialog. The dialog's `cellSizePx` (a size ON SCREEN
  // at the zoom you're looking at, not a physical unit) sets the size of a
  // square, so more squares repeat the same-size square outward rather
  // than squeezing a fixed box. A graph being changed keeps its top left
  // corner; a new one goes in the middle of the view, or beside the graph
  // already there, and is selected (like anything else you add).
  function handleApplyGridConfig(config, extra) {
    const cols = config.cols || 10;
    const rows = config.type === "polar" ? cols : config.rows || cols;
    const cellScreenPx = Math.max(4, config.cellSizePx || 48);
    const editing = editingGraphIdRef.current ? graphById(editingGraphIdRef.current) : null;
    // (a square left at the size the dialog showed keeps its exact size:
    // the dialog rounds it to whole pixels)
    const editingCell = editing ? editing.size / editing.cols : 0;
    const cellWorldSize = editing && Math.round(editingCell * scaleRef.current) === cellScreenPx ? editingCell : cellScreenPx / scaleRef.current;
    const newSize = cellWorldSize * cols;
    const newHeight = cellWorldSize * rows;

    let updated;
    if (editing) {
      updated = { ...editing, ...config, id: editing.id, x: editing.x, y: editing.y, cols, rows, size: newSize };
      delete updated.more;
      // (a chart or isometric paper has nothing plotted, and no snapping)
      if (!("plot" in config)) delete updated.plot;
      if (!("snap" in config)) delete updated.snap;
      editGraph(editing.id, updated);
    } else {
      const at = placeGraph(graphsRef.current, newSize, newHeight, viewportCenterWorld(), 24 / scaleRef.current);
      updated = { ...config, id: newId(), cols, rows, x: at.x, y: at.y, size: newSize };
      delete updated.more;
      if (graphsRef.current.length >= MAX_GRAPHS) {
        flashNotice(`A board can have up to ${MAX_GRAPHS} graphs.`);
        setGridModalOpen(false);
        return;
      }
      addAsNewSelection({ strokes: [], texts: [], images: [], graphs: [updated] });
      // the new one may be partly off screen: bring it into view
      if (!isWorldPointVisible({ x: at.x + newSize / 2, y: at.y + newHeight / 2 })) {
        const { width, height } = getPaneSize();
        const scale = scaleRef.current;
        panRef.current = { x: width / 2 - (at.x + newSize / 2) * scale, y: height / 2 - (at.y + newHeight / 2) * scale };
        fullRedraw();
      }
    }
    editingGraphIdRef.current = updated.id;
    setGridModalOpen(false);
    // "Put the table on the board": as ordinary writing beside the graph,
    // selected so it can be dragged somewhere else straight away.
    if (extra && extra.table) {
      const rows = updated.type === "polar" ? updated.cols : updated.rows || updated.cols;
      const scale = scaleRef.current;
      const gridH = (updated.size / updated.cols) * rows;
      const objects = tableObjects(updated, extra.table, { at: { x: 0, y: 0 }, zoom: scale, makeId: newId, env: browserTextEnv() });
      if (objects) {
        // Beside the graph if there's room on screen, otherwise underneath
        // or above it, otherwise in the middle of the screen.
        let tw = 0, th = 0;
        for (const st of objects.strokes) for (const p of st.points) {
          tw = Math.max(tw, p.x);
          th = Math.max(th, p.y);
        }
        const gap = 28 / scale;
        const spots = [
          { x: updated.x + updated.size + gap, y: updated.y + gridH / 2 - th / 2 },
          { x: updated.x, y: updated.y + gridH + gap },
          { x: updated.x, y: updated.y - th - gap },
          { x: updated.x - tw - gap, y: updated.y + gridH / 2 - th / 2 },
        ];
        const fits = (p) => isWorldPointVisible(p) && isWorldPointVisible({ x: p.x + tw, y: p.y + th });
        let at = spots.find(fits);
        if (!at) {
          const c = viewportCenterWorld();
          at = { x: c.x - tw / 2, y: c.y - th / 2 };
        }
        const placedTable = {
          strokes: objects.strokes.map((st) => translateStroke(st, at.x, at.y)),
          texts: objects.texts.map((t) => translateText(t, at.x, at.y)),
          images: [],
        };
        addAsNewSelection(placedTable);
      }
    }
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

  // Insert ▸ Shape
  function handleOpenShapeModal() {
    const { width, height } = getPaneSize();
    setShapeModal({ zoom: scaleRef.current, maxSize: Math.floor(Math.min(width, height) * 0.85) });
  }

  function handleCloseShapeModal() {
    setShapeModal(null);
  }

  // The shape lands in the middle of the view as ordinary pen strokes and
  // text labels, already selected so it can be dragged straight into place.
  function handleAddShape({ built, color: shapeColor, lineWidth }) {
    const objects = shapeToBoardObjects(built, {
      at: viewportCenterWorld(),
      scale: scaleRef.current,
      color: shapeColor,
      lineWidth,
      makeId: newId,
      env: browserTextEnv(),
    });
    setShapeModal(null);
    addAsNewSelection(objects);
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

  // ---------- the reference document (a PDF or picture beside the board) ----------
  //
  // Kept with the board (src/lib/refStore.js), sent live to everyone on it,
  // and shown by ReferencePane.js.

  function sendRef(event, payload) {
    channelRef.current?.send({ type: "broadcast", event, payload });
  }

  function refDocKey(doc) {
    if (!doc) return null;
    return (doc.pdf && doc.pdf.path) || doc.path || doc.url || "";
  }

  // big changes go in pieces (one live message has a size limit)
  function sendMarkChange(change) {
    for (const piece of chunkList(change.add || [])) sendRef("ref-marks", { add: piece });
    for (const piece of chunkList(change.update || [])) sendRef("ref-marks", { update: piece });
    const remove = change.remove || [];
    for (let i = 0; i < remove.length; i += 2000) sendRef("ref-marks", { remove: remove.slice(i, i + 2000) });
  }

  // Keeps trying (while the board is open) until the removal is saved; a
  // check with the server meanwhile doesn't bring them back.
  async function deleteRefMarks(ids) {
    for (const id of ids) refDeletingRef.current.add(id);
    for (let tries = 0; tries < 1000; tries++) {
      const error = await deleteMarkRows(db, ids);
      if (!error || isMissingTable(error)) break;
      const wait = Math.min(60000, 3000 * (tries + 1));
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    for (const id of ids) refDeletingRef.current.delete(id);
  }

  function saveMarkChange(change) {
    if (student || !boardId || refSavedRef.current.marksSaved === false) return;
    const rows = [...(change.add || []), ...(change.update || [])].map((m) => markRow(boardId, m));
    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50);
      saveRows(sync, MARKS_TABLE, batch).then((error) => {
        if (!error) return;
        if (isMissingTable(error)) {
          // (the database isn't set up for this yet: kept live only)
          refSavedRef.current.marksSaved = false;
          forgetUnsaved(sync, batch.map((r) => r.id));
          return;
        }
        reportSaveError("marking on the document", error);
      });
    }
    const remove = change.remove || [];
    if (remove.length) {
      forgetUnsaved(sync, remove);
      deleteRefMarks(remove);
    }
  }

  // A change to the markings made here: shown, sent to everyone, saved.
  function handleRefMarks(change) {
    if (!change) return;
    setReferenceMarks((prev) => applyMarksChange(prev, change));
    sendMarkChange(change);
    saveMarkChange(change);
  }

  async function storeRefDoc(doc) {
    if (student || !isOwner || !boardId || refSavedRef.current.docSaved === false) return;
    const result = await saveReferenceDoc(db, boardId, doc);
    if (result === "saved") refSavedRef.current.serverKey = refDocKey(doc);
    else if (result === "missing") refSavedRef.current.docSaved = false;
    else flashNotice("The document couldn't be saved with the board just now. It's still here for everyone on the board.", 6000);
  }

  // The pages changed (turned, added, taken out): only the owner does this.
  function handleRefPagesChange(pages, markChange) {
    const doc = referenceDocRef.current;
    if (!doc || !isOwner) return;
    const next = { ...doc, pages, pageCount: pages.length };
    referenceDocRef.current = next;
    setReferenceDoc(next);
    sendRef("reference-update", { doc: next });
    storeRefDoc(next);
    if (markChange) handleRefMarks(markChange);
  }

  function safeFileName(name) {
    return String(name || "document").replace(/[^\w.\- ]+/g, "_").slice(-80) || "document";
  }

  async function uploadRefFile(blob, name, type) {
    const path = `${boardId}/${Date.now()}-${safeFileName(name)}`;
    let result;
    try {
      result = await db.storage.from("reference-docs").upload(path, blob, { contentType: type, upsert: false });
    } catch (err) {
      result = { error: err };
    }
    if (!result || result.error) {
      const error = (result && result.error) || {};
      console.error("Error uploading reference doc:", error);
      alert("Upload failed: " + (error.message || "please try again."));
      return null;
    }
    const { data } = db.storage.from("reference-docs").getPublicUrl(path);
    return { url: data.publicUrl, path };
  }

  // A brand-new document beside the board.
  function showNewRefDoc(doc) {
    referenceDocRef.current = doc;
    setReferenceDoc(doc);
    setReferenceMarks([]);
    setRefCollapsed(false);
    setPhoneView("pdf");
    sendRef("reference-set", { doc });
    storeRefDoc(doc);
    track("reference_opened", { pages: doc.pages.length, kind: doc.pdf ? "pdf" : "image" });
  }

  async function openRefImage(file) {
    setReferenceUploadStatus("Uploading…");
    const up = await uploadRefFile(file, file.name, file.type);
    setReferenceUploadStatus("");
    if (!up) return;
    showNewRefDoc({
      v: 2, fileName: file.name, fileType: file.type, url: up.url, path: up.path, pageCount: 1, pdf: null,
      pages: [{ id: newRefId(), kind: "image", url: up.url, path: up.path, rotate: 0 }],
    });
  }

  async function addRefImagePage(file) {
    if (!referenceDocRef.current) return;
    if (referenceDocRef.current.pages.length >= REF_MAX_PAGES) {
      alert(`The document already has ${REF_MAX_PAGES} pages, the most it can hold.`);
      return;
    }
    setReferenceUploadStatus("Uploading…");
    const up = await uploadRefFile(file, file.name, file.type);
    setReferenceUploadStatus("");
    const doc = referenceDocRef.current;
    if (!up || !doc) return;
    handleRefPagesChange([...doc.pages, { id: newRefId(), kind: "image", url: up.url, path: up.path, rotate: 0 }], null);
    flashNotice("Picture added as a page.");
  }

  async function handleReferenceFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const adding = refAddingRef.current && !!referenceDocRef.current;
    refAddingRef.current = false;
    if (!file || !isOwner) return;

    const allowedTypes = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      alert("Please choose a PDF, PNG, JPG, or WEBP file.");
      return;
    }
    if (file.type !== "application/pdf") {
      if (file.size > REF_MAX_UPLOAD_BYTES) {
        alert("That picture is too large — please choose one under 25MB.");
        return;
      }
      if (adding) addRefImagePage(file);
      else openRefImage(file);
      return;
    }
    if (!browserCanOpenPdfs()) {
      alert(PDF_UNSUPPORTED_MESSAGE);
      return;
    }
    if (file.size > REF_MAX_READ_BYTES) {
      alert("That PDF is too large to open here (over 200MB). Try saving just the chapter you need as its own PDF.");
      return;
    }
    const room = adding ? Math.min(REF_MAX_PICK, REF_MAX_PAGES - referenceDocRef.current.pages.length) : REF_MAX_PICK;
    if (room <= 0) {
      alert(`The document already has ${REF_MAX_PAGES} pages, the most it can hold.`);
      return;
    }
    // (the picker reads the file as it needs it, so a big textbook is
    // never held in memory more than once)
    setRefPicker({ file, url: URL.createObjectURL(file), fileName: file.name, size: file.size, adding, max: room });
  }

  function closeRefPicker() {
    if (refPicker && refPicker.url) URL.revokeObjectURL(refPicker.url);
    setRefPicker(null);
  }

  async function readFileBytes(file) {
    try {
      return await file.arrayBuffer();
    } catch (err) {
      return null;
    }
  }

  async function fetchBytes(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.arrayBuffer();
    } catch (err) {
      return null;
    }
  }

  function megabytes(n) {
    return (n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0);
  }

  // The picked pages as one PDF: { blob, size, adding, oldCount } or null.
  async function makeRefPdf(pick, picked, total) {
    const doc = referenceDocRef.current;
    const adding = pick.adding && !!doc;
    const sources = [];
    let oldCount = 0;
    if (adding && doc.pdf) {
      const old = await fetchBytes(doc.pdf.url);
      if (!old) {
        alert("Couldn't fetch the document to add to it — please try again.");
        return null;
      }
      oldCount = doc.pdf.pageCount || 0;
      sources.push({ bytes: old, pages: Array.from({ length: oldCount }, (_, i) => i + 1) });
    }
    const wholeFile = !adding && picked.length === total;
    let bytes = null;
    if (wholeFile && pick.size <= REF_MAX_UPLOAD_BYTES) {
      // every page: the file as it is
      return { blob: pick.file, size: pick.size, adding, oldCount };
    } else {
      const picked0 = await readFileBytes(pick.file);
      if (!picked0) {
        alert("Couldn't read that file — please try again.");
        return null;
      }
      sources.push({ bytes: picked0, pages: picked });
      const built = await buildPdf(sources).catch((err) => err || new Error("failed"));
      if (built instanceof Error) {
        console.error("Couldn't make the smaller PDF:", built);
        alert(
          built.message === "encrypted"
            ? "That PDF is locked, so pages can't be taken out of it. Open it on your computer, print it to a new PDF, and add that instead."
            : "Couldn't take those pages out of the PDF — it may be damaged."
        );
        return null;
      }
      bytes = built;
    }
    if (bytes.byteLength > REF_MAX_UPLOAD_BYTES) {
      alert(`Those pages come to ${megabytes(bytes.byteLength)}MB, and the most is 25MB. Please pick fewer pages.`);
      return null;
    }
    return { blob: new Blob([bytes], { type: "application/pdf" }), size: bytes.byteLength, adding, oldCount };
  }

  async function handleRefPagesPicked(picked, total) {
    const pick = refPicker;
    setRefPicker(null);
    if (!pick || !picked.length) return;
    // (revoked once the pages have been taken from it)
    const revoke = () => URL.revokeObjectURL(pick.url);
    setReferenceUploadStatus("Preparing pages…");
    const made = await makeRefPdf(pick, picked, total);
    revoke();
    if (!made) {
      setReferenceUploadStatus("");
      return;
    }
    setReferenceUploadStatus("Uploading…");
    const baseName = String(pick.fileName || "document").replace(/\.pdf$/i, "");
    const up = await uploadRefFile(made.blob, `${baseName}.pdf`, "application/pdf");
    setReferenceUploadStatus("");
    if (!up) return;
    const fresh = picked.map((_, i) => ({ id: newRefId(), kind: "pdf", src: made.oldCount + i + 1, rotate: 0 }));
    const doc = referenceDocRef.current;
    if (made.adding && doc) {
      const oldPath = doc.pdf ? doc.pdf.path : null;
      const pages = [...doc.pages, ...fresh];
      const next = {
        ...doc, url: up.url, path: up.path, fileType: "application/pdf", pageCount: pages.length,
        pdf: { url: up.url, path: up.path, pageCount: made.oldCount + picked.length }, pages,
      };
      referenceDocRef.current = next;
      setReferenceDoc(next);
      sendRef("reference-update", { doc: next });
      await storeRefDoc(next);
      if (oldPath && oldPath !== up.path && !String(oldPath).startsWith("demo/")) {
        db.storage.from("reference-docs").remove([oldPath]).then(({ error }) => {
          if (error) console.error("Error removing the old copy of the document:", error);
        });
      }
      flashNotice(`Added ${picked.length} page${picked.length === 1 ? "" : "s"} to the end of the document.`);
      return;
    }
    showNewRefDoc({
      v: 2, fileName: pick.fileName, fileType: "application/pdf", url: up.url, path: up.path, pageCount: picked.length,
      pdf: { url: up.url, path: up.path, pageCount: picked.length }, pages: fresh,
    });
  }

  async function handleRemoveReferenceDoc() {
    const doc = referenceDocRef.current;
    if (!doc) return;
    if (!window.confirm("Remove this document? Everything written on it goes too (clips already on the board stay).")) return;
    referenceDocRef.current = null;
    setReferenceDoc(null);
    setReferenceMarks([]);
    setPhoneView("board");
    sendRef("reference-remove", {});
    if (student || !isOwner) return;
    await storeRefDoc(null);
    if (refSavedRef.current.marksSaved !== false) deleteAllMarks(db, boardId);
    const paths = docFilePaths(doc).filter((path) => !String(path).startsWith("demo/"));
    if (paths.length) {
      db.storage.from("reference-docs").remove(paths).then(({ error }) => {
        if (error) console.error("Error removing reference doc:", error);
      });
    }
  }

  function handleReferenceToolClick() {
    setRefCollapsed(false);
    if (referenceDoc) {
      handleRemoveReferenceDoc();
    } else {
      refAddingRef.current = false;
      referenceFileInputRef.current?.click();
    }
  }

  function handleRefAddPages() {
    refAddingRef.current = true;
    referenceFileInputRef.current?.click();
  }

  // A part of the document clipped onto the board (as a picture that
  // remembers where it came from).
  async function handleRefClip(clip) {
    if (!boardId || !clip) return;
    const id = newId();
    let src = await uploadBoardImage(clip, id);
    if (!src) {
      const prepared = await prepareImageFile(new File([clip.blob], "clip.png", { type: clip.type })).catch(() => null);
      src = prepared ? await makeInlineImage(prepared) : null;
    }
    if (!src) {
      flashNotice("Couldn't add the clip — please try again.", 5000);
      return;
    }
    const center = viewportCenterWorld();
    const scale = scaleRef.current;
    const { width: paneW, height: paneH } = getPaneSize();
    const shown = Math.max(120, Math.min(paneW * 0.55, clip.width / 2, (paneH * 0.6 * clip.width) / clip.height));
    const width = shown / scale;
    const height = (width * clip.height) / clip.width;
    addAsNewSelection({
      strokes: [], texts: [],
      images: [{ id, x: center.x - width / 2, y: center.y - height / 2, width, height, src, source: clip.source }],
    });
    setPhoneView("board");
    track("reference_clip_added");
    flashNotice("Clipped onto the board. Select it to keep it in view or find it in the document again.", 4500);
  }

  function handleShowClipInPdf(img) {
    const src = img && img.source;
    const doc = referenceDocRef.current;
    if (!src || !doc || !doc.pages.some((p) => p.id === src.pageId)) {
      flashNotice(doc ? "That page isn't in the document any more." : "The document this came from has been removed.", 4000);
      return;
    }
    setRefCollapsed(false);
    setPhoneView("pdf");
    setTimeout(() => {
      if (refPaneHandleRef.current) refPaneHandleRef.current.showArea(src.pageId, src.box);
    }, 80);
  }

  function keepClipInView(img) {
    if (!img) return;
    const { width: paneW } = getPaneSize();
    const w = Math.round(Math.min(340, Math.max(180, paneW * 0.4)));
    setClipWindows((prev) => {
      const others = prev.filter((x) => x.id !== img.id);
      return [...others, { id: img.id, x: Math.max(8, paneW - w - 16), y: 72 + others.length * 28, w }].slice(-3);
    });
    setSelection(emptySelection());
  }

  // Live messages about the document (registered with the board's channel).
  function receiveRef(event, p) {
    const payload = p || {};
    if (event === "reference-set") {
      const doc = normalizeDoc(payload.doc);
      const same = !!doc && !!referenceDocRef.current && refDocKey(doc) === refDocKey(referenceDocRef.current);
      // (the owner saves it with the board as they send it)
      refSavedRef.current.serverKey = refDocKey(doc);
      referenceDocRef.current = doc;
      setReferenceDoc(doc);
      if (!same) setReferenceMarks(normalizeMarks(payload.marks));
      return;
    }
    if (event === "reference-update") {
      const doc = normalizeDoc(payload.doc);
      if (!doc) return;
      refSavedRef.current.serverKey = refDocKey(doc);
      referenceDocRef.current = doc;
      setReferenceDoc(doc);
      return;
    }
    if (event === "reference-remove") {
      referenceDocRef.current = null;
      setReferenceDoc(null);
      setReferenceMarks([]);
      setPhoneView("board");
      return;
    }
    if (event === "reference-request") {
      // The owner answers (everyone else loads it from the database), or
      // anyone at all when there's no database to load it from.
      const doc = referenceDocRef.current;
      if (!doc || (!isOwner && refSavedRef.current.docSaved !== false)) return;
      sendRef("reference-set", { doc });
      if (refSavedRef.current.marksSaved === false) sendMarkChange({ add: referenceMarksRef.current });
      return;
    }
    if (event === "ref-marks") {
      setReferenceMarks((prev) => applyMarksChange(prev, payload));
      return;
    }
    if (event === "reference-stroke") {
      // (from an older version of the app)
      const m = normalizeMark(payload.stroke);
      if (m) setReferenceMarks((prev) => applyMarksChange(prev, { add: [m] }));
      return;
    }
    if (event === "reference-stroke-remove") {
      setReferenceMarks((prev) => applyMarksChange(prev, { remove: [payload.strokeId] }));
      return;
    }
    if (event === "ref-laser") {
      refBus.emit("laser", payload);
      return;
    }
    if (event === "ref-view") refBus.emit("view", payload);
  }

  // The document as the database has it (on opening the board, and after
  // being away): its markings merged with any still being saved from here.
  async function refreshReference(first, known) {
    if (student || !boardId) return;
    const fetchStartedAt = Date.now();
    const loaded = await loadReference(db, boardId, known || null);
    if (!loaded) {
      // couldn't ask just now: once more in a little while
      if (first) setTimeout(() => refRefreshRef.current && refRefreshRef.current(true), 5000);
      return;
    }
    refSavedRef.current.docSaved = loaded.docSaved;
    refSavedRef.current.marksSaved = loaded.marksSaved;
    const current = referenceDocRef.current;
    if (loaded.doc) {
      refSavedRef.current.serverKey = refDocKey(loaded.doc);
      referenceDocRef.current = loaded.doc;
      setReferenceDoc(loaded.doc);
      if (loaded.marksSaved) {
        // (not ones rubbed out here whose removal is still on its way)
        const server = loaded.marks.filter((m) => !refDeletingRef.current.has(m.id));
        setReferenceMarks((prev) => mergeServerList(prev, server, sync, syncSince(fetchStartedAt)));
      }
      return;
    }
    // Gone from the database: removed while we were away (but not a
    // document someone has only just opened, still on its way there).
    if (!first && loaded.docSaved && current && refSavedRef.current.serverKey === refDocKey(current)) {
      referenceDocRef.current = null;
      setReferenceDoc(null);
      setReferenceMarks([]);
    }
  }

  useEffect(() => {
    refReceiveRef.current = receiveRef;
    refRefreshRef.current = refreshReference;
  });

  function handleDismissPencilTip() {
    setShowPencilTip(false);
    try {
      window.localStorage.setItem("whiteboard_scribble_tip_dismissed", "true");
    } catch (err) {}
  }

  // The text box editor is done (TextEditor.js): rawValue is the text, ""
  // when the box was left empty.
  function finishTextEdit(rawValue) {
    const info = editingTextRef.current;
    const trimmedForCheck = plainText(rawValue).trim();
    editingTextRef.current = null;
    setEditingText(null);
    if (!info) return;

    if (info.isEditingExisting) {
      if (!trimmedForCheck) {
        // Cleared out entirely while editing — treat that as deleting it.
        setTexts((prev) => prev.filter((t) => t.id !== info.id));
        setSelection(emptySelection());
        channelRef.current?.send({ type: "broadcast", event: "text-remove", payload: { textId: info.id } });
        db.from("texts").delete().eq("id", info.id).then(({ error }) => {
          if (error) console.error("Error deleting text:", error);
        });
        return;
      }
      // nothing changed (also when it was only written a little differently)
      if (rawValue === info.raw || rawValue === encodeText(decodeText(info.raw || ""))) {
        fullRedraw();
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

    if (!trimmedForCheck) {
      fullRedraw();
      return;
    }

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
    noteMyInk({ x: textObj.x, y: textObj.y });
    fullRedraw();
  }

  // Uploads a font for the text box editor (fonts.js).
  function uploadTextFont(file, takenNames) {
    return uploadFont(file, db, user && user.id, takenNames, boardId);
  }

  useEffect(() => {
    if (!editingText) return;
    repositionEditingTextarea();
    fullRedraw();
  }, [editingText]);

  // Registers new sim boxes' DOM nodes right after they mount / re-syncs
  // all of them after the list itself changes (add/remove).
  useEffect(() => {
    repositionSimEmbeds();
  }, [sims]);

  // Classroom Mode: sends this board, as it is right now, to whoever just
  // asked for it (a student opening the teacher's board, or the teacher
  // opening a student's). They have no database to load it from, so the
  // board answers from what it already has in memory.
  //
  // A small board goes as one message. A big one would be over the size a
  // live message is allowed to be (and would silently never arrive, leaving
  // the other side on a blank board), so it goes as: the settings, then the
  // contents in pieces, then "that's everything".
  function sendClassSnapshot(withComments) {
    const channel = channelRef.current;
    if (!channel) return;
    const send = (event, payload) => channel.send({ type: "broadcast", event, payload });
    const settings = {
      grid: packedGraphs(),
      background: backgroundRef.current,
      referenceDoc: referenceDocRef.current,
      referenceStrokes: [],
    };
    // the document's markings: with the rest when small, else in pieces after
    const refMarks = referenceMarksRef.current;
    const refMarksSmall = JSON.stringify(refMarks).length < 40000;
    if (refMarksSmall) settings.referenceStrokes = refMarks;
    // The teacher's comments on a student's board go only when it is the
    // teacher's own view of it that asked (a classmate being shown this
    // board has no business with them).
    if (student && withComments) settings.comments = commentStore.get();
    const contents = { strokes: strokesRef.current, texts: textsRef.current, images: imagesRef.current };
    const pieces = chunkObjects(contents, SNAPSHOT_CHUNK_CHARS);
    // A student's board: what the teacher has written on it goes too. (The
    // class question doesn't: everyone already has their own copy of it.)
    const inkPieces = student ? chunkObjects({ strokes: teacherStore.get().ink }, SNAPSHOT_CHUNK_CHARS) : [];
    if (pieces.length <= 1 && inkPieces.length <= 1) {
      send("classroom-state-snapshot", { ...contents, ...settings, teacherInk: inkPieces.length ? inkPieces[0].strokes : [] });
    } else {
      const snapshotId = newId();
      send("classroom-state-snapshot", {
        strokes: [], texts: [], images: [], teacherInk: [], ...settings, pieces: pieces.length + inkPieces.length, snapshotId,
      });
      pieces.forEach((piece) => send("classroom-state-piece", { ...piece, snapshotId }));
      inkPieces.forEach((piece) => send("classroom-state-piece", { teacherInk: piece.strokes, snapshotId }));
      send("classroom-state-done", { snapshotId });
    }
    if (!refMarksSmall) for (const piece of chunkList(refMarks)) send("ref-marks", { add: piece });
    // Someone who joins while the pen is down has missed the start of that
    // line, and would never see it. So what there is of it so far is sent
    // again, from the top, and it carries on live from there.
    const drawing = isDrawing.current ? currentStroke.current : null;
    if (drawing && drawing.points.length && currentStrokeId.current) {
      const strokeKey = `${clientId.current}-${currentStrokeId.current}`;
      pendingBroadcastPoints.current = [];
      send("stroke-start", {
        strokeKey, strokeId: drawing.id, tool: drawing.tool, color: drawing.color,
        width: drawing.width, opacity: drawing.opacity, point: drawing.points[0], by: clientId.current,
      });
      for (let i = 1; i < drawing.points.length; i += SNAPSHOT_STROKE_POINTS) {
        send("stroke-points", { strokeKey, points: drawing.points.slice(i, i + SNAPSHOT_STROKE_POINTS) });
      }
    }
  }

  useEffect(() => {
    if (!boardId || syncPaused || !liveMode.ready) return;
    const presence = presenceRef.current;
    const channel = liveChannel(
      `board-${boardId}`,
      // presence: who else has the board open, and where (keyed by this tab)
      peopleOn ? { broadcast: { self: false }, presence: { key: clientId.current } } : { broadcast: { self: false } },
      liveMode
    );
    // Messages sent while the connection is down wait for it (or, if they
    // only matter right now, are skipped): see src/lib/liveSend.js.
    const sender = createSender(channel);
    if (peopleOn) {
      // who's here: kept from the "joined" / "left" events (classRoster.js)
      const attendance = createAttendance();
      presence.attendance = attendance;
      presence.where = new Map();
      channel.on("presence", { event: "join" }, ({ key, newPresences, currentPresences }) => {
        attendanceJoin(attendance, key, newPresences, currentPresences);
        if (key !== clientId.current) answerNewcomer();
      });
      channel.on("presence", { event: "leave" }, ({ key, leftPresences, currentPresences }) => {
        attendanceLeave(attendance, key, leftPresences, currentPresences);
      });
      channel.on("presence", { event: "sync" }, () => {
        attendanceSync(attendance, channel.presenceState());
        notePeople();
      });
      // where someone is now
      channel.on("broadcast", { event: "person-where" }, ({ payload }) => {
        if (!payload || !payload.key || payload.key === clientId.current) return;
        presence.where.set(payload.key, { view: payload.view, ink: payload.ink, t: Date.now() });
        notePeople();
      });
    }
    // A student's own board only sends what the student is doing while
    // somebody is watching it (see src/lib/boardWatch.js). Everything this
    // board sends goes through the gate, which lets it out or keeps it back.
    const gate = student ? createSendGate((message) => sender.send(message)) : null;
    // (through the gate, which stamps it with the board's edition)
    const sayHere = () => (gate || sender).send({ type: "broadcast", event: "board-here", payload: {} });

    // Someone else changing the board keeps a watching viewer "active",
    // so a student following along never gets paused.
    channel.on("broadcast", { event: "*" }, ({ event }) => {
      // (someone else just moving around the board doesn't count)
      if (!/-request$|^person-where$/.test(String(event || ""))) noteRemoteActivity();
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
      // a name tag at the tip of their pen while they write
      if (peopleOn && payload.by && getSetting("nameTags")) {
        penTagOwners.current[payload.strokeKey] = payload.by;
        penTags.show(payload.by, peopleRef.current.byKey.get(payload.by), payload.point, worldToScreen);
      }
    });

    channel.on("broadcast", { event: "stroke-points" }, ({ payload }) => {
      const s = remoteStrokes.current[payload.strokeKey];
      if (!s) return;
      const newCount = payload.points.length;
      s.points.push(...payload.points);
      if (ctxRef.current) drawNewSegment(ctxRef.current, s, newCount);
      const by = penTagOwners.current[payload.strokeKey];
      if (by) penTags.move(by, s.points[s.points.length - 1], worldToScreen);
    });

    channel.on("broadcast", { event: "stroke-straight" }, ({ payload }) => {
      const s = remoteStrokes.current[payload.strokeKey];
      if (!s) return;
      s.points = [payload.start, payload.end];
      fullRedraw();
      const by = penTagOwners.current[payload.strokeKey];
      if (by) penTags.move(by, payload.end, worldToScreen);
    });

    channel.on("broadcast", { event: "stroke-shape" }, ({ payload }) => {
      const s = remoteStrokes.current[payload.strokeKey];
      if (!s) return;
      s.points = payload.points;
      fullRedraw();
    });

    channel.on("broadcast", { event: "stroke-end" }, ({ payload }) => {
      const by = penTagOwners.current[payload.strokeKey];
      if (by) {
        delete penTagOwners.current[payload.strokeKey];
        penTags.done(by);
      }
      // The finished line comes whole with this message, so it is kept even
      // if some of the live messages for it never arrived (or arrived in
      // the wrong order). Older apps send only the key.
      const live = remoteStrokes.current[payload.strokeKey];
      delete remoteStrokes.current[payload.strokeKey];
      const s = cleanIncomingStroke(payload.stroke) || (live && live.points.length > 1 ? live : null);
      if (!s) {
        // A line finished that never showed up here: fetch it shortly.
        if (!live) syncSoon();
        fullRedraw();
        return;
      }
      // (a finished line that was held back while the writer's connection was
      // down can arrive after someone rubbed it out: it stays rubbed out)
      const removed = sync.removedAt.get(s.id);
      if (removed && Date.now() - removed < 120000) return;
      setStrokes((prev) => (prev.some((x) => x.id === s.id) ? prev.map((x) => (x.id === s.id ? s : x)) : [...prev, s]));
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
      setGraphsFromServer(payload.grid);
      fullRedraw();
      // (a selected graph deleted elsewhere is no longer selected)
      const sel = selectionRef.current;
      if (sel && (sel.graphs || []).some((id) => !graphById(id))) {
        setSelection({ ...sel, graphs: sel.graphs.filter((id) => graphById(id)) });
      }
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

    // The reference document beside the board, its markings, live
    // pointers and "follow me" (receiveRef, below).
    for (const event of REF_EVENTS) {
      channel.on("broadcast", { event }, ({ payload }) => {
        if (refReceiveRef.current) refReceiveRef.current(event, payload);
      });
    }

    // Classroom Mode: a read-only viewer has no database access (students
    // never log in), so it asks over this same channel for the board's
    // current state instead. See sendClassSnapshot above.
    //
    // Several viewers often ask within a moment of each other (a class
    // joining, or a whole class being shown one student's board), and the
    // answer goes to everyone on the connection anyway: so they share one.
    channel.on("broadcast", { event: "classroom-state-request" }, ({ payload }) => {
      if (gate) gate.heard("classroom-state-request", payload);
      if (payload && payload.comments) snapshotCommentsRef.current = true;
      if (snapshotTimerRef.current) return;
      snapshotTimerRef.current = setTimeout(() => {
        snapshotTimerRef.current = null;
        const withComments = snapshotCommentsRef.current;
        snapshotCommentsRef.current = false;
        sendClassSnapshot(withComments);
      }, 150);
    });

    // "Still watching" and "I've stopped", from whoever has this student's
    // board on screen. If one of them turns out to have missed something
    // (nothing was being sent for a while), everyone is told to ask again.
    channel.on("broadcast", { event: "board-watch" }, ({ payload }) => {
      if (gate && gate.heard("board-watch", payload)) sayHere();
    });
    channel.on("broadcast", { event: "board-unwatch" }, ({ payload }) => {
      if (gate) gate.heard("board-unwatch", payload);
    });

    // A student's own board: the teacher pins notes on it from their view
    // of it (TeacherStudentBoardView). The student's board keeps the list,
    // so it is still there if the teacher closes that view and comes back.
    channel.on("broadcast", { event: "teacher-comment-add" }, ({ payload }) => {
      if (!student || !payload || !payload.id) return;
      commentStore.add(payload);
    });

    channel.on("broadcast", { event: "teacher-comment-remove" }, ({ payload }) => {
      if (!student || !payload) return;
      commentStore.remove(payload.id);
    });

    // …and can write on it. Their lines arrive live, like anyone's ink, but
    // go into the teacher's layer rather than among the student's own work
    // (see TeacherStudentBoardView and src/lib/localBoard.js).
    channel.on("broadcast", { event: "teacher-ink-start" }, ({ payload }) => {
      if (!student || !payload || !payload.strokeKey) return;
      teacherLiveRef.current[payload.strokeKey] = {
        id: payload.strokeId, tool: "pen", color: payload.color, width: payload.width, opacity: 1, points: [payload.point],
        at: Date.now(),
      };
      // A line whose "finished" message never arrives (the teacher's
      // connection dropped mid-line) isn't left hanging on the board: lines
      // that have had no news for 20 seconds are dropped.
      if (teacherLiveTimerRef.current) return;
      teacherLiveTimerRef.current = setInterval(() => {
        const live = teacherLiveRef.current;
        const now = Date.now();
        let left = false;
        let dropped = false;
        for (const key in live) {
          if (now - (live[key].at || 0) >= 20000) {
            delete live[key];
            dropped = true;
          } else {
            left = true;
          }
        }
        if (dropped) drawTeacherOverlay();
        if (!left) {
          clearInterval(teacherLiveTimerRef.current);
          teacherLiveTimerRef.current = null;
        }
      }, 5000);
    });
    channel.on("broadcast", { event: "teacher-ink-points" }, ({ payload }) => {
      const s = student && payload ? teacherLiveRef.current[payload.strokeKey] : null;
      if (!s) return;
      s.points.push(...(payload.points || []));
      s.at = Date.now();
      drawTeacherOverlay();
    });
    channel.on("broadcast", { event: "teacher-ink-cancel" }, ({ payload }) => {
      if (!student || !payload) return;
      delete teacherLiveRef.current[payload.strokeKey];
      drawTeacherOverlay();
    });
    channel.on("broadcast", { event: "teacher-ink-end" }, ({ payload }) => {
      if (!student || !payload) return;
      // The finished line comes whole with this message (unless it is
      // enormous), so it is kept even if some of the live messages were lost.
      const s = payload.stroke || teacherLiveRef.current[payload.strokeKey];
      delete teacherLiveRef.current[payload.strokeKey];
      if (s && s.id && s.points && s.points.length > 1) teacherStore.addInk({ ...s, tool: "pen" });
      drawTeacherOverlay();
    });
    channel.on("broadcast", { event: "teacher-ink-remove" }, ({ payload }) => {
      if (!student || !payload) return;
      teacherStore.removeInk(payload.ids);
    });
    channel.on("broadcast", { event: "teacher-ink-clear" }, () => {
      if (!student) return;
      teacherLiveRef.current = {};
      teacherStore.clearInk();
      drawTeacherOverlay();
    });

    let joined = false;
    let saidHere = false;
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        joined = true;
        if (peopleOn) {
          presence.channel = channel;
          presence.sent = null;
          // who we are, announced once (never changed: see classRoster.js)
          Promise.resolve(channel.track({ uid: personId(user.id), name: nameFor(displayNameFor(user), user.email) })).catch(() => {});
          sendWhere(myWhere());
        }
        // A student's board that has just connected says so: anyone who
        // already has it on screen (the student refreshed their page) asks
        // for it afresh. So does one that has come back after a dropped
        // connection, if what it sent meanwhile may have gone nowhere.
        if (gate) {
          if (!saidHere) {
            saidHere = true;
            gate.announced();
            sayHere();
          } else if (gate.rejoined()) {
            sayHere();
          }
        }
        // what waited while the connection was down goes now
        sender.flush();
        channel.send({ type: "broadcast", event: "reference-request", payload: {} });
        // Re-joined after being away (idle pause, sleep, dropped Wi-Fi):
        // fetch what changed meanwhile. The first join is covered by the
        // initial load. Then once more a few seconds later, for anything
        // that was still being saved by someone else at that moment.
        if (connectedOnceRef.current) {
          catchUpWithServer();
          syncSoon(6000);
        } else {
          retryUnsaved(sync);
        }
        connectedOnceRef.current = true;
      } else if (gate) {
        gate.dropped();
      }
    });
    channelRef.current = gate || sender;
    // If the join hasn't gone through after a few seconds (the old
    // connection was still closing), give the connection a nudge.
    const joinWatchdog = setInterval(() => {
      if (joined) clearInterval(joinWatchdog);
      else nudgeRealtime();
    }, 4000);

    return () => {
      clearInterval(joinWatchdog);
      // gone from the board: nobody to find until we're back
      if (presence.timer) clearTimeout(presence.timer);
      if (presence.replyTimer) clearTimeout(presence.replyTimer);
      presence.timer = null;
      presence.replyTimer = null;
      presence.channel = null;
      presence.attendance = null;
      peopleRef.current = { list: [], byKey: new Map(), faces: "" };
      setPeople([]);
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
      snapshotTimerRef.current = null;
      if (teacherLiveTimerRef.current) clearInterval(teacherLiveTimerRef.current);
      teacherLiveTimerRef.current = null;
      supabase.removeChannel(channel);
      channelRef.current = null;
      if (quickSyncTimerRef.current) clearTimeout(quickSyncTimerRef.current);
      quickSyncTimerRef.current = null;
      // a slider moved a moment ago: save it now rather than lose it
      if (graphBroadcastTimer.current) clearTimeout(graphBroadcastTimer.current);
      graphBroadcastTimer.current = null;
      if (graphSaveTimer.current) {
        clearTimeout(graphSaveTimer.current);
        graphSaveTimer.current = null;
        saveGrid();
      }
      // Half-drawn strokes from others would otherwise stay stuck on screen.
      remoteStrokes.current = {};
      penTagOwners.current = {};
      penTags.clear();
    };
  }, [boardId, syncPaused, liveMode.ready, liveMode.private]);

  // While other people are on the board, check with the server now and
  // then (a quick look at what changed), so a line whose live messages were
  // lost on the way still turns up.
  useEffect(() => {
    if (!boardId || syncPaused || !peopleOn || !isRealBackend(db)) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden" || !peopleRef.current.list.length || !syncCursorRef.current) return;
      catchUpWithServer({ quiet: true });
    }, 45000);
    return () => clearInterval(timer);
  }, [boardId, syncPaused, peopleOn]);

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
    // (100 ms: about 10 messages a second while the pen moves. Each one
    // reaches everyone on the board, and Supabase counts every copy, so
    // this is the biggest single lever on how many messages a class uses.
    // Lines still look smooth: the points come in bigger batches.)
    const BROADCAST_THROTTLE_MS = 100;

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

    // `finished`: the whole line, sent with "stroke-end" so that anyone who
    // missed some of its live messages still gets all of it.
    function finalizeStroke(strokeId, finished) {
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
        const whole = wholeStroke(finished);
        channelRef.current?.send({
          type: "broadcast",
          event: "stroke-end",
          payload: whole ? { strokeKey: `${clientId.current}-${strokeId}`, stroke: whole } : { strokeKey: `${clientId.current}-${strokeId}` },
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
      const pts = finished.points || [];
      noteMyInk(pts[pts.length - 1]);
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

      finalizeStroke(strokeId, finished);

      if (finished && finished.points.length > 1) {
        commitFinishedStroke(finished);
      }
    }

    function beginPanZoom() {
      stopViewGlide();
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
      stopViewGlide();
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

    // Pressing on a curve (or a pinned point) of a graph, with the Select
    // tool: reading it off. True if that's what the press was.
    function startGraphReadout(pos) {
      const w = screenToWorld(pos);
      const reach = 18 / scaleRef.current;
      const list = graphsRef.current;
      for (let i = list.length - 1; i >= 0; i--) {
        const grid = list[i];
        if (!grid.plot) continue;
        const geom = graphGeom(grid);
        const pin = pinNear(grid, geom, w.x, w.y, reach);
        const hit = pin ? null : curvePointNear(grid, geom, w.x, w.y, reach);
        if (!pin && !hit) continue;
        const prev = graphTraceRef.current;
        const keepTangent = !!(prev && !prev.pinId && prev.tangent && prev.graphId === grid.id);
        graphTraceRef.current = pin
          ? { graphId: grid.id, fnId: pin.fnId, x: pin.x, tangent: !!pin.tangent, pinId: pin.id }
          : { graphId: grid.id, fnId: hit.fnId, x: hit.x, tangent: keepTangent };
        gridDragMode.current = "trace";
        fullRedraw();
        queueGraphBroadcast();
        return true;
      }
      if (graphTraceRef.current) {
        graphTraceRef.current = null;
        fullRedraw();
        queueGraphBroadcast();
      }
      return false;
    }

    // Sliding a read-off along its curve.
    function handleGridPointerMove(pos) {
      const t = graphTraceRef.current;
      const grid = t ? graphById(t.graphId) : null;
      if (!grid || !t) return;
      const w = screenToWorld(pos);
      const next = traceAlong(grid, graphGeom(grid), t.fnId, w.x, 10 / scaleRef.current);
      if (!next) return;
      graphTraceRef.current = { ...t, x: next.x };
      fullRedraw();
      queueGraphBroadcast();
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
        raw: existingText.text,
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

    // ---------- snapping to a graph's grid ----------
    // On a graph with snapping turned on, a ruler line's ends and a short
    // pen mark (a dot, or one line of a small ×) land exactly on the
    // nearest grid crossing — when they're already close to one, so
    // ordinary writing on the graph is left alone. Returns the stroke as it
    // should be kept (the same one if nothing moved).
    function snapStroke(stroke) {
      if (!stroke || stroke.tool !== "pen" || !stroke.points || stroke.points.length < 2) return stroke;
      const scale = scaleRef.current;
      const graphs = graphsRef.current.filter((g) => g.snap && g.type !== "chart" && g.type !== "polar");
      if (!graphs.length) return stroke;
      const nearestCrossing = (p, reachPx) => {
        const g = graphAt(graphs, p);
        if (!g) return null;
        const frame = gridFrame(g, graphGeom(g));
        const c = snapPoint(g, frame, p);
        if (!c) return null;
        const reach = Math.min(0.45 * snapSpacing(g, frame), reachPx / scale);
        return Math.hypot(c.x - p.x, c.y - p.y) <= reach ? c : null;
      };
      const pts = stroke.points;
      if (pts.length === 2) {
        // a straight line (the ruler, or Shift): each end on its own
        const a = nearestCrossing(pts[0], 24), b = nearestCrossing(pts[1], 24);
        if (!a && !b) return stroke;
        return { ...stroke, points: [a ? { ...pts[0], x: a.x, y: a.y } : pts[0], b ? { ...pts[1], x: b.x, y: b.y } : pts[1]] };
      }
      const box = strokeBounds(stroke);
      if (!box || Math.max(box.maxX - box.minX, box.maxY - box.minY) > 30 / scale) return stroke;
      const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
      const c = nearestCrossing(centre, 20);
      if (!c) return stroke;
      return translateStroke(stroke, c.x - centre.x, c.y - centre.y);
    }

    // ---------- scribble to erase ----------
    function tryScratchOut(stroke) {
      if (stroke.tool !== "pen" || !getScribbleErase()) return false;
      if (rulerEdgeRef.current || compassActiveRef.current) return false;
      const hit = detectScratchOut(
        stroke,
        { strokes: strokesRef.current, texts: textsRef.current, textHeight: textHeightOf },
        scaleRef.current,
        getScribbleLevel()
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
          graphs: new Map(data.graphs.map((o) => [o.id, o])),
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
      if (g.orig.graphs.size) {
        graphsRef.current = map(graphsRef.current, g.orig.graphs, translateGraph);
        // students watching see a graph move as it's dragged
        queueGraphBroadcast();
      }
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
      if (graphResizeRef.current) {
        const { orig } = graphResizeRef.current;
        graphsRef.current = graphsRef.current.map((x) => (x.id === orig.id ? orig : x));
        graphResizeRef.current = null;
        queueGraphBroadcast();
      }
      marqueeRef.current = null;
      fullRedraw();
    }

    // ---------- the pointer (Settings ▸ Board ▸ Pointer: boardCursor.js) ----------
    // The brush-size ring follows a mouse, a trackpad or a hovering Pencil
    // over the board; it's as big as what the tool will cover, at this zoom.
    function moveCursorRing(e, pos) {
      const ring = cursorRingRef.current;
      if (!ring) return;
      const t = toolRef.current;
      const show =
        e.pointerType !== "touch" &&
        getSetting("pointerStyle") === "size" &&
        isInkTool(t) &&
        !panToolActiveRef.current &&
        !compassActiveRef.current &&
        !strokeEraseRef.current;
      if (!show) {
        if (ring.style.display !== "none") ring.style.display = "none";
        return;
      }
      const look = ringLook(t, widthForTool(t, widthRef.current), scaleRef.current, inkOn(colorRef.current, pageIsDark()));
      ring.style.display = "block";
      ring.style.width = ring.style.height = look.d + "px";
      ring.style.border = look.border;
      ring.style.background = look.background;
      ring.style.boxShadow = look.shadow;
      ring.style.transform = `translate(${pos.x - look.d / 2}px, ${pos.y - look.d / 2}px)`;
    }
    function hideCursorRing() {
      const ring = cursorRingRef.current;
      if (ring) ring.style.display = "none";
    }

    // the length of a line along the ruler, beside the pen
    function showRulerReadout(from, to, angle, side) {
      const el = rulerReadoutRef.current;
      if (!el) return;
      const px = Math.hypot(to.x - from.x, to.y - from.y);
      el.textContent = rulerMeasure(px, scaleRef.current, getSetting("rulerUnits"));
      el.style.display = "block";
      // beside the pen, on the side away from the ruler
      const away = 30 * (side || 1);
      const cx = to.x - Math.sin(angle) * away;
      const cy = to.y + Math.cos(angle) * away;
      el.style.transform = `translate(calc(${Math.round(cx)}px - 50%), calc(${Math.round(cy)}px - 50%))`;
    }
    function hideRulerReadout() {
      const el = rulerReadoutRef.current;
      if (el) el.style.display = "none";
    }

    function handlePointerDown(e) {
      stopViewGlide();
      let pos = getPos(e);
      moveCursorRing(e, pos);

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
        // (a two- or three-finger tap: remember the view to put back)
        if (!tapGesture.active()) tapViewRef.current = { pan: { ...panRef.current }, scale: scaleRef.current };
        tapGesture.down(e.pointerId, pos.x, pos.y, e.timeStamp || performanceNow());
      }

      if (touchPoints.current.size >= 2) {
        cancelActiveDrawing();
        cancelSelectionDrag();
        finishStrokeErase();
        movingTextRef.current = null;
        if (panDragActive.current) {
          panDragActive.current = false;
          panDragStart.current = null;
          // (Settings: the Move tool can stay on until another tool is picked)
          if (getSetting("moveReturns") && !holdMoveRef.current) {
            setPanToolActive(false);
            setTool(toolBeforePanRef.current || "pen");
          }
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

        // A single selected graph: its corner handle resizes it.
        if (count === 1 && (sel.graphs || []).length === 1) {
          const gr = graphById(sel.graphs[0]);
          if (gr) {
            const b = graphBox(gr);
            if (distance(pos, worldToScreen({ x: b.maxX, y: b.maxY })) < 24) {
              graphResizeRef.current = { id: gr.id, startPos: pos, orig: { ...gr } };
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

        // A second tap on a graph that was just tapped: its settings.
        const lastGraphTap = lastGraphTapRef.current;
        lastGraphTapRef.current = null;
        if (!hit && lastGraphTap && now - lastGraphTap.time < 450) {
          const tapped = graphAt(graphsRef.current, worldPos);
          if (tapped && tapped.id === lastGraphTap.id) {
            setSelection({ strokes: [], texts: [], images: [], graphs: [tapped.id] });
            handleEditGraph(tapped.id);
            return;
          }
        }

        // Pressing inside the current (multi-)selection drags all of it
        // (a graph selected on its own: unless the press is on one of its
        // curves, which reads it off).
        const singleText = count === 1 && sel.texts.length === 1 && !(sel.graphs || []).length;
        const onlyGraph = count === 1 && (sel.graphs || []).length === 1;
        let inSelection = false;
        if (count > 0 && !singleText) {
          const b = getSelectionBounds();
          const pad = 8 / scaleRef.current;
          inSelection = !!b && worldPos.x >= b.minX - pad && worldPos.x <= b.maxX + pad && worldPos.y >= b.minY - pad && worldPos.y <= b.maxY + pad;
        }
        if (inSelection && !onlyGraph) {
          startGroupMove(pos, e.pointerId);
          return;
        }

        // Writing, lines and pictures come before a graph under them.
        const hitStroke = hit ? null : hitTestStrokes(strokesRef.current, worldPos, 10 / scaleRef.current);
        const hitImage = hit || hitStroke ? null : hitTestImages(imagesRef.current, worldPos);

        // Pressing on a graph's curve reads it off.
        if (!hit && !hitStroke && !hitImage && startGraphReadout(pos)) {
          try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
          return;
        }

        if (inSelection) {
          // (a tap on a graph that's selected on its own counts towards a double-tap)
          lastGraphTapRef.current = { id: sel.graphs[0], time: now };
          startGroupMove(pos, e.pointerId);
          return;
        }

        if (hit) {
          setSelection({ strokes: [], texts: [hit.id], images: [] });
          startGroupMove(pos, e.pointerId);
          return;
        }

        if (hitStroke || hitImage) {
          setSelection({
            strokes: hitStroke ? [hitStroke.id] : [],
            texts: [],
            images: hitImage ? [hitImage.id] : [],
          });
          startGroupMove(pos, e.pointerId);
          return;
        }

        // A graph: selected, to move, resize, copy or delete like anything else.
        const hitGraph = graphAt(graphsRef.current, worldPos);
        if (hitGraph) {
          setSelection({ strokes: [], texts: [], images: [], graphs: [hitGraph.id] });
          lastGraphTapRef.current = { id: hitGraph.id, time: now };
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
          textEditorRef.current?.commit();
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
      // With the ruler out, a pen or highlighter line started by one of its
      // edges follows that edge; anywhere else it's ordinary writing.
      rulerEdgeRef.current = null;
      if (rulerActiveRef.current && !compassActiveRef.current && (t === "pen" || t === "highlighter")) {
        const ruler = { position: rulerPosRef.current, angle: rulerAngleRef.current, length: rulerLenRef.current };
        const edge = rulerEdgeAt(pos, ruler, widthForTool(t, widthRef.current) * scaleRef.current);
        if (edge) {
          rulerEdgeRef.current = { ruler, offset: edge.offset };
          pos = rulerProject(pos, ruler, edge.offset);
          strokeScreenStart.current = pos;
          lastRawScreenPos.current = pos;
        }
      }
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
        isMobileRef.current && !compassActiveRef.current && !rulerEdgeRef.current;

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
          by: clientId.current,
        },
      });
    }

    function handlePointerMove(e) {
      if (e.pointerType === "pen") notePenActivity();
      moveCursorRing(e, getPos(e));
      if (e.pointerType === "touch" && touchPoints.current.has(e.pointerId)) {
        const p = getPos(e);
        touchPoints.current.set(e.pointerId, p);
        tapGesture.move(e.pointerId, p.x, p.y);
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

      if (graphResizeRef.current) {
        const pos = getPos(e);
        const r = graphResizeRef.current;
        const dx = (pos.x - r.startPos.x) / scaleRef.current;
        const dy = (pos.y - r.startPos.y) / scaleRef.current;
        const b = graphBox(r.orig);
        const w = b.maxX - b.minX, h = b.maxY - b.minY;
        // follow whichever way was dragged further, keeping the shape
        const grow = Math.abs(dx) >= Math.abs(dy) ? dx : (dy * w) / h;
        const size = Math.max(60 / scaleRef.current, r.orig.size + grow);
        r.last = { ...r.orig, size };
        graphsRef.current = graphsRef.current.map((x) => (x.id === r.orig.id ? r.last : x));
        selectionBoundsCacheRef.current = null;
        fullRedraw();
        queueGraphBroadcast();
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

      if (rulerEdgeRef.current) {
        const { ruler, offset } = rulerEdgeRef.current;
        const projectedScreen = rulerProject(screenPos, ruler, offset);
        const worldStart = screenToWorld(strokeScreenStart.current);
        const worldEnd = screenToWorld(projectedScreen);
        currentStroke.current.points = [worldStart, worldEnd];
        fullRedraw();
        scheduleStraightBroadcast(worldStart, worldEnd);
        showRulerReadout(strokeScreenStart.current, projectedScreen, ruler.angle, Math.sign(offset));
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
      hideRulerReadout();
      if (e.pointerType === "touch") {
        touchPoints.current.delete(e.pointerId);
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
        if (e.type === "pointercancel") tapGesture.cancel();
        else tapGesture.up(e.pointerId, e.timeStamp || performanceNow());
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
        // One drag, then back to the tool you had (unless Settings says the
        // Move tool stays on).
        if (getSetting("moveReturns") && !holdMoveRef.current) {
          setPanToolActive(false);
          setTool(toolBeforePanRef.current || "pen");
        }
        return;
      }

      if (gridDragMode.current) {
        gridDragMode.current = null;
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
        // a pinned point that was slid along its curve stays where it was left
        const t = graphTraceRef.current;
        const grid = t ? graphById(t.graphId) : null;
        if (t && t.pinId && grid && grid.plot) {
          setGraphPlot(grid.id, { ...cleanPlot(grid.plot), pins: cleanPlot(grid.plot).pins.map((p) => (p.id === t.pinId ? { ...p, x: t.x } : p)) });
        }
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

      if (graphResizeRef.current) {
        const r = graphResizeRef.current;
        graphResizeRef.current = null;
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
        // back to how it was, then the change made once (and undoable)
        graphsRef.current = graphsRef.current.map((x) => (x.id === r.orig.id ? r.orig : x));
        if (r.last && r.last.size !== r.orig.size) editGraph(r.orig.id, r.last);
        else fullRedraw();
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
            graphs: graphsRef.current,
            graphBox,
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
        updateTextRow(id, { x: finalX, y: finalY }, "position");
        return;
      }

      if (resizingTextRef.current) {
        const r = resizingTextRef.current;
        const finalWidth = r.lastWidth ?? r.origWidth;
        const finalFontSize = r.lastFontSize ?? r.origFontSize;
        resizingTextRef.current = null;
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
        updateTextRow(r.id, { width: finalWidth, font_size: finalFontSize }, "size");
        return;
      }

      if (rotatingTextRef.current) {
        const r = rotatingTextRef.current;
        const finalRotation = r.lastRotation ?? r.origRotation;
        rotatingTextRef.current = null;
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
        updateTextRow(r.id, { rotation: finalRotation }, "rotation");
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

      let finished = currentStroke.current;
      const strokeId = currentStrokeId.current;
      currentStroke.current = null;
      currentStrokeId.current = null;

      // a point or ruler line that snaps to a graph's grid goes out (and is
      // kept) where it snapped to
      const snapped = snapStroke(finished);
      if (snapped !== finished) {
        finished = snapped;
        pendingShapeUpdate.current = snapped.points;
        fullRedraw();
      }

      finalizeStroke(strokeId, finished);

      if (finished && finished.points.length > 1 && !tryScratchOut(finished)) {
        commitFinishedStroke(finished);
      }
    }

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);
    canvas.addEventListener("pointerleave", hideCursorRing);
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
    canvas.removeEventListener("pointerleave", hideCursorRing);
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
    } else if (entry.op === "graph-edit") {
      applyGraphFields(entry, entry.before);
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
    } else if (entry.op === "graph-edit") {
      applyGraphFields(entry, entry.after);
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
      db.from("strokes").delete().eq("id", last.id).then(({ error }) => {
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
      db.from("texts").delete().eq("id", last.id).then(({ error }) => {
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
    if (window.confirm(student ? "Clear your whole board? This can't be undone." : "Clear the whole board for everyone? This can't be undone.")) {
      performClear();
      myStrokeStack.current = [];
      myRedoStack.current = [];
      setMyUndoAvailable(false);
      setMyRedoAvailable(false);
      channelRef.current?.send({ type: "broadcast", event: "clear", payload: {} });
      db.from("strokes").delete().eq("board_id", boardId).then(({ error }) => {
        if (error) console.error("Error clearing strokes:", error);
      });
      db.from("texts").delete().eq("board_id", boardId).then(({ error }) => {
        if (error) console.error("Error clearing texts:", error);
      });
      db.from("images").delete().eq("board_id", boardId).then(({ error }) => {
        if (error) console.warn("Error clearing images:", error);
      });
    }
  }

  // ---------- idle pause + unsaved work ----------

  useEffect(() => (student ? undefined : startIdleWatch()), []);

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
    // Saves the database kept refusing (the board was deleted, or it's no
    // longer shared with this person): say so once.
    setGiveUpHandler(sync, () => {
      if (rlsNoticeShownRef.current) return;
      rlsNoticeShownRef.current = true;
      flashNotice("Some changes on this board couldn't be saved, so they may be gone after a reload.", 9000);
    });
    setExistsCheck(
      sync,
      (id) =>
        strokesRef.current.some((o) => o.id === id) ||
        textsRef.current.some((o) => o.id === id) ||
        imagesRef.current.some((o) => o.id === id) ||
        referenceMarksRef.current.some((o) => o.id === id)
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
      setGiveUpHandler(sync, null);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  // Refresh the boards-list preview a few seconds after the board changes,
  // and straight away when leaving the page.
  useEffect(() => {
    scheduleThumbnail();
  }, [strokes, texts, images, boardBackground, graphsVersion]);

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

  // ---------- shortcuts and gestures (src/lib/shortcuts.js) ----------

  // Does what a shortcut says. Returns false if it doesn't apply here.
  function runAction(action) {
    const zoomTo = (factor) => handleSetZoom(Math.round(scaleRef.current * factor * 100));
    switch (action) {
      case "pen":
      case "highlighter":
      case "eraser":
      case "select":
      case "text":
        if (student && action === "select") return false;
        handleSelectTool(action);
        return true;
      case "move":
        if (!panToolActiveRef.current) handleTogglePan();
        return true;
      case "ruler":
        handleToggleRuler();
        return true;
      case "undo":
        handleUndo();
        return true;
      case "redo":
        handleRedo();
        return true;
      case "zoomIn":
        zoomTo(1.25);
        return true;
      case "zoomOut":
        zoomTo(0.8);
        return true;
      case "zoomReset":
        handleSetZoom(100);
        return true;
      case "help":
        if (student) return false;
        setSettingsOpen("shortcuts");
        return true;
      default:
        return false;
    }
  }

  // 1–7: the pen colours (and the pen, if a non-ink tool was on)
  function pickColourKey(n) {
    const c = PEN_COLORS[n - 1];
    if (!c) return;
    setColor(c[1]);
    if (toolRef.current !== "pen" && toolRef.current !== "highlighter") handleSelectTool("pen");
  }

  function startHoldMove() {
    if (holdMoveRef.current || panToolActiveRef.current) return;
    holdMoveRef.current = true;
    toolBeforePanRef.current = toolRef.current;
    setPanToolActive(true);
  }
  function endHoldMove() {
    if (!holdMoveRef.current) return;
    holdMoveRef.current = false;
    setPanToolActive(false);
    setTool(toolBeforePanRef.current || "pen");
  }

  // A two- or three-finger tap on the board.
  function handleTap(fingers) {
    // a resting hand while the Pencil writes isn't a tap
    if (msSincePenActivity() < 800) return;
    const action = getSetting(fingers >= 3 ? "gesture3" : "gesture2");
    if (!action || action === "none") return;
    // put the view back as it was (the fingers may have nudged the zoom)
    const before = tapViewRef.current;
    if (before) {
      panRef.current = before.pan;
      scaleRef.current = before.scale;
      fullRedraw();
      setZoomPercent(Math.round(before.scale * 100));
    }
    if (action === "undo") handleUndo();
    else if (action === "redo") handleRedo();
    else if (action === "swap") {
      if (toolRef.current === "eraser") handleSelectTool(toolBeforeEraserRef.current || "pen");
      else {
        toolBeforeEraserRef.current = toolRef.current === "highlighter" ? "highlighter" : "pen";
        handleSelectTool("eraser");
      }
    }
    flashNotice(GESTURE_WORDS[action] || "", 900);
  }

  // Keyboard shortcuts and system copy / cut / paste. The handlers read the
  // latest versions of these functions through a ref, so the listeners are
  // attached only once.
  useEffect(() => {
    shortcutHandlersRef.current = {
      copySelection, cutSelection, deleteSelection, duplicateSelection, selectAll,
      handleUndo, handleRedo, pasteFromSources,
      clearSelection: () => setSelection(emptySelection()),
      runAction,
      pickColourKey,
      startHoldMove,
      endHoldMove,
    };
    tapGesture.setHandler(handleTap);
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
      // the Settings panel is open over the board: its keys aren't for the board
      if (document.querySelector("[data-settings-panel]")) return;
      const h = shortcutHandlersRef.current;
      if (!h) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = (e.key || "").toLowerCase();
      if (!activeRef.current) {
        // On a hidden tab the shortcuts do nothing. "Select all" is still
        // stopped from reaching the browser, though: left alone it selects
        // every label on the page, and the next drag on the board would
        // then drag that selection about instead of drawing.
        if (mod && key === "a") e.preventDefault();
        return;
      }
      // The changeable shortcuts (Settings ▸ Shortcuts). Ones without Ctrl/⌘
      // can be switched off there, and never fire with Ctrl/⌘/Alt held.
      const combo = keyFromEvent(e);
      const keys = keysWith(getSetting("shortcuts"));
      const action = actionForKey(combo, keys);
      const plainKey = !!combo && !combo.startsWith("mod+") && !combo.includes("alt+");
      const allowed = action && (!plainKey || getSetting("singleKeys"));
      if (allowed && action === "holdMove") {
        e.preventDefault();
        if (!e.repeat) startHoldMoveRef();
        return;
      }
      if (allowed && action !== "undo" && action !== "redo" && action !== "zoomIn" && action !== "zoomOut" && e.repeat) {
        e.preventDefault();
        return;
      }
      if (allowed && h.runAction(action)) {
        e.preventDefault();
        return;
      }
      // Ctrl/⌘+Y: redo as well (as everywhere else)
      if (mod && key === "y" && !e.shiftKey) {
        e.preventDefault();
        h.handleRedo();
        return;
      }
      if (mod && key === "a") {
        e.preventDefault();
        h.selectAll();
        return;
      }
      // 1–7: pen colours
      if (!mod && !e.altKey && /^[1-7]$/.test(key) && getSetting("singleKeys")) {
        h.pickColourKey(Number(key));
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
    function startHoldMoveRef() {
      const h = shortcutHandlersRef.current;
      if (h) h.startHoldMove();
    }
    // letting go of the "hold to move" key (or leaving the window) ends it
    function onKeyUp(e) {
      const h = shortcutHandlersRef.current;
      if (!h) return;
      const combo = keyFromEvent({ key: e.key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false });
      const keys = keysWith(getSetting("shortcuts"));
      const held = keys.holdMove ? keys.holdMove.split("+").pop() : null;
      if (combo && held && combo === held) h.endHoldMove();
    }
    function onBlur() {
      const h = shortcutHandlersRef.current;
      if (h) h.endHoldMove();
    }
    // Marks the system clipboard synchronously during a real copy / cut, so
    // a later paste knows our selection is the newest thing copied.
    function onCopyOrCut(e) {
      if (!activeRef.current || isTypingTarget(e.target) || editingTextRef.current || !hasSelection()) return;
      if (e.clipboardData) {
        e.clipboardData.setData("text/plain", CLIPBOARD_MARKER);
        e.preventDefault();
        clipboardMarkedRef.current = true;
      }
    }
    function onPaste(e) {
      if (!activeRef.current || isTypingTarget(e.target) || editingTextRef.current) return;
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
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("copy", onCopyOrCut);
    document.addEventListener("cut", onCopyOrCut);
    document.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("copy", onCopyOrCut);
      document.removeEventListener("cut", onCopyOrCut);
      document.removeEventListener("paste", onPaste);
    };
  }, []);

  // The pointer over the board (Settings ▸ Board ▸ Pointer).
  let boardCursor = "default";
  if (panToolActive) boardCursor = "grab";
  else if (pointerStyle === "size" && isInkTool(tool) && !compassActive) boardCursor = "none";
  else if (pointerStyle === "icon") boardCursor = iconCursor(tool, inkOn(color, isDarkBackground(boardBackground))) || "default";
  else if (tool === "text") boardCursor = "text";

  const showReferencePane = canUseReferencePane && !!referenceDoc;
  // phones: the document full screen, switched with the board
  const phoneReference = !canUseReferencePane && !!referenceDoc;
  const selectedClip =
    selectionCount(selection) === 1 && selection.images.length === 1
      ? images.find((img) => img.id === selection.images[0] && img.source && img.source.kind === "clip") || null
      : null;
  const referencePane = referenceDoc ? (
    <ReferencePane
      key={referenceDoc.v === 2 ? "doc" : "legacy"}
      doc={referenceDoc}
      marks={referenceMarks}
      canEditPages={isOwner && !student}
      compact={!canUseReferencePane}
      me={{ id: myRefId, name: user ? nameFor(displayNameFor(user), user.email) : "Someone" }}
      bus={refBus}
      onMarks={handleRefMarks}
      onPagesChange={handleRefPagesChange}
      onAddPages={isOwner && !student ? handleRefAddPages : null}
      onClip={student ? null : handleRefClip}
      onLaser={(payload) => sendRef("ref-laser", { ...payload, by: myRefId })}
      onView={(payload) => sendRef("ref-view", { ...payload, by: myRefId, name: user ? nameFor(displayNameFor(user), user.email) : "Someone" })}
      registerHandle={(api) => {
        refPaneHandleRef.current = api;
      }}
    />
  ) : null;
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
    (demo
      ? liveClassCode
        ? "Demo class · pretend students"
        : "Demo board · sign in to keep it"
      : liveClassCode
        ? "Live class running"
        : "Saves automatically");

  return (
    <div className={student ? "wb-root wb-root-embedded" : "wb-root"}>
      <Toolbar
        student={!!student}
        onOpenSettings={student ? undefined : () => setSettingsOpen("board")}
        people={peopleOn ? people : null}
        onFindPerson={handleFindPerson}
        boardName={boardName}
        statusText={statusText}
        saveState={saveState}
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
        getSelectedGraphId={getSelectedGraphId}
        background={boardBackground}
        onSetBackground={handleSetBackground}
        onInsertImage={student ? undefined : handleInsertImageClick}
        eraserMode={eraserMode}
        onSetEraserMode={setEraserMode}
        scribbleErase={scribbleErase}
        onSetScribbleErase={setScribbleErase}
        onPaste={handlePasteButton}
        onSelectAll={selectAll}
        hasSelection={selectionCount(selection) > 0}
        graphSelected={selectionCount(selection) === 1 && (selection.graphs || []).length === 1}
        onOpenGraph={handleOpenGraph}
        onEditGraph={handleEditSelectedGraph}
        calculatorActive={calculatorActive}
        onToggleCalculator={handleToggleCalculator}
        canInsertReference={isOwner && !student}
        hasReferenceDoc={!!referenceDoc}
        onReferenceToolClick={handleReferenceToolClick}
        onOpenSimModal={student ? undefined : handleOpenSimModal}
        onOpenShapeModal={handleOpenShapeModal}
        onCopyLink={handleCopyLink}
        onStartLiveClass={handleStartLiveClass}
        onEndSession={handleEndSession}
        liveClassCode={liveClassCode}
        classRoster={classRoster}
        onResetClassStatus={handleResetClassStatus}
        compact={compact}
        onViewStudent={handleViewStudent}
        onEndLiveClass={handleEndLiveClass}
        classTools={
          liveClassCode && isOwner
            ? {
                pensDown: classControl.pensDown,
                questionSent: !!sentQuestion,
                onOverview: handleOpenOverview,
                onTogglePensDown: handleTogglePensDown,
                onSendBoard: () => setClassDialog("send"),
                onSaveBoards: handleOpenSaveBoards,
              }
            : null
        }
        penSeen={penSeen}
        pencilOnly={pencilOnly}
        onSetPencilOnly={setPencilOnly}
        zoomPercent={zoomPercent}
        onResetView={handleResetView}
      />
      {phoneReference && (
        <div className={refStyles.switchBar}>
          <div className={refStyles.switch} role="group" aria-label="Show the board or the document">
            <button type="button" className={phoneView !== "pdf" ? refStyles.switchOn : ""} aria-pressed={phoneView !== "pdf"} onClick={() => setPhoneView("board")}>
              <LayoutDashboard size={16} strokeWidth={2} />
              Board
            </button>
            <button type="button" className={phoneView === "pdf" ? refStyles.switchOn : ""} aria-pressed={phoneView === "pdf"} onClick={() => setPhoneView("pdf")}>
              <FileText size={16} strokeWidth={2} />
              Document
            </button>
          </div>
        </div>
      )}
      <div
        ref={workAreaRef}
        style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: refStacked ? "column" : "row" }}
      >
      {phoneReference && (
        <div
          // the whole screen, over the board and its tools (which stay as
          // they are underneath)
          style={{
            position: "fixed", inset: 0, zIndex: 200, flexDirection: "column", background: "#ECEAE4",
            display: phoneView === "pdf" ? "flex" : "none",
          }}
        >
          <div
            style={{
              flexShrink: 0, display: "flex", alignItems: "center", gap: 8, padding: "6px 8px",
              backgroundColor: "var(--paper)", borderBottom: "2px solid var(--ink-line)", fontSize: 13, color: "var(--ink)",
            }}
          >
            <div className={refStyles.switch} role="group" aria-label="Show the board or the document">
              <button type="button" aria-pressed={false} onClick={() => setPhoneView("board")}>
                <LayoutDashboard size={16} strokeWidth={2} />
                Board
              </button>
              <button type="button" className={refStyles.switchOn} aria-pressed={true} onClick={() => setPhoneView("pdf")}>
                <FileText size={16} strokeWidth={2} />
                Document
              </button>
            </div>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 700, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {referenceDoc.fileName}
            </span>
            {isOwner && (
              <PalmSafeButton
                onPress={handleRemoveReferenceDoc}
                style={{
                  height: 32, flexShrink: 0, padding: "0 10px", border: "1.5px solid var(--danger)", borderRadius: 10,
                  background: "var(--surface)", color: "var(--danger)", fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}
              >
                Remove
              </PalmSafeButton>
            )}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>{referencePane}</div>
        </div>
      )}
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
          <div style={{ flex: 1, minHeight: 0 }}>{referencePane}</div>
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
        {/* A student's board: pictures in the question the teacher sent. */}
        {student &&
          ((teacherLayer.question && teacherLayer.question.images) || []).map((img) => (
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
              onLoad={drawTeacherOverlay}
              className={chrome.boardImage}
            />
          ))}
        {/* Every student's board at once. Put away while one board is
            open (each board has a single live connection: see ClassOverview). */}
        {classOverview && liveClassCode && !viewingStudent && (
          <ClassOverview
            code={liveClassCode}
            students={classRoster}
            question={sentQuestion}
            pensDown={classControl.pensDown}
            onOpen={handleViewStudent}
            onBack={() => setClassOverview(false)}
          />
        )}
        {viewingStudent && liveClassCode && (
          <TeacherStudentBoardView
            // a fresh view for each student, so nothing carries over
            key={viewingStudent.studentId}
            code={liveClassCode}
            // as they are right now (hand up or down), if they're still here
            student={classRoster.find((st) => st.studentId === viewingStudent.studentId) || { ...viewingStudent, hand: false, left: true }}
            question={sentQuestion}
            spotlight={classControl.spotlight && classControl.spotlight.studentId === viewingStudent.studentId ? classControl.spotlight : null}
            onSpotlight={isOwner ? (showName) => handleSpotlight(viewingStudent, showName) : undefined}
            onStopSpotlight={handleStopSpotlight}
            onLowerHand={handleLowerHand}
            onBack={() => handleViewStudent(null)}
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
            cursor: boardCursor,
          }}
        />
        {/* A student's board: what the teacher has put on it (the class
            question, their own writing). Above the student's ink, so the
            student's eraser can't touch it; it never takes a tap. */}
        {student && (
          <canvas
            ref={teacherCanvasRef}
            aria-hidden="true"
            data-teacher-layer="true"
            style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
          />
        )}
        {/* A student's board: the teacher's pinned comments. The numbered
            pins sit on the board (moved by repositionCommentPins as it pans
            and zooms); the words are in the list, opened from the button. */}
        {student &&
          teacherComments.map((c, i) => (
            <span
              key={c.id}
              ref={(el) => {
                if (el) commentPinNodesRef.current[c.id] = el;
                else delete commentPinNodesRef.current[c.id];
              }}
              aria-hidden="true"
              data-comment-pin={i + 1}
              className={`${cls.pin} ${pulsingComment === c.id ? cls.pinPulse : ""}`}
            >
              {i + 1}
            </span>
          ))}
        {student && <StudentComments comments={teacherComments} onShow={handleShowComment} />}
        {peopleOn && <div ref={penTagsElRef} aria-hidden="true" className={chrome.penTags} />}
        {peopleOn && (
          <div ref={outlineElRef} aria-hidden="true" className={chrome.personOutline} data-person-outline="true" data-show="false">
            <span className={chrome.personOutlineLabel} />
          </div>
        )}
        {/* the brush-size ring that follows the pointer (boardCursor.js) */}
        <div ref={cursorRingRef} aria-hidden="true" className={chrome.cursorRing} style={{ display: "none" }} />
        <div ref={marqueeElRef} aria-hidden="true" className={chrome.marquee} />
        <div ref={selectionBoxElRef} aria-hidden="true" className={chrome.selectionBox}>
          <span className={chrome.selectionHandle} />
        </div>
        <div ref={selectionBarElRef} role="toolbar" aria-label="Selected items" className={chrome.selectionBar}>
          {selectedClip && (
            <>
              <PalmSafeButton className={chrome.selBtn} onPress={() => handleShowClipInPdf(selectedClip)}>
                <LocateFixed size={17} strokeWidth={1.9} />
                Show in document
              </PalmSafeButton>
              <PalmSafeButton className={chrome.selBtn} onPress={() => keepClipInView(selectedClip)}>
                <PictureInPicture2 size={17} strokeWidth={1.9} />
                Keep in view
              </PalmSafeButton>
              <span className={chrome.selDivider} />
            </>
          )}
          {selectionCount(selection) === 1 && (selection.graphs || []).length === 1 && (
            <>
              <PalmSafeButton className={chrome.selBtn} onPress={handleEditSelectedGraph}>
                <PenLine size={17} strokeWidth={1.9} />
                Edit
              </PalmSafeButton>
              <span className={chrome.selDivider} />
            </>
          )}
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
          <TextEditor
            key={editingText.id}
            handleRef={textEditorRef}
            info={editingText}
            raw={editingText.raw || ""}
            dark={isDarkBackground(boardBackground)}
            canUpload={!demo && !student && !!user}
            onUpload={uploadTextFont}
            onDone={finishTextEdit}
          />
        )}
        {rulerActive && (
          <RulerOverlay
            angle={rulerAngle}
            setAngle={setRulerAngle}
            position={rulerPos}
            setPosition={setRulerPos}
            length={rulerLen}
            scale={zoomPercent / 100}
            units={rulerUnits}
            onUnits={(u) => setSetting("rulerUnits", u)}
          />
        )}
        {rulerActive && (
          <div
            ref={rulerReadoutRef}
            aria-hidden="true"
            data-ruler-readout="true"
            className={chrome.rulerReadout}
            style={{ display: "none" }}
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
        <GraphSliderPanels store={graphStore} panelRefs={graphPanelRefs} onParam={handleGraphParam} onPlace={repositionGraphBits} />
        <GraphReadoutBar
          store={graphStore}
          barRef={graphBarRef}
          onPin={handleGraphPin}
          onTangent={handleGraphTangent}
          onRemovePin={handleGraphUnpin}
          onClose={handleGraphCloseReadout}
          onPlace={repositionGraphBits}
        />
        {simModalOpen && <SimEmbedModal onAdd={handleAddSimEmbed} onClose={handleCloseSimModal} />}
        {settingsOpen && (
          <SettingsPanel
            user={demo ? null : user}
            signOut={signOut}
            initialTab={settingsOpen === "shortcuts" ? "shortcuts" : "board"}
            onClose={() => setSettingsOpen(false)}
          />
        )}
        {classDialog === "send" && liveClassCode && (
          <SendBoardDialog
            studentCount={classRoster.length}
            sent={sentQuestion}
            sending={sendingQuestion}
            onSend={handleSendQuestion}
            onTakeBack={handleTakeBackQuestion}
            onClose={() => setClassDialog(null)}
          />
        )}
        {classDialog === "save" && liveClassCode && (
          <SaveBoardsDialog
            code={liveClassCode}
            students={classRoster}
            question={sentQuestion}
            boardName={boardName}
            onClose={() => setClassDialog(null)}
          />
        )}
        {shapeModal && (
          <ShapeToolModal
            zoomScale={shapeModal.zoom}
            maxSize={shapeModal.maxSize}
            penColor={color}
            penWidth={strokeWidth}
            onAdd={handleAddShape}
            onClose={handleCloseShapeModal}
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
        {clipWindows.length > 0 && (
          <ClipWindows
            windows={clipWindows}
            images={images}
            onChange={(id, next) => setClipWindows((prev) => prev.map((w) => (w.id === id ? { ...w, ...next } : w)))}
            onClose={(id) => setClipWindows((prev) => prev.filter((w) => w.id !== id))}
            onShowInPdf={referenceDoc ? handleShowClipInPdf : null}
          />
        )}
        {refPicker && typeof document !== "undefined" &&
          createPortal(
            <RefPagePicker
              url={refPicker.url}
              fileName={refPicker.fileName}
              max={refPicker.max}
              adding={refPicker.adding}
              onCancel={closeRefPicker}
              onDone={handleRefPagesPicked}
            />,
            document.body
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
        {(showPencilOnlyNotice || showPencilTip || boardNotice || scratchNotice || catchingUp || unsaved > 0 || restoredNotice || (saveProblem && !saveProblemTold)) && (
          <div
            style={{
              position: "fixed",
              top: 12,
              left: "50%",
              transform: "translateX(-50%)",
              // above a student's board when the teacher has one open, so
              // "… has a hand up" is seen there too
              zIndex: 55,
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
            {restoredNotice && (
              <div role="status" className={chrome.boardNotice}>
                Your work from earlier is back.
              </div>
            )}
            {saveProblem && !saveProblemTold && (
              <div role="status" className={`${chrome.boardNotice} ${chrome.syncNotice}`}>
                <span className={`${chrome.syncDot} ${chrome.syncDotWarn}`} aria-hidden="true" />
                This device can&apos;t keep a copy of your board. A refresh could lose your work.
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