"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Hand } from "lucide-react";
import ClassroomBoardViewer from "./ClassroomBoardViewer";
import { studentBoardId } from "@/lib/localBoard";
import cls from "./Classroom.module.css";

function byJoining(a, b) {
  const when = (a.joinedAt || 0) - (b.joinedAt || 0);
  return when !== 0 ? when : String(a.studentId).localeCompare(String(b.studentId));
}

// The teacher's view of the whole class at once: a small live picture of
// every student's board. Each one is the same live viewer the teacher gets
// when they open a single board, shrunk down and kept zoomed so that
// everything on the board is in view; tapping one opens it full size.
//
// The tiles stay in the order students joined (they don't jump about when
// a hand goes up), with the hand / done flags on each.
//
// Only the tiles on screen (or nearly) are connected: a big class doesn't
// open a live connection for every student at once (Supabase allows 100 per
// page, and each one costs messages), and boards nobody is looking at
// don't send anything.
export default function ClassOverview({ code, students, question = null, pensDown = false, onOpen, onBack }) {
  const inOrder = students.slice().sort(byJoining);
  const hands = students.filter((s) => s.hand).length;
  const done = students.filter((s) => s.done).length;

  return (
    <div className={cls.studentView} data-tour="class-overview">
      <div className={cls.studentBar}>
        <button onClick={onBack} aria-label="Back to my board" className={`${cls.smallBtn} ${cls.barBtn}`}>
          <ArrowLeft size={15} /> <span className={cls.barLabel}>My board</span>
        </button>
        <div className={cls.studentName}>Class overview</div>
        <span className={cls.connecting}>
          {students.length === 0
            ? "nobody has joined yet"
            : [
                `${students.length} student${students.length === 1 ? "" : "s"}`,
                hands ? `${hands} hand${hands === 1 ? "" : "s"} up` : "",
                done ? `${done} done` : "",
                pensDown ? "pens down" : "",
              ].filter(Boolean).join(" · ")}
        </span>
      </div>

      {students.length === 0 ? (
        <div className={cls.overviewEmpty}>Students&apos; boards appear here as they join.</div>
      ) : (
        <div className={cls.overviewGrid}>
          {inOrder.map((student) => (
            <div key={student.studentId} className={`${cls.tile} ${student.hand ? cls.tileHand : ""}`}>
              <OnScreen className={cls.tileBoard}>
                <ClassroomBoardViewer
                  boardId={studentBoardId(code, student.studentId)}
                  embedded
                  interactive={false}
                  autoFit
                  glance
                  fitMargin={10}
                  question={question}
                  waitingText="Connecting…"
                />
              </OnScreen>
              <div className={cls.tileFoot}>
                <span className={cls.tileName}>{student.name}</span>
                {student.hand && (
                  <span className={`${cls.tileFlag} ${cls.tileFlagHand}`}>
                    <Hand size={12} strokeWidth={2.4} /> Hand up
                  </span>
                )}
                {student.done && (
                  <span className={`${cls.tileFlag} ${cls.tileFlagDone}`}>
                    <Check size={12} strokeWidth={2.8} /> Done
                  </span>
                )}
              </div>
              {/* the whole tile is one button, laid over the picture */}
              <button
                type="button"
                className={cls.tileHit}
                aria-label={`Open ${student.name}'s board${student.hand ? ", hand up" : ""}${student.done ? ", done" : ""}`}
                data-tour={`tile-${student.studentId}`}
                onClick={() => onOpen(student)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Shows its contents only while it is on screen (or about to be), and lets
// go of them a few seconds after it scrolls away.
const LET_GO_AFTER_MS = 4000;
function OnScreen({ className, children }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    let timer = null;
    const seen = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        clearTimeout(timer);
        if (visible) setShown(true);
        else timer = setTimeout(() => setShown(false), LET_GO_AFTER_MS);
      },
      { rootMargin: "240px 0px" }
    );
    seen.observe(el);
    return () => {
      clearTimeout(timer);
      seen.disconnect();
    };
  }, []);
  return (
    <div ref={ref} className={className}>
      {shown ? children : null}
    </div>
  );
}
