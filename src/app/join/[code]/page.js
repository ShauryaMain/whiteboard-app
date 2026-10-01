"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getOrCreateStudentId } from "@/lib/classroomCode";
import d from "@/components/Dialog.module.css";
import p from "@/components/Paper.module.css";

// Save this file as: src/app/join/[code]/page.js
// Phase 1: confirms the code is live and shows a waiting screen.
// Phase 2/3 will replace the "waiting" panel with the actual master
// board + this student's own mini-board once those exist.

const JOIN_TIMEOUT_MS = 4000;
const STATUS_REQUEST_RETRY_MS = 2000;

export default function JoinCodePage() {
  const { code } = useParams();
  const router = useRouter();
  const [status, setStatus] = useState("connecting"); // connecting | connected | not_found
  const channelRef = useRef(null);
  const navigatedRef = useRef(false);

  useEffect(() => {
    const normalizedCode = String(code).toUpperCase();
    const studentId = getOrCreateStudentId();
    let name = "Student";
    try {
      name = sessionStorage.getItem("classroom_student_name") || "Student";
    } catch (err) {}

    const channel = supabase.channel(`classroom-${normalizedCode}`, {
      config: { presence: { key: studentId } },
    });
    channelRef.current = channel;

    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      setStatus((prev) => (prev === "connecting" ? "not_found" : prev));
    }, JOIN_TIMEOUT_MS);

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      if (state.teacher && !timedOut) {
        clearTimeout(timeoutId);
        setStatus("connected");
      }
    });

    // Covers a rejoin after the class already started — the original
    // "session-started" broadcast only ever fires once, at the moment
    // Start was pressed, so anyone arriving after that moment needs to
    // actively ask instead of waiting for a message that already passed.
    channel.on("broadcast", { event: "session-started" }, ({ payload }) => {
      if (payload?.boardId && !navigatedRef.current) {
        navigatedRef.current = true;
        router.push(`/join/${normalizedCode}/view?board=${payload.boardId}`);
      }
    });

    channel.subscribe(async (subStatus) => {
      if (subStatus === "SUBSCRIBED") {
        await channel.track({ studentId, name, joinedAt: Date.now() });
        channel.send({ type: "broadcast", event: "request-session-status", payload: {} });
      }
    });

    const retryInterval = setInterval(() => {
      if (!navigatedRef.current) {
        channel.send({ type: "broadcast", event: "request-session-status", payload: {} });
      }
    }, STATUS_REQUEST_RETRY_MS);

    return () => {
      clearTimeout(timeoutId);
      clearInterval(retryInterval);
      supabase.removeChannel(channel);
    };
  }, [code]);

  if (status === "not_found") {
    return (
      <div className={p.screen}>
        <div className={`${p.sticky} ${p.stickyPink}`} role="alert">
          <h1 className={p.stickyTitle}>That code isn&apos;t live right now</h1>
          <p className={p.stickyText}>Check the code with your teacher — they may not have started the class yet.</p>
          <button type="button" className={`${d.btn} ${d.btnPrimary}`} onClick={() => router.push("/join")} style={{ marginTop: 6 }}>
            Try another code
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={p.screen}>
      <div className={p.sticky} role="status">
        {status === "connecting" ? (
          <>
            <h1 className={p.stickyTitle}>Finding your class…</h1>
            <span className={p.dots} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </>
        ) : (
          <>
            <h1 className={p.stickyTitle}>You&apos;re in!</h1>
            <p className={p.stickyText}>Waiting for your teacher to start the lesson.</p>
            <span className={p.dots} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </>
        )}
      </div>
      <span className={p.hand} aria-hidden="true" style={{ transform: "rotate(-2deg)" }}>
        class code {String(code).toUpperCase()}
      </span>
    </div>
  );
}
