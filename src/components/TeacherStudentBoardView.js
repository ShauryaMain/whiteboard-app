"use client";

import { useRef, useState } from "react";
import { ArrowLeft, Check, Hand, Maximize, MessageSquare, MonitorUp, Pencil, Trash2, Undo2 } from "lucide-react";
import ClassroomBoardViewer from "./ClassroomBoardViewer";
import { newId } from "@/lib/boardObjects";
import { studentBoardId } from "@/lib/localBoard";
import cls from "./Classroom.module.css";

// The teacher's window into one student's own board, opened by tapping a
// name in the live class's Students list (or a preview in the overview).
//
// A student's board is a full board (pen, highlighter, text, shapes,
// ruler, graph, page styles…), so this shows it with the same live viewer
// students use to watch the teacher's board: everything the student does
// appears as they do it, and the teacher can drag to move around it and
// pinch (or scroll) to zoom.
//
// The teacher has two ways of leaving something on it, chosen in the strip
// along the bottom:
//   • Comment: tap the board, type a note, and it is pinned to that spot.
//   • Write: draw straight onto the student's board (a tick, a correction).
//     The student sees it as it is written and can write around it, but
//     only the teacher can take it off again (Undo, or Remove my writing).
// Both are kept by the student's board (so they are still there after
// closing this view and coming back) and sent with everything else when
// this view opens.
//
// "Show to class" puts this board on every student's screen, with or
// without the student's name, until it is stopped or this view is closed.

const COMPOSER_WIDTH = 270;
const COMPOSER_HEIGHT = 150;
const PEN_COLOURS = [
  { value: "#E53935", name: "Red" },
  { value: "#2E9E5B", name: "Green" },
  { value: "#1E88E5", name: "Blue" },
];
const PEN_WIDTH = 4;

