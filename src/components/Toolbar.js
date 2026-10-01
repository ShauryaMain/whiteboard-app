"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  MousePointer2, Hand, Pencil, Highlighter, Eraser, Type, Ruler, DraftingCompass, Grid3x3,
  Calculator, SquarePlus, FileText, FileX, Atom, Undo2, Redo2, Trash2, House, Link2, Users,
  Check, ChevronDown, Info, Maximize, NotebookText, ImagePlus, ClipboardPaste, BoxSelect,
} from "lucide-react";
import PalmSafeButton from "./PalmSafeButton";
import { BOARD_BACKGROUNDS, backgroundCss } from "@/lib/boardBackground";
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
};
const RULER_HINT = ["Ruler", "Drag it to move, drag its round handle to rotate, then draw along its edge."];
const COMPASS_HINT = ["Compass", "Drag the pin to set the centre and the pencil end to set the size, then draw to trace the circle."];
const STROKE_ERASER_HINT = ["Eraser", "Whole stroke removes any line you touch, in one go."];
const PEN_NO_SCRIBBLE_HINT = ["Pen", "Draw freehand. For straight lines, turn on the Ruler in Maths."];
const SELECTED_HINT = ["Selected", "Drag to move it, or use the bar next to it. Tap empty space to deselect."];
const GRAPH_MOVE_HINT = ["Graph", "Drag the graph to move it, or drag its blue corner dot to resize it."];

const ICON = { size: 22, strokeWidth: 1.8 };
const SMALL_ICON = { size: 18, strokeWidth: 1.8 };

