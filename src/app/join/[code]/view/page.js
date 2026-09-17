"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getOrCreateStudentId } from "@/lib/classroomCode";
import ClassroomBoardViewer from "@/components/ClassroomBoardViewer";
import StudentMiniBoard from "@/components/StudentMiniBoard";

// This route is where a student lands *after* the join handshake in
// ../page.js resolves (it navigates here with ?board=<id>). It shows two
// things at once, switchable by tab: the teacher's shared master board
// (read-only, ClassroomBoardViewer) and this student's own mini-board
// (StudentMiniBoard) where they draw and the teacher can leave comments.
// Both stay mounted the whole time (just hidden via CSS) so switching
// tabs never loses drawing state or re-triggers a reconnect.
function JoinCodeViewInner() {
  const { code } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const boardId = searchParams.get("board");
  const [tab, setTab] = useState("master"); // master | mine

  const studentIdRef = useRef(null);
  if (studentIdRef.current === null && typeof window !== "undefined") {
    studentIdRef.current = getOrCreateStudentId();
  }

  // Guards against someone landing on /view directly without a board
  // id (e.g. a bookmarked/typed URL) — bounce back to the join screen
  // so the handshake can run and supply one.
  useEffect(() => {
    if (!boardId) {
      router.replace(`/join/${code}`);
    }
  }, [boardId, code, router]);

  // Stay present on the classroom's roster channel for the whole time
  // this student is in class — the join handshake page only tracks
  // presence up until the moment it navigates here, but the teacher's
  // in-class roster (for opening a student's mini-board) needs it kept
  // alive for as long as the student is actually watching.
  useEffect(() => {
    if (!code || !studentIdRef.current) return;
    const normalizedCode = String(code).toUpperCase();
    let name = "Student";
    try {
      name = sessionStorage.getItem("classroom_student_name") || "Student";
    } catch (err) {}

    const channel = supabase.channel(`classroom-${normalizedCode}`, {
      config: { presence: { key: studentIdRef.current } },
    });
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ studentId: studentIdRef.current, name, joinedAt: Date.now() });
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [code]);

  if (!boardId) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f6f8", padding: 24 }}>
        <div style={{ textAlign: "center", color: "#666" }}>Connecting…</div>
      </div>
    );
  }

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "10px 14px",
          paddingTop: "max(10px, env(safe-area-inset-top))",
          background: "#fff",
          borderBottom: "1px solid #eee",
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => setTab("master")}
          style={{
            border: "none",
            background: tab === "master" ? "#1E88E5" : "#f0f0f0",
            color: tab === "master" ? "#fff" : "#333",
            borderRadius: 999,
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Master Board
        </button>
        <button
          onClick={() => setTab("mine")}
          style={{
            border: "none",
            background: tab === "mine" ? "#1E88E5" : "#f0f0f0",
            color: tab === "mine" ? "#fff" : "#333",
            borderRadius: 999,
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          My Board
        </button>
      </div>

      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <div style={{ position: "absolute", inset: 0, display: tab === "master" ? "block" : "none" }}>
          <ClassroomBoardViewer boardId={boardId} />
        </div>
        <div style={{ position: "absolute", inset: 0, display: tab === "mine" ? "block" : "none" }}>
          <StudentMiniBoard code={String(code).toUpperCase()} studentId={studentIdRef.current} />
        </div>
      </div>
    </div>
  );
}

export default function JoinCodeViewPage() {
  return (
    <Suspense fallback={null}>
      <JoinCodeViewInner />
    </Suspense>
  );
}
