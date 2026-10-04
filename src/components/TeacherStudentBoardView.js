"use client";

import { useRef, useState } from "react";
import { ArrowLeft, Maximize } from "lucide-react";
import ClassroomBoardViewer from "./ClassroomBoardViewer";
import { newId } from "@/lib/boardObjects";
import { studentBoardId } from "@/lib/localBoard";
import cls from "./Classroom.module.css";

// The teacher's window into one student's own board, opened by tapping a
// name in the live class's Students list.
//
// A student's board is a full board now (pen, highlighter, text, shapes,
// ruler, graph, page styles…), so this shows it with the same live viewer
// students use to watch the teacher's board: everything the student does
// appears as they do it, and the teacher can drag to move around it and
// pinch (or scroll) to zoom.
//
// The teacher never draws here. Their one way of writing on it is a
// comment: tap the board, type a note, and it is pinned to that spot on
// the student's board. The student's board keeps the list of comments (so
// they are still there after closing this view and coming back) and sends
// it with everything else when this view opens.

const COMPOSER_WIDTH = 270;
const COMPOSER_HEIGHT = 150;

export default function TeacherStudentBoardView({ code, student, onBack }) {
  const viewerRef = useRef(null);
  const [comments, setComments] = useState([]);
  const [connected, setConnected] = useState(false);
  const [showComments, setShowComments] = useState(true);
  // The note being typed: where it will be pinned (board coordinates) and
  // where its box sits on screen.
  const [composer, setComposer] = useState(null);

  const boardId = student?.studentId ? studentBoardId(code, student.studentId) : null;
  const name = student?.name || "Student";

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

  // The numbered pins: every comment, plus the one being typed.
  const pins = composer ? [...comments, { id: "draft", x: composer.x, y: composer.y, draft: true }] : comments;

  return (
    <div className={cls.studentView}>
      <div className={cls.studentBar}>
        <button
          onClick={onBack}
          aria-label="Back to the roster"
          className={`${cls.smallBtn} ${cls.barBtn}`}
        >
          <ArrowLeft size={15} /> <span className={cls.barLabel}>Roster</span>
        </button>
        <div className={cls.studentName}>{`${name}'s board`}</div>
        {!connected && <span className={cls.connecting}>connecting…</span>}
        <div className={cls.grow} />
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
              onBoardTap={handleBoardTap}
              onSnapshot={handleSnapshot}
            >
              {!composer && (
                // a hint only: taps on it go through to the board underneath
                <div className={`${cls.statusPill} ${cls.statusPillBottom}`} style={{ pointerEvents: "none" }}>
                  Tap the board to leave a comment · drag to move around
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
    </div>
  );
}
