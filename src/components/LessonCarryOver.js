"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { bringLessonAcross, clearLesson, readLesson } from "@/lib/lessonKeep";
import { textBoxHeight } from "@/lib/richText";
import { track } from "@/lib/track";
import d from "./Dialog.module.css";
import p from "./Paper.module.css";

const noSubscribe = () => () => {};
const waitingHere = () => !!readLesson();
const nothingOnServer = () => false;

// How tall a text box is, measured the way the board draws it.
function measurer() {
  let ctx = null;
  try {
    ctx = document.createElement("canvas").getContext("2d");
  } catch (err) {
    ctx = null;
  }
  return (t) => (ctx ? textBoxHeight(ctx, t) : (t.fontSize || 24) * 1.3);
}

// Shown on the home page. A lesson a student asked to keep when their
// class ended (src/lib/lessonKeep.js) is made into a notebook as soon as
// they're signed in, and opened.
export default function LessonCarryOver({ userId }) {
  const router = useRouter();
  const waiting = useSyncExternalStore(noSubscribe, waitingHere, nothingOnServer);
  const [phase, setPhase] = useState("idle"); // idle (saving) | failed | done | dismissed
  const startedRef = useRef(false);

  function save() {
    startedRef.current = true;
    bringLessonAcross(userId, { textHeight: measurer() }).then((id) => {
      if (!id) {
        setPhase("failed");
        return;
      }
      track("lesson_kept", {});
      setPhase("done");
      router.push(`/board/${id}`);
    });
  }

  useEffect(() => {
    if (userId && waiting && !startedRef.current) save();
  }, [userId, waiting]);

  if ((!waiting && phase !== "done") || phase === "dismissed") return null;

  if (phase === "failed") {
    return (
      <div className={d.overlay} role="alertdialog" aria-modal="true" aria-labelledby="lesson-carry-title">
        <div className={d.card}>
          <div className={d.header}>
            <div className={d.titleBlock}>
              <h2 id="lesson-carry-title" className={d.title}>Your lesson couldn&apos;t be saved yet</h2>
              <p className={d.subtitle}>It&apos;s still kept on this device. Check your connection and try again.</p>
            </div>
          </div>
          <div className={d.actions}>
            <button
              type="button"
              className={d.btn}
              onClick={() => {
                clearLesson();
                setPhase("dismissed");
              }}
            >
              Carry on without it
            </button>
            <button
              type="button"
              className={`${d.btn} ${d.btnPrimary}`}
              onClick={() => {
                setPhase("idle");
                save();
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={p.screen} style={{ position: "fixed", inset: 0, zIndex: 200 }}>
      <div role="status" className={p.hand}>
        Putting your lesson in a notebook…
      </div>
    </div>
  );
}
