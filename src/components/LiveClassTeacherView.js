"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { generateClassCode, getStoredClassCode, storeClassCode } from "@/lib/classroomCode";

// Phase 1: just the lobby — generate a code, show who's joined via
// Presence. Phase 2 will replace the "waiting" panel below with the
// actual master board once a session is under way.
export default function LiveClassTeacherView({ boardId }) {
  const router = useRouter();
  const [code] = useState(() => {
    const existing = getStoredClassCode(boardId);
    if (existing) return existing;
    const fresh = generateClassCode();
    storeClassCode(boardId, fresh);
    return fresh;
  });
  const [roster, setRoster] = useState([]); // [{studentId, name}]
  const channelRef = useRef(null);

  useEffect(() => {
    const channel = supabase.channel(`classroom-${code}`, {
      config: { presence: { key: "teacher" } },
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      const students = [];
      for (const key in state) {
        if (key === "teacher") continue;
        const presence = state[key]?.[0];
        if (presence) students.push(presence);
      }
      students.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
      setRoster(students);
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ role: "teacher" });
      }
    });

    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
    };
  }, [code]);

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
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#f5f6f8",
        padding: 24,
      }}
    >
      <button
        onClick={() => router.push(`/board/${boardId}`)}
        style={{
          position: "fixed",
          top: 20,
          left: 20,
          border: "none",
          background: "#fff",
          borderRadius: 10,
          padding: "8px 14px",
          fontSize: 13,
          cursor: "pointer",
          boxShadow: "0 1px 6px rgba(0,0,0,0.1)",
        }}
      >
        ← Back to board
      </button>

      <div style={{ fontSize: 14, color: "#666", marginBottom: 8 }}>Class code</div>
      <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: 8, color: "#1a1a1a", marginBottom: 20 }}>
        {code}
      </div>
      <div style={{ fontSize: 14, color: "#666", marginBottom: 28, textAlign: "center" }}>
        Students go to <strong>{joinUrl}</strong> and enter this code
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: 480,
          background: "#fff",
          borderRadius: 16,
          padding: 20,
          boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
        }}
      >
        <div style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
          {roster.length === 0
            ? "Waiting for students to join…"
            : `${roster.length} student${roster.length === 1 ? "" : "s"} joined`}
        </div>
        {roster.map((s) => (
          <div
            key={s.studentId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 0",
              borderBottom: "1px solid #f0f0f0",
              fontSize: 15,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#43A047", flexShrink: 0 }} />
            {s.name}
          </div>
        ))}
      </div>

      <button
        onClick={handleStart}
        style={{
          marginTop: 20,
          border: "none",
          background: "#1E88E5",
          color: "#fff",
          borderRadius: 12,
          padding: "14px 32px",
          fontSize: 16,
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: "0 2px 10px rgba(30,136,229,0.35)",
        }}
      >
        Start Class
      </button>
    </div>
  );
}