export default function Toolbar(props) {
  const {
    boardName, statusText, isOwner,
    tool, panToolActive, onSelectTool, onSelectMove,
    color, setColor, strokeWidth, setStrokeWidth,
    onUndo, onRedo, onClear, canUndo, canRedo,
    rulerActive, onToggleRuler, compassActive, onToggleCompass,
    getHasGrid, gridToolActive, onOpenGraph, onFinishGraphMove, onRemoveGrid,
    background, onSetBackground,
    onInsertImage, onPaste, onSelectAll, hasSelection,
    eraserMode, onSetEraserMode, scribbleErase, onSetScribbleErase,
    calculatorActive, onToggleCalculator,
    canInsertReference, hasReferenceDoc, onReferenceToolClick, onOpenSimModal,
    onCopyLink, onStartLiveClass, onEndSession,
    liveClassCode, classRoster, onViewStudent, onEndLiveClass,
    penSeen, pencilOnly, onSetPencilOnly,
    zoomPercent, onResetView,
  } = props;

  // menu: null | { id: "maths" | "insert" | "page" | "roster", left, top, hasGrid }
  const [menu, setMenu] = useState(null);
  const menuRef = useRef(null);

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
    document.addEventListener("pointerdown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menu]);

  function toggleMenu(id, e, width = 320) {
    if (menu && menu.id === id) {
      setMenu(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setMenu({ id, left, top: rect.bottom + 6, hasGrid: getHasGrid ? getHasGrid() : false });
  }

  function runAndClose(fn) {
    return () => {
      setMenu(null);
      fn?.();
    };
  }

  const activeTool = panToolActive ? "move" : tool;
  const isInk = activeTool === "pen" || activeTool === "highlighter";

  let hint = TOOL_HINTS[activeTool] || TOOL_HINTS.pen;
  if (activeTool === "eraser" && eraserMode === "stroke") hint = STROKE_ERASER_HINT;
  if (activeTool === "pen" && scribbleErase === false) hint = PEN_NO_SCRIBBLE_HINT;
  if (gridToolActive) hint = GRAPH_MOVE_HINT;
  else if (activeTool === "select" && hasSelection) hint = SELECTED_HINT;
  else if (compassActive && activeTool !== "move") hint = COMPASS_HINT;
  else if (rulerActive && activeTool !== "move") hint = RULER_HINT;

  const menuPortal =
    menu && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            className={s.menu}
            style={{ left: menu.left, top: menu.top, width: menu.id === "roster" ? 280 : 320 }}
            role="menu"
          >
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
                  title={menu.hasGrid ? "Edit graph" : "Graph"}
                  desc={
                    menu.hasGrid
                      ? "Change the graph's scale, labels or style, then move it into place."
                      : "Place axes you can customise — scale, trig labels, polar."
                  }
                  onPress={runAndClose(onOpenGraph)}
                />
                {menu.hasGrid && (
                  <MenuItem
                    danger
                    icon={<Grid3x3 {...SMALL_ICON} />}
                    title="Remove graph"
                    desc="Takes the graph off the board for everyone."
                    onPress={runAndClose(onRemoveGrid)}
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
                <MenuItem
                  insert
                  icon={<Atom {...SMALL_ICON} />}
                  title="Simulation"
                  desc="Embed an interactive PhET simulation students can use live."
                  onPress={runAndClose(onOpenSimModal)}
                />
              </>
            )}
            {menu.id === "page" && (
              <>
                <div className={s.menuHeading}>Page background</div>
                <div className={s.pageGrid}>
                  {BOARD_BACKGROUNDS.map((bg) => {
                    const on = (background || "blank") === bg.id;
                    return (
                      <PalmSafeButton
                        key={bg.id}
                        role="menuitemradio"
                        aria-checked={on}
                        aria-label={`${bg.label} — ${bg.desc}`}
                        className={`${s.pageTile} ${on ? s.pageTileOn : ""}`}
                        onPress={runAndClose(() => onSetBackground?.(bg.id))}
                      >
                        <span className={s.pagePreview} style={backgroundCss(bg.id, 0.75, { x: 6, y: 6 })} />
                        <span className={s.pageLabel}>
                          {bg.label}
                          {on && <Check size={13} strokeWidth={2.6} />}
                        </span>
                      </PalmSafeButton>
                    );
                  })}
                </div>
                <div className={s.menuFootnote}>Changes the page for everyone on this board. Your drawings stay put.</div>
              </>
            )}
            {menu.id === "roster" && (
              <>
                {classRoster.length === 0 ? (
                  <div className={s.rosterEmpty}>Waiting for students to join…</div>
                ) : (
                  classRoster.map((student) => (
                    <PalmSafeButton
                      key={student.studentId}
                      className={s.rosterItem}
                      onPress={runAndClose(() => onViewStudent(student))}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#2E9E5B", flexShrink: 0 }} />
                      {student.name}
                    </PalmSafeButton>
                  ))
                )}
              </>
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <div className={s.chrome} onContextMenu={(e) => e.preventDefault()}>
      {menuPortal}

      {/* ---------- App bar ---------- */}
      <div className={s.appBar}>
        <Link href="/" className={s.homeLink} aria-label="All boards">
          <House size={18} strokeWidth={1.8} />
        </Link>
        <div className={s.titleBlock}>
          <div className={s.title}>{boardName || "Untitled board"}</div>
          <div className={s.status}>{statusText}</div>
        </div>
        <div className={s.spacer} />

        {liveClassCode && (
          <div className={s.livePill}>
            <span className={s.liveDot} />
            <span style={{ fontWeight: 600 }}>LIVE</span>
            <span className={s.liveCode}>{liveClassCode}</span>
            <PalmSafeButton
              data-menu-trigger="true"
              aria-expanded={menu?.id === "roster"}
              className={`${s.livePillBtn} ${menu?.id === "roster" ? s.livePillBtnOn : ""}`}
              onPress={(e) => toggleMenu("roster", e, 280)}
            >
              Students{classRoster.length > 0 ? ` (${classRoster.length})` : ""}
            </PalmSafeButton>
            {isOwner && (
              <PalmSafeButton className={s.livePillBtn} onPress={onEndLiveClass}>
                End
              </PalmSafeButton>
            )}
          </div>
        )}

        {isOwner && (
          <>
            <PalmSafeButton className={s.appBtn} onPress={onCopyLink}>
              <Link2 size={16} strokeWidth={1.8} />
              <span className={s.longLabel}>Copy student link</span>
              <span className={s.shortLabel}>Link</span>
            </PalmSafeButton>
            {!liveClassCode && (
              <PalmSafeButton className={s.appBtn} onPress={onStartLiveClass}>
                <Users size={16} strokeWidth={1.8} />
                <span className={s.longLabel}>Start live class</span>
                <span className={s.shortLabel}>Live</span>
              </PalmSafeButton>
            )}
            <PalmSafeButton className={`${s.appBtn} ${s.appBtnPrimary}`} onPress={onEndSession}>
              <Check size={16} strokeWidth={2.2} />
              <span className={s.longLabel}>Finish &amp; save</span>
              <span className={s.shortLabel}>Save</span>
            </PalmSafeButton>
          </>
        )}
      </div>

      {/* ---------- Tool row ---------- */}
      <div className={s.toolRow} role="toolbar" aria-label="Board tools">
        <ToolButton label="Select" active={activeTool === "select"} onPress={() => onSelectTool("select")}>
          <MousePointer2 {...ICON} />
        </ToolButton>
        <ToolButton label="Move" active={activeTool === "move"} onPress={onSelectMove}>
          <Hand {...ICON} />
        </ToolButton>

        <div className={s.divider} />

        <ToolButton label="Pen" active={activeTool === "pen"} onPress={() => onSelectTool("pen")}>
          <Pencil {...ICON} />
        </ToolButton>
        <ToolButton label="Highlight" active={activeTool === "highlighter"} onPress={() => onSelectTool("highlighter")}>
          <Highlighter {...ICON} />
        </ToolButton>
        <ToolButton label="Eraser" active={activeTool === "eraser"} onPress={() => onSelectTool("eraser")}>
          <Eraser {...ICON} />
        </ToolButton>
        <ToolButton label="Text" active={activeTool === "text"} onPress={() => onSelectTool("text")}>
          <Type {...ICON} />
        </ToolButton>

        <div className={s.divider} />

        <ToolButton
          wide
          menu
          label="Maths"
          open={menu?.id === "maths"}
          badge={rulerActive || compassActive || calculatorActive || gridToolActive}
          onPress={(e) => toggleMenu("maths", e)}
        >
          <Ruler {...ICON} />
        </ToolButton>
        <ToolButton wide menu label="Insert" open={menu?.id === "insert"} onPress={(e) => toggleMenu("insert", e)}>
          <SquarePlus {...ICON} />
        </ToolButton>
        {onSetBackground && (
          <ToolButton wide menu label="Page" open={menu?.id === "page"} onPress={(e) => toggleMenu("page", e)}>
            <NotebookText {...ICON} />
          </ToolButton>
        )}

        <div className={s.spacer} />

        <ToolButton label="Undo" disabled={!canUndo} onPress={onUndo}>
          <Undo2 {...ICON} />
        </ToolButton>
        <ToolButton label="Redo" disabled={!canRedo} onPress={onRedo}>
          <Redo2 {...ICON} />
        </ToolButton>
        <ToolButton label="Clear" onPress={onClear}>
          <Trash2 {...ICON} />
        </ToolButton>
      </div>

      {/* ---------- Context bar: options + a plain-English hint ---------- */}
      <div className={s.contextBar}>
        {gridToolActive ? (
          <PalmSafeButton className={`${s.ctxBtn} ${s.ctxBtnPrimary}`} onPress={onFinishGraphMove}>
            <Check size={15} strokeWidth={2.2} />
            Done placing graph
          </PalmSafeButton>
        ) : (
          <>
            {isInk && (
              <>
                <div className={s.ctxGroup} role="group" aria-label="Ink colour">
                  {INK_COLORS.map(([name, hex]) => (
                    <PalmSafeButton
                      key={hex}
                      aria-label={name}
                      aria-pressed={color === hex}
                      className={`${s.swatch} ${color === hex ? s.swatchActive : ""}`}
                      style={{ background: hex }}
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
        )}
        <div className={s.hint}>
          <Info size={16} strokeWidth={1.9} className={s.hintIcon} />
          <span className={s.hintText}>
            <b>{hint[0]}</b> — {hint[1]}
          </span>
        </div>
      </div>
    </div>
  );
}

function ToolButton({ label, active, open, disabled, wide, menu, badge, onPress, children }) {
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
      onPress={onPress}
    >
      {children}
      <span className={s.toolLabel}>
        {label}
        {menu && <ChevronDown size={11} strokeWidth={2.4} />}
        {badge && <span className={s.badgeDot} />}
      </span>
    </PalmSafeButton>
  );
}

function MenuItem({ icon, title, desc, on, insert, danger, onPress }) {
  const iconClass = [s.menuIcon];
  if (insert) iconClass.push(s.menuIconInsert);
  if (danger) iconClass.push(s.menuIconDanger);
  return (
    <PalmSafeButton role="menuitem" className={`${s.menuItem} ${on ? s.menuItemOn : ""}`} onPress={onPress}>
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
