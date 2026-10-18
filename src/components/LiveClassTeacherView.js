"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import d from "./Dialog.module.css";
import p from "./Paper.module.css";
import { generateClassCode, getStoredClassCode, storeClassCode } from "@/lib/classroomCode";
import { useLiveMode, liveChannel, openClassReliably } from "@/lib/liveMode";
import { createAttendance, attendanceJoin, attendanceLeave, attendanceSync, attendanceState, rosterFromPresence } from "@/lib/classRoster";

// Phase 1: just the lobby — generate a code, show who's joined via
// Presence. Phase 2 will replace the "waiting" panel below with the
// actual master board once a session is under way.
export default function LiveClassTeacherView({ boardId }) {
  const router = useRouter();
  const liveMode = useLiveMode();
  const [code, setCode] = useState(() => {
    const existing = getStoredClassCode(boardId);
    if (existing) return existing;
    const fresh = generateClassCode();
    storeClassCode(boardId, fresh);
    return fresh;
  });
  const [roster, setRoster] = useState([]); // [{studentId, name}]
  const channelRef = useRef(null);

  useEffect(() => {
    if (!liveMode.ready) return undefined;
    let gone = false;
    const channel = liveChannel(`classroom-${code}`, { presence: { key: "teacher" } }, liveMode);

    // Who has joined: kept from the "joined" / "left" events themselves
    // (see src/lib/classRoster.js for why not simply presenceState()).
    const attendance = createAttendance();
    channel.on("presence", { event: "join" }, ({ key, newPresences, currentPresences }) => {
      attendanceJoin(attendance, key, newPresences, currentPresences);
    });
    channel.on("presence", { event: "leave" }, ({ key, leftPresences, currentPresences }) => {
      attendanceLeave(attendance, key, leftPresences, currentPresences);
    });
    channel.on("presence", { event: "sync" }, () => {
      attendanceSync(attendance, channel.presenceState());
      setRoster(rosterFromPresence(attendanceState(attendance), null));
    });

    // The class is registered first (so its students are let in). A code
    // that turns out to be someone else's class is swapped for a new one.
    openClassReliably(code, boardId, () => gone).then((result) => {
      if (gone || result === "gone") return;
      if (result === "taken") {
        const fresh = generateClassCode();
        storeClassCode(boardId, fresh);
        setCode(fresh);
        return;
      }
      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ role: "teacher" });
        }
      });
    });

    channelRef.current = channel;
    return () => {
      gone = true;
      supabase.removeChannel(channel);
    };
  }, [code, boardId, liveMode]);

  const joinUrl =
    typeof window !== "undefined" ? `${window.location.origin}/join` : "/join";

  function handleStart() {
    // Students ask "has this started?" themselves the moment they
    // connect (with retries) — no need to also fire a broadcast here,
    // which would race against this immediate navigation tearing the
    // connection down before the message finishes sending.
    router.push(`/board/${boardId}`);
  }

  return (
    <div className={p.screen}>
      <button type="button" className={d.btn} onClick={() => router.push(`/board/${boardId}`)} style={{ position: "fixed", top: 16, left: "max(28px, 4vw)", zIndex: 2 }}>
        ← Back to board
      </button>

      <span className={p.tapeLabel}>class code</span>
      <div className={p.chalkboard}>
        <div className={p.chalkCode}>{code}</div>
        <div className={p.chalkNote}>
          students go to <b>{joinUrl}</b> and type this in
        </div>
      </div>

      <div className={`${p.sticky} ${p.stickyBlue} ${p.roster}`}>
        <h2 className={p.stickyTitle} style={{ fontSize: 19 }}>
          {roster.length === 0 ? "Waiting for students…" : `${roster.length} student${roster.length === 1 ? "" : "s"} joined`}
        </h2>
        {roster.length === 0 ? (
          <span className={p.dots} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        ) : (
          <ul className={p.rosterList}>
            {roster.map((s) => (
              <li key={s.studentId} className={p.rosterName}>
                <span className={p.onlineDot} aria-hidden="true" />
                {s.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      <button type="button" className={`${d.btn} ${d.btnPrimary}`} onClick={handleStart} style={{ height: 54, padding: "0 34px", fontSize: 17 }}>
        Start class
      </button>
    </div>
  );
}