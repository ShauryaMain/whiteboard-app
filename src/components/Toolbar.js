"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  MousePointer2, Hand, Pencil, Highlighter, Eraser, Type, Ruler, DraftingCompass, Grid3x3,
  Calculator, SquarePlus, FileText, FileX, Atom, Undo2, Redo2, Trash2, House, Link2, Users,
  Check, ChevronDown, Maximize, RotateCw, NotebookText, ImagePlus, ClipboardPaste, BoxSelect, Shapes,
  LayoutGrid, Pause, Play, Send, Download, Settings, RectangleHorizontal, Share2, BookOpen, LayoutDashboard, Search,
} from "lucide-react";
import PalmSafeButton from "./PalmSafeButton";
import { BOARD_BACKGROUNDS, PAGE_COLORS, backgroundCss, parseBackground, withPaper, withPageColor, isDarkBackground } from "@/lib/boardBackground";
import { inkOn } from "@/lib/inkColor";
import { stashDemoBoard } from "@/lib/demoCarry";
import { askDemoGuide, DEMO_LEAVE_EVENT, DEMO_SIGNIN_EVENT } from "@/lib/demoEvents";
import { useSetting } from "@/lib/settings";
import { keysWith, keyLabel, isMacLike } from "@/lib/shortcuts";
import { PaperChoices } from "./NotebookBits";
import s from "./StudioChrome.module.css";

const INK_COLORS = [
  ["Black", "#1a1a1a"],
  ["Red", "#E53935"],
  ["Orange", "#FB8C00"],
  ["Green", "#43A047"],
  ["Blue", "#1E88E5"],
  ["Purple", "#8E24AA"],
  ["Teal", "#00897B"],
];

// Plain-English explanation shown for whatever is active, so every tool
// explains itself without a manual.
const TOOL_HINTS = {
  select: ["Select", "Tap anything, or drag a box around several things. Then drag to move, or use Copy, Cut, Duplicate or Delete."],
  move: ["Move", "Drag to move around the board. Pinch with two fingers to zoom."],
  pen: ["Pen", "Draw freehand. Scribble back and forth over a mistake to rub it out."],
  highlighter: ["Highlight", "See-through ink for marking things up."],
  eraser: ["Eraser", "Precise rubs out only where you drag."],
  text: ["Text", "Tap the board where you want to type."],
  tape: ["Tape", "Drag over an answer to hide it. Tap tape to peek under it, tap again to cover it. To take tape off, use Select and Delete, or the whole-stroke eraser."],
};
const RULER_HINT = ["Ruler", "Draw along either edge for a straight line. Drag it to move; turn it with its round handle, two fingers or the mouse wheel."];
const COMPASS_HINT = ["Compass", "Drag the pin to set the centre and the pencil end to set the size, then draw to trace the circle."];
const STROKE_ERASER_HINT = ["Eraser", "Whole stroke removes any line you touch, in one go."];
const PEN_NO_SCRIBBLE_HINT = ["Pen", "Draw freehand. For straight lines, turn on the Ruler in Maths."];
const SELECTED_HINT = ["Selected", "Drag to move it, or use the bar next to it. Tap empty space to deselect."];
const GRAPH_SELECTED_HINT = ["Graph", "Drag to move it, drag the corner dot to resize it, double-tap to change it, or tap a curve to read off a point."];

const ICON = { size: 22, strokeWidth: 1.8 };
const SMALL_ICON = { size: 18, strokeWidth: 1.8 };

// Leaving the demo board needs a full page load (not an in-app hop), so
// the real app starts on its real backend. The demo's guide may first
// offer to keep the board (see DemoGuide.js).
function leaveDemo(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (askDemoGuide(DEMO_LEAVE_EVENT)) return;
  window.location.assign("/");
}

// "Sign in free to keep your work": keep a copy of the demo board on this
// device first, so it can be saved to their account once they're signed
// in (see src/lib/demoCarry.js).
let leavingDemo = false;
async function keepDemoAndSignIn(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (leavingDemo) return;
  leavingDemo = true;
  try {
    // A text box still being typed in is only added to the board when the
    // keyboard leaves it (on an iPad that hasn't happened yet when this
    // button is tapped). Finish it now, then give the board a moment to
    // record it before the copy is taken.
    const active = document.activeElement;
    if (active && active !== document.body && typeof active.blur === "function") active.blur();
    await new Promise((resolve) => setTimeout(resolve, 80));
    // The demo's guide signs them in over the board (DemoGuide.js).
    if (askDemoGuide(DEMO_SIGNIN_EVENT)) {
      leavingDemo = false;
      return;
    }
    stashDemoBoard();
  } catch (err) {
    console.warn("Couldn't keep the demo board for sign-in:", err);
  }
  leaveDemo();
}