export default function TeacherStudentBoardView({
  code, student, question = null, spotlight = null, onBack, onLowerHand, onSpotlight, onStopSpotlight,
}) {
  const viewerRef = useRef(null);
  const [comments, setComments] = useState([]);
  const [connected, setConnected] = useState(false);
  const [showComments, setShowComments] = useState(true);
  // The note being typed: where it will be pinned (board coordinates) and
  // where its box sits on screen.
  const [composer, setComposer] = useState(null);
  // "comment" (tap to pin a note, drag to move around) or "write"
  const [mode, setMode] = useState("comment");
  const [penColour, setPenColour] = useState(PEN_COLOURS[0].value);
  const [ink, setInk] = useState({ total: 0, mine: 0 });
  const [askSpotlight, setAskSpotlight] = useState(false);

  const boardId = student?.studentId ? studentBoardId(code, student.studentId) : null;
  const name = student?.name || "Student";
  const writing = mode === "write";

  function handleSnapshot(payload) {
    setConnected(true);
    setComments(Array.isArray(payload.comments) ? payload.comments : []);
  }

  function handleBoardTap(at, screen, pane) {
    // Keep the box on the board: beside the tap, flipped above it near the
    // bottom edge.
    const left = Math.max(8, Math.min(screen.x - COMPOSER_WIDTH / 2, pane.width - COMPOSER_WIDTH - 8));
    const below = screen.y + 18;
    const top = below + COMPOSER_HEIGHT > pane.height ? Math.max(8, screen.y - COMPOSER_HEIGHT - 18) : below;
    setComposer({ x: at.x, y: at.y, left, top, text: "" });
  }

  function submitComment() {
    if (!composer || !composer.text.trim()) {
      setComposer(null);
      return;
    }
    const comment = { id: newId(), x: composer.x, y: composer.y, text: composer.text.trim(), createdAt: Date.now() };
    setComments((prev) => [...prev, comment]);
    viewerRef.current?.send("teacher-comment-add", comment);
    setComposer(null);
  }

  function removeComment(id) {
    setComments((prev) => prev.filter((c) => c.id !== id));
    viewerRef.current?.send("teacher-comment-remove", { id });
  }

  function chooseMode(next) {
    setComposer(null);
    setMode(next);
  }

  function removeMyWriting() {
    if (window.confirm(`Take all of your writing off ${name}'s board?`)) viewerRef.current?.clearInk();
  }

  // The numbered pins: every comment, plus the one being typed.
  const pins = composer ? [...comments, { id: "draft", x: composer.x, y: composer.y, draft: true }] : comments;

  return (
    <div className={cls.studentView}>
      <div className={cls.studentBar}>
        <button
          onClick={onBack}
          aria-label="Back"
          className={`${cls.smallBtn} ${cls.barBtn}`}
        >
          <ArrowLeft size={15} /> <span className={cls.barLabel}>Back</span>
        </button>
        <div className={cls.studentName}>{`${name}'s board`}</div>
        {!connected && !student?.left && <span className={cls.connecting}>connecting…</span>}
        {student?.left && <span className={cls.connecting}>has left the class</span>}
        {/* what the student has signalled from their own page */}
        {student?.done && (
          <span className={`${cls.statusFlag} ${cls.statusFlagDone}`}>
            <Check size={13} strokeWidth={2.8} /> <span className={cls.barLabel}>Done</span>
          </span>
        )}
        {student?.hand && (
          <button
            type="button"
            onClick={() => onLowerHand?.(student.studentId)}
            className={`${cls.smallBtn} ${cls.barBtn} ${cls.handBtn}`}
            title={`${name} has a hand up. Press once you've helped, to put it down.`}
          >
            <Hand size={15} strokeWidth={2.2} /> Lower hand
          </button>
        )}
        <div className={cls.grow} />
        {onSpotlight && (
          <div className={cls.spotWrap}>
            {spotlight ? (
              <button
                type="button"
                onClick={() => onStopSpotlight?.()}
                className={`${cls.smallBtn} ${cls.barBtn} ${cls.spotOn}`}
                title="Every student is looking at this board. Press to give them their own screens back."
              >
                <MonitorUp size={15} /> Stop showing
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setAskSpotlight((v) => !v)}
                aria-expanded={askSpotlight}
                aria-haspopup="menu"
                disabled={!!student?.left}
                className={`${cls.smallBtn} ${cls.barBtn}`}
                title="Put this board on every student's screen"
              >
                <MonitorUp size={15} /> <span className={cls.barLabel}>Show to class</span>
              </button>
            )}
            {askSpotlight && !spotlight && (
              <div className={cls.spotMenu} role="menu" aria-label="Show this board to the class">
                <button
                  type="button"
                  role="menuitem"
                  className={cls.spotChoice}
                  onClick={() => {
                    setAskSpotlight(false);
                    onSpotlight(true);
                  }}
                >
                  <b>Show with name</b>
                  <span>{`The class sees "${name}'s board"`}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={cls.spotChoice}
                  onClick={() => {
                    setAskSpotlight(false);
                    onSpotlight(false);
                  }}
                >
                  <b>Show without name</b>
                  <span>The class sees &quot;A classmate&apos;s board&quot;</span>
                </button>
              </div>
            )}
          </div>
        )}
        <button
          onClick={() => viewerRef.current?.fitAll()}
          className={`${cls.smallBtn} ${cls.barBtn}`}
          aria-label="Show all"
          title="Zoom out so everything on this board is in view"
        >
          <Maximize size={14} /> <span className={cls.barLabel}>Show all</span>
        </button>
        <button
          onClick={() => setShowComments((v) => !v)}
          className={`${cls.smallBtn} ${cls.barBtn} ${showComments ? cls.smallBtnOn : ""}`}
        >
          Comments{comments.length > 0 ? ` (${comments.length})` : ""}
        </button>
      </div>

      {spotlight && (
        <div className={cls.spotBanner} role="status">
          <MonitorUp size={16} />
          <span>
            {spotlight.showName
              ? `The whole class is looking at ${name}'s board, with their name.`
              : `The whole class is looking at this board, without ${name}'s name.`}
          </span>
        </div>
      )}

      <div className={cls.studentBody}>
        <div className={cls.studentBoard}>
          {boardId && (
            <ClassroomBoardViewer
              ref={viewerRef}
              boardId={boardId}
              embedded
              fitOnLoad
              tour="student-board"
              waitingText={`Waiting for ${name}'s board…`}
              pins={pins}
              question={question}
              withComments
              drawTool={writing ? { color: penColour, width: PEN_WIDTH } : null}
              onInkChange={setInk}
              onBoardTap={writing ? undefined : handleBoardTap}
              onSnapshot={handleSnapshot}
            >
              {!composer && (
                // a hint only: taps on it go through to the board underneath
                <div className={`${cls.statusPill} ${cls.statusPillBottom}`} style={{ pointerEvents: "none" }}>
                  {writing
                    ? "Write on the board · two fingers to move around"
                    : "Tap the board to leave a comment · drag to move around"}
                </div>
              )}

              {composer && (
                <div className={cls.composer} style={{ left: composer.left, top: composer.top, width: COMPOSER_WIDTH }}>
                  <textarea
                    autoFocus
                    value={composer.text}
                    onChange={(e) => setComposer({ ...composer, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        submitComment();
                      } else if (e.key === "Escape") {
                        setComposer(null);
                      }
                    }}
                    placeholder="What should they change?"
                    rows={2}
                    className={cls.composerInput}
                  />
                  <div className={cls.composerActions}>
                    <button onClick={() => setComposer(null)} className={cls.smallBtn}>
                      Cancel
                    </button>
                    <button onClick={submitComment} className={`${cls.smallBtn} ${cls.smallBtnPrimary}`}>
                      Send
                    </button>
                  </div>
                </div>
              )}
            </ClassroomBoardViewer>
          )}
        </div>

        {showComments && (
          <div className={cls.sidePanel}>
            <div className={cls.sideTitle}>Comments for {student?.name || "this student"}</div>
            {comments.length === 0 && (
              <div className={cls.sideEmpty}>No comments yet — tap the board to add one.</div>
            )}
            {comments.map((c, i) => (
              <div key={c.id} className={cls.commentRow} data-tour="student-comment">
                <span className={cls.commentNum}>{i + 1}</span>
                <span className={cls.commentText}>{c.text}</span>
                <button onClick={() => removeComment(c.id)} className={cls.commentDelete} title="Delete comment">
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* What a tap or a drag on the board does: pin a comment, or write. */}
      <div className={cls.miniBar} role="toolbar" aria-label={`Tools for ${name}'s board`}>
        <button
          type="button"
          aria-pressed={!writing}
          className={`${cls.miniBtn} ${cls.miniBtnIcon} ${!writing ? cls.miniBtnOn : ""}`}
          onClick={() => chooseMode("comment")}
        >
          <MessageSquare size={16} /> Comment
        </button>
        <button
          type="button"
          aria-pressed={writing}
          className={`${cls.miniBtn} ${cls.miniBtnIcon} ${writing ? cls.miniBtnOn : ""}`}
          title={`Write on ${name}'s board. They can see it, and only you can take it off.`}
          onClick={() => chooseMode("write")}
        >
          <Pencil size={16} /> Write
        </button>
        {writing && (
          <div className={cls.swatches} role="group" aria-label="Pen colour">
            {PEN_COLOURS.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-label={c.name}
                aria-pressed={penColour === c.value}
                className={`${cls.swatch} ${penColour === c.value ? cls.swatchOn : ""}`}
                style={{ background: c.value }}
                onClick={() => setPenColour(c.value)}
              />
            ))}
          </div>
        )}
        <div className={cls.grow} />
        {(writing || ink.total > 0) && (
          <>
            <button
              type="button"
              className={`${cls.miniBtn} ${cls.miniBtnIcon}`}
              disabled={ink.mine === 0}
              title="Take back the last thing you wrote"
              onClick={() => viewerRef.current?.undoInk()}
            >
              <Undo2 size={16} /> Undo
            </button>
            <button
              type="button"
              className={`${cls.miniBtn} ${cls.miniBtnIcon}`}
              disabled={ink.total === 0}
              title={`Take all of your writing off ${name}'s board`}
              onClick={removeMyWriting}
            >
              <Trash2 size={16} /> <span className={cls.barLabel}>Remove my writing</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
