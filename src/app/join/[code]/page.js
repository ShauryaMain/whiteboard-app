"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getOrCreateStudentId } from "@/lib/classroomCode";
import { readyStudent, liveChannel, teacherTopic, teacherOnlyNow } from "@/lib/liveMode";
import d from "@/components/Dialog.module.css";
import p from "@/components/Paper.module.css";
import { landingLink } from "@/lib/links";

// Save this file as: src/app/join/[code]/page.js
// Phase 1: confirms the code is live and shows a waiting screen.
// Phase 2/3 will replace the "waiting" panel with the actual master
// board + this student's own mini-board once those exist.

const JOIN_TIMEOUT_MS = 4000;
const STATUS_REQUEST_RETRY_MS = 2000;
const STATUS_REQUEST_RETRY_MAX_MS = 10000;

// The name the student typed on the join page (kept for this tab).
function savedStudentName() {
  let name = null;
  try {
    name = sessionStorage.getItem("classroom_student_name");
  } catch (err) {
    // storage switched off
  }
  return name || "Student";
}

export default function JoinCodePage() {
  const { code } = useParams();
  const router = useRouter();
  const [status, setStatus] = useState("connecting"); // connecting | connected | not_found | ended | error
  const channelRef = useRef(null);
  const navigatedRef = useRef(false);

  useEffect(() => {
    const normalizedCode = String(code).toUpperCase();
    const studentId = getOrCreateStudentId();
    const name = savedStudentName();

    let cancelled = false;
    let channel = null;
    let teacherChannel = null;
    let timeoutId = null;
    let retryTimer = null;

    (async () => {
      // Signed in (invisibly) and let into the class first, when the live
      // channels are private (src/lib/liveMode.js). A code that isn't a
      // class is known straight away then.
      const ready = await readyStudent(normalizedCode, studentId, name);
      if (cancelled) return;
      if (!ready.ok) {
        setStatus(ready.status === "ended" ? "ended" : ready.status === "not_found" ? "not_found" : "error");
        return;
      }

      channel = liveChannel(`classroom-${normalizedCode}`, { presence: { key: studentId } });
      channelRef.current = channel;
      // what the teacher says to the whole class comes on their own channel
      teacherChannel = liveChannel(teacherTopic(normalizedCode), {});
      const fromTeacher = teacherOnlyNow() ? [teacherChannel] : [teacherChannel, channel];

      let timedOut = false;
      timeoutId = setTimeout(() => {
        timedOut = true;
        setStatus((prev) => (prev === "connecting" ? "not_found" : prev));
      }, JOIN_TIMEOUT_MS);

      channel.on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        if (state.teacher && !timedOut) {
          clearTimeout(timeoutId);
          setStatus((prev) => (prev === "ended" ? prev : "connected"));
        }
      });

      // Covers a rejoin after the class already started — the original
      // "session-started" broadcast only ever fires once, at the moment
      // Start was pressed, so anyone arriving after that moment needs to
      // actively ask instead of waiting for a message that already passed.
      fromTeacher.forEach((ch) => ch.on("broadcast", { event: "session-started" }, ({ payload }) => {
        if (payload?.boardId && !navigatedRef.current) {
          navigatedRef.current = true;
          router.push(`/join/${normalizedCode}/view?board=${payload.boardId}`);
        }
      }));

      // The teacher ended the class while this student was still waiting to
      // be let in: say so, rather than leaving them waiting for ever.
      fromTeacher.forEach((ch) => ch.on("broadcast", { event: "class-ended" }, () => {
        clearTimeout(timeoutId);
        navigatedRef.current = true;
        setStatus("ended");
      }));

      teacherChannel.subscribe();

      channel.subscribe(async (subStatus) => {
        if (subStatus === "SUBSCRIBED") {
          await channel.track({ studentId, name, joinedAt: Date.now() });
          channel.send({ type: "broadcast", event: "request-session-status", payload: {} });
        }
      });

      // Asked again until the teacher answers, less and less often (every
      // message reaches the whole class).
      let gap = STATUS_REQUEST_RETRY_MS;
      const ask = () => {
        if (cancelled) return;
        if (!navigatedRef.current) channel.send({ type: "broadcast", event: "request-session-status", payload: {} });
        gap = Math.min(STATUS_REQUEST_RETRY_MAX_MS, Math.round(gap * 1.5));
        retryTimer = setTimeout(ask, gap);
      };
      retryTimer = setTimeout(ask, gap);
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      clearTimeout(retryTimer);
      if (channel) supabase.removeChannel(channel);
      if (teacherChannel) supabase.removeChannel(teacherChannel);
    };
  }, [code]);

  if (status === "error") {
    return (
      <div className={p.screen}>
        <div className={`${p.sticky} ${p.stickyPink}`} role="alert">
          <h1 className={p.stickyTitle}>Couldn&apos;t connect to the class</h1>
          <p className={p.stickyText}>Check your connection, then try again.</p>
          <button type="button" className={`${d.btn} ${d.btnPrimary}`} onClick={() => window.location.reload()} style={{ marginTop: 6 }}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (status === "ended") {
    return (
      <div className={p.screen}>
        <div className={`${p.sticky} ${p.stickyPink}`} role="alert">
          <h1 className={p.stickyTitle}>This class has ended</h1>
          <p className={p.stickyText}>Your teacher has finished the lesson.</p>
          <button type="button" className={`${d.btn} ${d.btnPrimary}`} onClick={() => router.push("/join")} style={{ marginTop: 6 }}>
            Join another class
          </button>
          <a href={landingLink("student-ended")} target="_blank" rel="noopener" className={p.madeWith}>
            Made with Clean Slate, free for teachers and tutors
          </a>
        </div>
      </div>
    );
  }

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