export default function Toolbar(props) {
  const {
    boardName, statusText, saveState = "idle", isOwner, demo, student,
    tool, panToolActive, onSelectTool, onSelectMove,
    color, setColor, strokeWidth, setStrokeWidth,
    onUndo, onRedo, onClear, canUndo, canRedo,
    rulerActive, onToggleRuler, compassActive, onToggleCompass,
    getSelectedGraphId, onOpenGraph, onEditGraph, graphSelected,
    background, onSetBackground,
    onInsertImage, onPaste, onSelectAll, hasSelection,
    eraserMode, onSetEraserMode, scribbleErase, onSetScribbleErase,
    calculatorActive, onToggleCalculator,
    canInsertReference, hasReferenceDoc, onReferenceToolClick, onOpenSimModal, onOpenShapeModal,
    onCopyLink, onStartLiveClass, onEndSession,
    liveClassCode, classRoster, onViewStudent, onEndLiveClass, onResetClassStatus, classTools, compact,
    onOpenSettings,
    people,
    onFindPerson,
    penSeen, pencilOnly, onSetPencilOnly,
    zoomPercent, onResetView,
    notebookPage,
    onSendBoardToStudents,
    recentMenu,
  } = props;

  // menu: null | { id: "maths" | "insert" | "page" | "roster", left, top, hasGrid }
  const [menu, setMenu] = useState(null);
  const menuRef = useRef(null);
  // On a narrow screen the row of tools scrolls sideways; its right edge
  // fades while there are more tools to scroll to.
  const toolRowRef = useRef(null);
  const [moreTools, setMoreTools] = useState(false);
  useEffect(() => {
    const row = toolRowRef.current;
    if (!row) return undefined;
    const check = () => setMoreTools(row.scrollLeft + row.clientWidth < row.scrollWidth - 4);
    const frame = requestAnimationFrame(check);
    row.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      cancelAnimationFrame(frame);
      row.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);

  useEffect(() => {
    if (!menu) return undefined;
    function handleOutside(e) {
      if (e.target.closest && e.target.closest("[data-menu-trigger]")) return;
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setMenu(null);
    }
    function handleKey(e) {
      if (e.key === "Escape") setMenu(null);
    }
    // (turning a tablet round: the menu's room has changed, so it closes)
    function handleResize() {
      setMenu(null);
    }
    document.addEventListener("pointerdown", handleOutside);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("orientationchange", handleResize);
    return () => {
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, [menu]);

  // the shortcut shown on a tool's hover note
  const shortcutChanges = useSetting("shortcuts");
  const singleKeys = useSetting("singleKeys");
  const mac = useSyncExternalStore(noSubscribe, isMacLike, () => false);
  const keyHint = (action) => {
    const key = keysWith(shortcutChanges)[action];
    if (!key || (!singleKeys && !key.startsWith("mod+"))) return "";
    return keyLabel(key, mac);
  };

  // how many faces fit in the top bar (more go in a list)
  const narrowBar = useSyncExternalStore(subscribeNarrowBar, isNarrowBar, () => false);
  const faceRoom = narrowBar ? 2 : 4;
  const peopleCount = people ? people.length : 0;
  const shownFaces = peopleCount <= faceRoom ? peopleCount : faceRoom - 1;

  function toggleMenu(id, e, width = 320) {
    if (menu && menu.id === id) {
      setMenu(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const top = rect.bottom + 6;
    // A long menu (a notebook's Page menu, a big class) scrolls inside the
    // room below its button, rather than running off the bottom of the
    // screen. (The window's own height: older iPads don't know "dvh".)
    const viewH = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    const maxHeight = Math.max(160, Math.round(viewH - top - 12));
    setMenu({ id, left, top, maxHeight, graphId: getSelectedGraphId ? getSelectedGraphId() : null });
  }

  function runAndClose(fn) {
    return () => {
      setMenu(null);
      fn?.();
    };
  }

  // Live class: how many students have a hand up / have said they're done.
  const classHands = (classRoster || []).filter((st) => st.hand).length;
  const classDone = (classRoster || []).filter((st) => st.done).length;

  const activeTool = panToolActive ? "move" : tool;
  const pageDark = isDarkBackground(background);
  // the one-line explanation beside the tools (Settings can hide it)
  const showHints = useSetting("showHints");
  const isInk = activeTool === "pen" || activeTool === "highlighter";

  let hint = TOOL_HINTS[activeTool] || TOOL_HINTS.pen;
  if (activeTool === "eraser" && eraserMode === "stroke") hint = STROKE_ERASER_HINT;
  if (activeTool === "pen" && scribbleErase === false) hint = PEN_NO_SCRIBBLE_HINT;
  if (activeTool === "select" && graphSelected) hint = GRAPH_SELECTED_HINT;
  else if (activeTool === "select" && hasSelection) hint = SELECTED_HINT;
  else if (compassActive && activeTool !== "move") hint = COMPASS_HINT;
  else if (rulerActive && activeTool !== "move") hint = RULER_HINT;

  const menuPortal =
    menu && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            className={s.menu}
            // (any menu taller than the room below its button scrolls)
            style={{ left: menu.left, top: menu.top, width: menu.id === "roster" ? 300 : 320, maxHeight: menu.maxHeight, overflowY: "auto" }}
            data-menu={menu.id}
            role="menu"
          >
            {menu.id === "people" &&
              (people || []).map((p) => (
                <MenuItem
                  key={p.key}
                  icon={
                    <span className={s.menuFace} style={{ background: p.color }}>
                      {p.initial}
                    </span>
                  }
                  title={p.name}
                  desc="Go to where they are on the board"
                  onPress={runAndClose(() => onFindPerson && onFindPerson(p.key))}
                />
              ))}
            {menu.id === "recent" && recentMenu && (
              <>
                <div className={s.menuHeading}>Recent</div>
                {recentMenu.items.length === 0 && <div className={s.rosterEmpty}>Notebooks and boards you open show here.</div>}
                {recentMenu.items.map((r) => (
                  <MenuItem
                    key={r.id}
                    icon={r.kind === "notebook" ? <BookOpen {...SMALL_ICON} /> : <LayoutDashboard {...SMALL_ICON} />}
                    title={r.name || (r.kind === "notebook" ? "Untitled notebook" : "Untitled board")}
                    onPress={runAndClose(() => recentMenu.onGo(r.id))}
                  />
                ))}
                <MenuItem
                  icon={<Search {...SMALL_ICON} />}
                  title="Go to…"
                  desc={`Find any notebook or board (${recentMenu.keyLabel}).`}
                  onPress={runAndClose(recentMenu.onSwitcher)}
                />
              </>
            )}
            {menu.id === "maths" && (
              <>
                <MenuItem
                  icon={<Ruler {...SMALL_ICON} />}
                  title="Ruler"
                  on={rulerActive}
                  desc="Draw perfectly straight lines and measure lengths."
                  onPress={runAndClose(onToggleRuler)}
                />
                <MenuItem
                  icon={<DraftingCompass {...SMALL_ICON} />}
                  title="Compass"
                  on={compassActive}
                  desc="Draw circles and arcs around a fixed centre."
                  onPress={runAndClose(onToggleCompass)}
                />
                <MenuItem
                  icon={<Grid3x3 {...SMALL_ICON} />}
                  title="Graph"
                  desc="Add axes, graph paper, a number line or a chart. A board can have several."
                  onPress={runAndClose(onOpenGraph)}
                />
                {menu.graphId && (
                  <MenuItem
                    icon={<Grid3x3 {...SMALL_ICON} />}
                    title="Edit graph"
                    desc="Change the selected graph (or double-tap it)."
                    onPress={runAndClose(onEditGraph)}
                  />
                )}
                <MenuItem
                  icon={<Calculator {...SMALL_ICON} />}
                  title="Calculator"
                  on={calculatorActive}
                  desc="A scientific calculator you can drag anywhere."
                  onPress={runAndClose(onToggleCalculator)}
                />
              </>
            )}
            {menu.id === "insert" && (
              <>
                {canInsertReference && (
                  <MenuItem
                    insert={!hasReferenceDoc}
                    danger={hasReferenceDoc}
                    icon={hasReferenceDoc ? <FileX {...SMALL_ICON} /> : <FileText {...SMALL_ICON} />}
                    title={hasReferenceDoc ? "Remove reference document" : "Reference document"}
                    desc={
                      hasReferenceDoc
                        ? "Closes the PDF or image beside the board for everyone."
                        : "Open a PDF or image beside the board to read and mark up."
                    }
                    onPress={runAndClose(onReferenceToolClick)}
                  />
                )}
                {onInsertImage && (
                  <MenuItem
                    insert
                    icon={<ImagePlus {...SMALL_ICON} />}
                    title="Image"
                    desc="Add a picture or diagram from your files. You can also paste one or drag it in."
                    onPress={runAndClose(onInsertImage)}
                  />
                )}
                {onOpenShapeModal && (
                  <MenuItem
                    insert
                    icon={<Shapes {...SMALL_ICON} />}
                    title="Shape"
                    tour="insert-shape"
                    desc="Polygons, circles and 3D solids, with angles and lengths labelled."
                    onPress={runAndClose(onOpenShapeModal)}
                  />
                )}
                {onOpenSimModal && (
                  <MenuItem
                    insert
                    icon={<Atom {...SMALL_ICON} />}
                    title="Simulation"
                    desc="Embed an interactive PhET simulation students can use live."
                    onPress={runAndClose(onOpenSimModal)}
                  />
                )}
              </>
            )}
            {menu.id === "page" && notebookPage && (
              <>
                <div className={s.menuHeading}>
                  Page {notebookPage.index + 1} of {notebookPage.count}
                </div>
                {notebookPage.canEdit && !notebookPage.isImported && (
                  <PaperChoices
                    compact
                    value={notebookPage.paper}
                    color={parseBackground(background).color}
                    onPick={(paper) => {
                      setMenu(null);
                      notebookPage.onSetPaper(paper);
                    }}
                  />
                )}
                <div className={s.nbMenuActions}>
                  {notebookPage.canEdit && (
                    <PalmSafeButton className={s.nbMenuBtn} onPress={runAndClose(notebookPage.onAddPage)} disabled={notebookPage.busy}>
                      Add a page after this one
                    </PalmSafeButton>
                  )}
                  <PalmSafeButton className={s.nbMenuBtn} onPress={runAndClose(notebookPage.onOpenPages)}>
                    All pages…
                  </PalmSafeButton>
                  {notebookPage.canEdit && (
                    <PalmSafeButton className={s.nbMenuBtn} onPress={runAndClose(notebookPage.onImport)} disabled={notebookPage.busy}>
                      Add pages from a PDF…
                    </PalmSafeButton>
                  )}
                  <PalmSafeButton className={s.nbMenuBtn} onPress={runAndClose(notebookPage.onExport)}>
                    Export as a PDF…
                  </PalmSafeButton>
                  {notebookPage.onSendToStudents && (
                    <PalmSafeButton className={s.nbMenuBtn} onPress={runAndClose(notebookPage.onSendToStudents)} data-menu-send-students="true">
                      Send pages to students…
                    </PalmSafeButton>
                  )}
                </div>
                <div className={s.menuHeading}>Study this page</div>
                <div className={s.nbMenuActions}>
                  <PalmSafeButton className={s.nbMenuBtn} onPress={runAndClose(notebookPage.onQuiz)} data-menu-quiz="true">
                    Quiz me on this page
                  </PalmSafeButton>
                  <PalmSafeButton className={s.nbMenuBtn} onPress={runAndClose(() => notebookPage.onCoverAll(true))}>
                    Cover all the tape
                  </PalmSafeButton>
                  <PalmSafeButton className={s.nbMenuBtn} onPress={runAndClose(() => notebookPage.onCoverAll(false))}>
                    Show what&apos;s under the tape
                  </PalmSafeButton>
                </div>
              </>
            )}
            {menu.id === "page" && (
              <>
                {!notebookPage && <div className={s.menuHeading}>Page background</div>}
                {!notebookPage && (
                <div className={s.pageGrid}>
                  {BOARD_BACKGROUNDS.map((bg) => {
                    const on = parseBackground(background).paper === bg.id;
                    return (
                      <PalmSafeButton
                        key={bg.id}
                        role="menuitemradio"
                        aria-checked={on}
                        aria-label={`${bg.label} — ${bg.desc}`}
                        className={`${s.pageTile} ${on ? s.pageTileOn : ""}`}
                        onPress={runAndClose(() => onSetBackground?.(withPaper(background, bg.id)))}
                      >
                        <span className={s.pagePreview} style={backgroundCss(withPaper(background, bg.id), 0.75, { x: 6, y: 6 })} />
                        <span className={s.pageLabel}>
                          {bg.label}
                          {on && <Check size={13} strokeWidth={2.6} />}
                        </span>
                      </PalmSafeButton>
                    );
                  })}
                </div>
                )}
                <div className={s.menuHeading}>{notebookPage ? "Colour of every page" : "Page colour"}</div>
                <div className={s.pageColors} role="radiogroup" aria-label="Page colour">
                  {PAGE_COLORS.map(([name, hex]) => {
                    const on = parseBackground(background).color === hex;
                    return (
                      <PalmSafeButton
                        key={hex}
                        role="radio"
                        aria-checked={on}
                        aria-label={name}
                        title={name}
                        data-page-color={hex}
                        className={`${s.pageColor} ${on ? s.pageColorOn : ""}`}
                        style={{ background: hex }}
                        onPress={() => onSetBackground?.(withPageColor(background, hex))}
                      />
                    );
                  })}
                  <label className={`${s.pageColor} ${s.pageColorCustom}`} title="Any colour" aria-label="Pick any page colour">
                    <ColorPick value={parseBackground(background).color} onPick={(hex) => onSetBackground?.(withPageColor(background, hex))} />
                  </label>
                </div>
                {pageDark && <div className={s.menuFootnote}>On a dark page, black writing shows up white.</div>}
                <div className={s.menuFootnote}>
                  {notebookPage
                    ? "Changes the colour of every page in this notebook. Your writing stays put."
                    : student
                    ? "Changes the page on your board. Your drawings stay put."
                    : "Changes the page for everyone on this board. Your drawings stay put."}
                </div>
                {!notebookPage && onSendBoardToStudents && (
                  <>
                    <div className={s.menuHeading}>Students</div>
                    <div className={s.nbMenuActions}>
                      <PalmSafeButton className={s.nbMenuBtn} onPress={runAndClose(onSendBoardToStudents)} data-menu-send-board="true">
                        {hasSelection ? "Send what's selected to students…" : "Send this board to students…"}
                      </PalmSafeButton>
                    </div>
                  </>
                )}
              </>
            )}
            {menu.id === "roster" && (
              <>
                {/* What the teacher can do with the whole class at once. */}
                {classTools && (
                  <div className={s.classTools} role="group" aria-label="Class tools">
                    <PalmSafeButton
                      className={s.classTool}
                      data-tour="class-all-boards"
                      title="See every student's board at once"
                      onPress={runAndClose(classTools.onOverview)}
                    >
                      <LayoutGrid size={18} strokeWidth={1.9} />
                      <span>Class overview</span>
                    </PalmSafeButton>
                    <PalmSafeButton
                      className={`${s.classTool} ${classTools.pensDown ? s.classToolOn : ""}`}
                      aria-pressed={classTools.pensDown}
                      title={
                        classTools.pensDown
                          ? "Students' boards are paused. Press to let them write again."
                          : "Pause every student's board and bring them to yours"
                      }
                      onPress={runAndClose(classTools.onTogglePensDown)}
                    >
                      {classTools.pensDown ? <Play size={18} strokeWidth={1.9} /> : <Pause size={18} strokeWidth={1.9} />}
                      <span>{classTools.pensDown ? "Pens up" : "Pens down"}</span>
                    </PalmSafeButton>
                    <PalmSafeButton
                      className={s.classTool}
                      title="Copy what's on your board onto every student's board"
                      onPress={runAndClose(classTools.onSendBoard)}
                    >
                      <Send size={18} strokeWidth={1.9} />
                      <span>Send my board</span>
                      {classTools.questionSent && <span className={s.classToolDot} aria-label="sent" />}
                    </PalmSafeButton>
                    <PalmSafeButton
                      className={s.classTool}
                      title="Save every student's board as a PDF or as pictures"
                      onPress={runAndClose(classTools.onSaveBoards)}
                    >
                      <Download size={18} strokeWidth={1.9} />
                      <span>Save boards</span>
                    </PalmSafeButton>
                  </div>
                )}
                {classRoster.length === 0 ? (
                  <div className={s.rosterEmpty}>Waiting for students to join…</div>
                ) : (
                  classRoster.map((student) => (
                    <PalmSafeButton
                      key={student.studentId}
                      className={`${s.rosterItem} ${student.hand ? s.rosterItemHand : ""}`}
                      // lets a walkthrough point at one student (see src/lib/tours.js)
                      data-tour={`roster-${student.studentId}`}
                      aria-label={`${student.name}${student.hand ? ", hand up" : ""}${student.done ? ", done" : ""}`}
                      onPress={runAndClose(() => onViewStudent(student))}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#2E9E5B", flexShrink: 0 }} />
                      <span className={s.rosterName}>{student.name}</span>
                      {/* what the student has signalled from their own page */}
                      {student.hand && (
                        <span className={`${s.rosterFlag} ${s.rosterFlagHand}`} title="Hand up">
                          <Hand size={13} strokeWidth={2.2} /> Hand up
                        </span>
                      )}
                      {student.done && (
                        <span className={`${s.rosterFlag} ${s.rosterFlagDone}`} title="Says they're done">
                          <Check size={13} strokeWidth={2.8} /> Done
                        </span>
                      )}
                    </PalmSafeButton>
                  ))
                )}
                {(classHands > 0 || classDone > 0) && (
                  <div className={s.rosterFoot}>
                    <span>
                      {classHands > 0 ? `${classHands} hand${classHands === 1 ? "" : "s"} up` : ""}
                      {classHands > 0 && classDone > 0 ? " · " : ""}
                      {classDone > 0 ? `${classDone} of ${classRoster.length} done` : ""}
                    </span>
                    {onResetClassStatus && (
                      <PalmSafeButton
                        className={s.rosterReset}
                        title="Puts every hand down and clears every Done tick, ready for the next question"
                        onPress={runAndClose(onResetClassStatus)}
                      >
                        Clear all
                      </PalmSafeButton>
                    )}
                  </div>
                )}
              </>
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <div className={`${s.chrome} ${compact ? s.chromeCompact : ""}`} onContextMenu={(e) => e.preventDefault()}>
      {menuPortal}

      {/* ---------- App bar ----------
          Left out on a student's own board in a live class: the class page
          has its own bar across the top (Teacher's board / My board), and
          everything in this one is for the board's owner. */}
      {!student && (
      <div className={`${s.appBar} ${demo ? s.appBarDemo : ""} ${demo && liveClassCode ? s.appBarDemoLive : ""}`}>
        {/* The demo board leaves with a full page load, so the real app
            starts on its real backend (see supabaseClient.js). */}
        <Link
          href="/"
          className={s.homeLink}
          aria-label={demo ? "Leave the demo" : "All boards"}
          onClick={demo ? leaveDemo : undefined}
        >
          <House size={18} strokeWidth={1.8} />
        </Link>
        {onOpenSettings && (
          <PalmSafeButton className={s.settingsBtn} onPress={onOpenSettings} aria-label="Settings" title="Settings" data-open-settings="true">
            <Settings size={18} strokeWidth={1.8} />
          </PalmSafeButton>
        )}
        <div className={s.titleBlock}>
          {recentMenu ? (
            <PalmSafeButton
              className={`${s.title} ${s.titleBtn}`}
              data-menu-trigger="true"
              aria-expanded={menu?.id === "recent"}
              aria-label={`${boardName || "Untitled board"}: recent notebooks and boards`}
              title="Recent notebooks and boards"
              onPress={(e) => toggleMenu("recent", e, 300)}
              data-recent-trigger="true"
            >
              <span className={s.titleText}>{boardName || "Untitled board"}</span>
              <ChevronDown size={14} strokeWidth={2.2} aria-hidden="true" />
            </PalmSafeButton>
          ) : (
            <div className={s.title}>{boardName || "Untitled board"}</div>
          )}
          <div className={s.status}>{statusText}</div>
        </div>
        <div className={s.spacer} />

        {/* Who else has the board open: tap someone to go to where they are. */}
        {people && people.length > 0 && (
          <div className={s.people} role="group" aria-label="Others on this board" data-tour="people">
            {people.slice(0, shownFaces).map((p) => (
              <PalmSafeButton
                key={p.key}
                className={s.face}
                style={{ background: p.color }}
                aria-label={`Find ${p.name}`}
                title={`${p.name}: tap to see where they are`}
                data-person={p.uid}
                onPress={() => onFindPerson && onFindPerson(p.key)}
              >
                {p.initial}
              </PalmSafeButton>
            ))}
            {people.length > shownFaces && (
              <PalmSafeButton
                className={`${s.face} ${s.faceMore}`}
                data-menu-trigger="true"
                aria-expanded={menu?.id === "people"}
                aria-label={`Everyone on this board (${people.length})`}
                onPress={(e) => toggleMenu("people", e, 320)}
              >
                +{people.length - shownFaces}
              </PalmSafeButton>
            )}
          </div>
        )}

        {liveClassCode && (
          <div className={s.livePill}>
            <span className={s.liveDot} />
            <span className={s.liveWord} style={{ fontWeight: 600 }}>LIVE</span>
            <span className={s.liveCode}>{liveClassCode}</span>
            <PalmSafeButton
              data-menu-trigger="true"
              data-tour="live-students"
              aria-expanded={menu?.id === "roster"}
              className={`${s.livePillBtn} ${menu?.id === "roster" ? s.livePillBtnOn : ""}`}
              onPress={(e) => toggleMenu("roster", e, 300)}
            >
              Students{classRoster.length > 0 ? ` (${classRoster.length})` : ""}
              {classHands > 0 && (
                <span className={s.handBadge} aria-label={`${classHands} hand${classHands === 1 ? "" : "s"} up`}>
                  <Hand size={12} strokeWidth={2.4} aria-hidden="true" />
                  {classHands}
                </span>
              )}
            </PalmSafeButton>
            {/* Pens are down: said here so it can't be forgotten, and one
                press lets students write again. */}
            {classTools && classTools.pensDown && (
              <PalmSafeButton
                className={`${s.livePillBtn} ${s.livePillBtnWarn}`}
                title="Students' boards are paused. Press to let them write again."
                aria-label="Pens down. Press to let students write again"
                onPress={classTools.onTogglePensDown}
              >
                <Pause size={12} strokeWidth={2.6} aria-hidden="true" />
                <span className={s.pillLong}>Pens down</span>
              </PalmSafeButton>
            )}
            {isOwner && (
              <PalmSafeButton className={s.livePillBtn} onPress={onEndLiveClass}>
                End
              </PalmSafeButton>
            )}
          </div>
        )}

        {/* The demo has nobody else in it, so its live class is run with
            pretend students (see src/lib/demoClassroom.js). */}
        {demo && !liveClassCode && !notebookPage && (
          <PalmSafeButton className={s.appBtn} data-tour="demo-live" onPress={onStartLiveClass}>
            <Users size={16} strokeWidth={1.8} />
            <span className={s.longLabel}>Try a live class</span>
            <span className={s.shortLabel}>Live class</span>
          </PalmSafeButton>
        )}

        {demo && (
          <PalmSafeButton className={`${s.appBtn} ${s.appBtnPrimary}`} data-tour="demo-signin" onPress={keepDemoAndSignIn}>
            <Check size={16} strokeWidth={2.2} />
            <span className={s.longLabel}>Sign in free to keep your work</span>
            <span className={s.shortLabel}>Sign in free</span>
          </PalmSafeButton>
        )}

        {isOwner && !demo && (
          <>
            {notebookPage && notebookPage.onShare ? (
              <PalmSafeButton className={s.appBtn} onPress={notebookPage.onShare} data-notebook-share="true">
                <Share2 size={16} strokeWidth={1.8} />
                <span className={s.longLabel}>Share</span>
                <span className={s.shortLabel}>Share</span>
              </PalmSafeButton>
            ) : (
              <PalmSafeButton className={s.appBtn} onPress={onCopyLink}>
                <Link2 size={16} strokeWidth={1.8} />
                <span className={s.longLabel}>Copy student link</span>
                <span className={s.shortLabel}>Link</span>
              </PalmSafeButton>
            )}
            {!liveClassCode && (
              <PalmSafeButton className={s.appBtn} data-tour="start-live" onPress={onStartLiveClass}>
                <Users size={16} strokeWidth={1.8} />
                <span className={s.longLabel}>Start live class</span>
                <span className={s.shortLabel}>Live</span>
              </PalmSafeButton>
            )}
            {/* Turns green with "Saved" once the save has gone through, so
                it's obvious the tap worked (red if it didn't). */}
            <PalmSafeButton
              className={`${s.appBtn} ${s.appBtnPrimary} ${saveState === "saved" ? s.appBtnSaved : ""} ${saveState === "error" ? s.appBtnError : ""}`}
              onPress={onEndSession}
              aria-busy={saveState === "saving"}
              data-save-state={saveState}
            >
              {saveState === "saving" ? (
                <span className={s.btnSpinner} aria-hidden="true" />
              ) : saveState === "error" ? (
                <RotateCw size={16} strokeWidth={2.2} />
              ) : (
                <Check size={16} strokeWidth={saveState === "saved" ? 3 : 2.2} />
              )}
              {/* Every label sits in the same spot (only the current one
                  shows), so the button keeps its width and its neighbours
                  don't jump when the label changes. */}
              <span className={s.longLabel}>
                <SaveLabels state={saveState} labels={SAVE_LABELS_LONG} />
              </span>
              <span className={s.shortLabel}>
                <SaveLabels state={saveState} labels={SAVE_LABELS_SHORT} />
              </span>
            </PalmSafeButton>
          </>
        )}
      </div>
      )}

      {/* ---------- Tool row ---------- */}
      <div ref={toolRowRef} className={`${s.toolRow} ${moreTools ? s.toolRowMore : ""}`} role="toolbar" aria-label="Board tools" data-tour="tool-row">
        <ToolButton label="Select" hint={keyHint("select")} active={activeTool === "select"} onPress={() => onSelectTool("select")}>
          <MousePointer2 {...ICON} />
        </ToolButton>
        <ToolButton label="Move" hint={keyHint("move")} active={activeTool === "move"} onPress={onSelectMove}>
          <Hand {...ICON} />
        </ToolButton>

        <div className={s.divider} />

        <ToolButton label="Pen" hint={keyHint("pen")} active={activeTool === "pen"} onPress={() => onSelectTool("pen")}>
          <Pencil {...ICON} />
        </ToolButton>
        <ToolButton label="Highlight" hint={keyHint("highlighter")} active={activeTool === "highlighter"} onPress={() => onSelectTool("highlighter")}>
          <Highlighter {...ICON} />
        </ToolButton>
        <ToolButton label="Eraser" hint={keyHint("eraser")} active={activeTool === "eraser"} onPress={() => onSelectTool("eraser")}>
          <Eraser {...ICON} />
        </ToolButton>
        <ToolButton label="Text" hint={keyHint("text")} active={activeTool === "text"} onPress={() => onSelectTool("text")}>
          <Type {...ICON} />
        </ToolButton>
        {notebookPage && (
          <ToolButton label="Tape" hint="" active={activeTool === "tape"} onPress={() => onSelectTool("tape")} tour="tape-tool">
            <RectangleHorizontal {...ICON} />
          </ToolButton>
        )}

        <div className={s.divider} />

        <ToolButton
          wide
          menu
          label="Maths"
          open={menu?.id === "maths"}
          badge={rulerActive || compassActive || calculatorActive}
          onPress={(e) => toggleMenu("maths", e)}
        >
          <Ruler {...ICON} />
        </ToolButton>
        <ToolButton wide menu label="Insert" tour="insert-menu" open={menu?.id === "insert"} onPress={(e) => toggleMenu("insert", e)}>
          <SquarePlus {...ICON} />
        </ToolButton>
        {onSetBackground && (
          <ToolButton wide menu label="Page" tour="page-menu" open={menu?.id === "page"} onPress={(e) => toggleMenu("page", e)}>
            <NotebookText {...ICON} />
          </ToolButton>
        )}

        <div className={s.spacer} />

        <ToolButton label="Undo" hint={keyHint("undo")} disabled={!canUndo} onPress={onUndo}>
          <Undo2 {...ICON} />
        </ToolButton>
        <ToolButton label="Redo" hint={keyHint("redo")} disabled={!canRedo} onPress={onRedo}>
          <Redo2 {...ICON} />
        </ToolButton>
        <ToolButton label="Clear" onPress={onClear}>
          <Trash2 {...ICON} />
        </ToolButton>
      </div>

      {/* ---------- Context bar: options + a plain-English hint ---------- */}
      <div className={s.contextBar}>
        <>
            {isInk && (
              <>
                <div className={s.ctxGroup} role="group" aria-label="Ink colour">
                  {INK_COLORS.map(([name, hex]) => (
                    <PalmSafeButton
                      key={hex}
                      // on a dark page, black ink is shown (and drawn) white
                      aria-label={pageDark && inkOn(hex, true) !== hex ? "White" : name}
                      aria-pressed={color === hex}
                      className={`${s.swatch} ${color === hex ? s.swatchActive : ""}`}
                      style={{ background: inkOn(hex, pageDark) }}
                      onPress={() => setColor(hex)}
                    />
                  ))}
                  <label className={s.customColor} aria-label="Pick any colour">
                    <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
                  </label>
                </div>
                <div className={s.ctxDivider} />
              </>
            )}
            {activeTool === "eraser" && onSetEraserMode && (
              <>
                <div className={s.segmented} role="radiogroup" aria-label="Eraser mode">
                  <PalmSafeButton
                    role="radio"
                    aria-checked={eraserMode !== "stroke"}
                    className={`${s.segBtn} ${eraserMode !== "stroke" ? s.segBtnOn : ""}`}
                    onPress={() => onSetEraserMode("precise")}
                    title="Rub out only where you drag"
                  >
                    Precise
                  </PalmSafeButton>
                  <PalmSafeButton
                    role="radio"
                    aria-checked={eraserMode === "stroke"}
                    className={`${s.segBtn} ${eraserMode === "stroke" ? s.segBtnOn : ""}`}
                    onPress={() => onSetEraserMode("stroke")}
                    title="Remove any whole line you touch"
                  >
                    Whole stroke
                  </PalmSafeButton>
                </div>
                <div className={s.ctxDivider} />
              </>
            )}
            {(isInk || activeTool === "eraser") && (
              <SizeSlider
                label={activeTool === "eraser" ? "Eraser size" : "Size"}
                value={strokeWidth}
                onChange={setStrokeWidth}
                color={activeTool === "eraser" ? "#9C9B97" : color}
              />
            )}
            {activeTool === "pen" && onSetScribbleErase && (
              <PalmSafeButton
                aria-pressed={!!scribbleErase}
                className={`${s.chip} ${scribbleErase ? s.chipOn : ""}`}
                onPress={() => onSetScribbleErase(!scribbleErase)}
                title="Scribble back and forth over ink to erase it"
              >
                <span className={`${s.switchTrack} ${scribbleErase ? s.switchTrackOn : ""}`}>
                  <span className={`${s.switchKnob} ${scribbleErase ? s.switchKnobOn : ""}`} />
                </span>
                Scribble to erase
              </PalmSafeButton>
            )}
            {activeTool === "select" && (
              <>
                {onPaste && (
                  <PalmSafeButton className={s.ctxBtn} onPress={onPaste}>
                    <ClipboardPaste size={15} strokeWidth={1.9} />
                    Paste
                  </PalmSafeButton>
                )}
                {onSelectAll && (
                  <PalmSafeButton className={s.ctxBtn} onPress={onSelectAll}>
                    <BoxSelect size={15} strokeWidth={1.9} />
                    Select all
                  </PalmSafeButton>
                )}
              </>
            )}
            {activeTool === "move" && (
              <>
                <PalmSafeButton className={s.ctxBtn} onPress={onResetView}>
                  <Maximize size={14} strokeWidth={2} />
                  Reset view
                </PalmSafeButton>
                <span style={{ color: "var(--muted)", flexShrink: 0 }}>Zoom {zoomPercent}%</span>
              </>
            )}
            {penSeen && (isInk || activeTool === "eraser") && (
              <PalmSafeButton
                aria-pressed={pencilOnly}
                className={`${s.chip} ${pencilOnly ? s.chipOn : ""}`}
                onPress={() => onSetPencilOnly(!pencilOnly)}
              >
                <span className={`${s.switchTrack} ${pencilOnly ? s.switchTrackOn : ""}`}>
                  <span className={`${s.switchKnob} ${pencilOnly ? s.switchKnobOn : ""}`} />
                </span>
                Pencil only
              </PalmSafeButton>
            )}
        </>
        {showHints && (
        <div className={s.hint}>
          {/* a hand-drawn arrow pointing back at the tools, like the
              margin notes on the landing page */}
          <svg className={s.hintIcon} width="32" height="22" viewBox="0 0 32 22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M29 5C24 14 14 17 5 13" />
            <path d="M11.7 11.1 5 13l3.1 6.3" />
          </svg>
          <span className={s.hintText}>
            <b>{hint[0]}</b> — {hint[1]}
          </span>
        </div>
        )}
      </div>
    </div>
  );
}

const SAVE_LABELS_LONG = { idle: "Finish & save", saving: "Saving…", saved: "Saved", error: "Try again" };
const SAVE_LABELS_SHORT = { idle: "Save", saving: "Saving…", saved: "Saved", error: "Retry" };

function SaveLabels({ state, labels }) {
  return (
    <span className={s.labelStack} aria-live="polite">
      {Object.keys(labels).map((key) => (
        <span key={key} className={key === state ? s.labelNow : s.labelLater} aria-hidden={key !== state}>
          {labels[key]}
        </span>
      ))}
    </span>
  );
}

function ToolButton({ label, active, open, disabled, wide, menu, badge, tour, hint, onPress, children }) {
  const classes = [s.toolBtn];
  if (wide) classes.push(s.toolBtnWide);
  if (active) classes.push(s.toolBtnActive);
  if (open) classes.push(s.toolBtnOpen);
  return (
    <PalmSafeButton
      className={classes.join(" ")}
      disabled={disabled}
      aria-pressed={menu ? undefined : !!active}
      aria-expanded={menu ? !!open : undefined}
      aria-haspopup={menu ? "menu" : undefined}
      data-menu-trigger={menu ? "true" : undefined}
      // lets a walkthrough point at this button (see src/lib/tours.js)
      data-tour={tour}
      // the keyboard shortcut, on hover (Settings ▸ Shortcuts)
      title={hint ? `${label} (${hint})` : undefined}
      onPress={onPress}
    >
      <span className={s.toolIcon}>{children}</span>
      <span className={s.toolLabel}>
        {label}
        {menu && <ChevronDown size={11} strokeWidth={2.4} />}
        {badge && <span className={s.badgeDot} />}
      </span>
    </PalmSafeButton>
  );
}

const noSubscribe = () => () => {};
const NARROW_BAR = "(max-width: 560px)";
function subscribeNarrowBar(onChange) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const m = window.matchMedia(NARROW_BAR);
  if (m.addEventListener) m.addEventListener("change", onChange);
  else if (m.addListener) m.addListener(onChange);
  return () => {
    if (m.removeEventListener) m.removeEventListener("change", onChange);
    else if (m.removeListener) m.removeListener(onChange);
  };
}
function isNarrowBar() {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(NARROW_BAR).matches;
}

function MenuItem({ icon, title, desc, on, insert, danger, tour, onPress }) {
  const iconClass = [s.menuIcon];
  if (insert) iconClass.push(s.menuIconInsert);
  if (danger) iconClass.push(s.menuIconDanger);
  return (
    <PalmSafeButton role="menuitem" className={`${s.menuItem} ${on ? s.menuItemOn : ""}`} data-tour={tour} onPress={onPress}>
      <span className={iconClass.join(" ")}>{icon}</span>
      <span className={s.menuText}>
        <span className={`${s.menuTitle} ${danger ? s.menuDangerTitle : ""}`}>
          {title}
          {on && <span className={s.menuBadge}>On</span>}
        </span>
        <span className={s.menuDesc}>{desc}</span>
      </span>
    </PalmSafeButton>
  );
}

// The size control: a slim track that fills with the current ink colour,
// a soft thumb with a big grab area, the size as a dot and a number. It's
// still a real range input underneath, so keyboard and screen readers work.
function SizeSlider({ label, value, onChange, color, min = 1, max = 40 }) {
  const pct = ((value - min) / (max - min)) * 100;
  const dot = Math.max(5, Math.min(value, 22));
  return (
    <label className={s.sizeControl}>
      <span className={s.sizeLabel}>{label}</span>
      <span className={s.sizeDotBox} aria-hidden="true">
        <span className={s.sizePreview} style={{ width: dot, height: dot, background: color }} />
      </span>
      <input
        type="range"
        className={s.range}
        min={min}
        max={max}
        value={value}
        aria-label={label}
        style={{ "--fill": `${pct}%`, "--fill-color": color }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className={s.sizeValue} aria-hidden="true">{value}</span>
    </label>
  );
}

// A colour input that only reports the colour once it's chosen (when the
// picker closes), not every step while choosing: each change is saved and
// sent to everyone on the board.
function ColorPick({ value, onPick }) {
  const ref = useRef(null);
  const pickRef = useRef(onPick);
  useEffect(() => {
    pickRef.current = onPick;
  }, [onPick]);
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    const onChange = () => pickRef.current(input.value);
    input.addEventListener("change", onChange);
    return () => input.removeEventListener("change", onChange);
  }, []);
  return <input ref={ref} type="color" defaultValue={value} />;
}
