"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getOrCreateStudentId } from "@/lib/classroomCode";

// Save this file as: src/app/join/[code]/page.js
// Phase 1: confirms the code is live and shows a waiting screen.
// Phase 2/3 will replace the "waiting" panel with the actual master
// board + this student's own mini-board once those exist.

const JOIN_TIMEOUT_MS = 4000;

export default function JoinCodePage() {
  const { code } = useParams();
  const router = useRouter();
  const [status, setStatus] = useState("connecting"); // connecting | connected | not_found
  const channelRef = useRef(null);

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

    channel.subscribe(async (subStatus) => {
      if (subStatus === "SUBSCRIBED") {
        await channel.track({ studentId, name, joinedAt: Date.now() });
      }
    });

    return () => {
      clearTimeout(timeoutId);
      supabase.removeChannel(channel);
    };
  }, [code]);

  if (status === "not_found") {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ marginBottom: 16 }}>
            That code isn't active right now — check with your teacher and try again.
          </p>
          <button
            onClick={() => router.push("/join")}
            style={{ border: "none", background: "#1E88E5", color: "#fff", borderRadius: 10, padding: "10px 18px", cursor: "pointer" }}
          >
            Try another code
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f6f8", padding: 24 }}>
      <div style={{ textAlign: "center", color: "#666" }}>
        {status === "connecting" ? "Connecting…" : "You're in! Waiting for your teacher to start…"}
      </div>
    </div>
  );
}