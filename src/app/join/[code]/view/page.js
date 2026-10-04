"use client";

import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import ClassroomBoardViewer from "@/components/ClassroomBoardViewer";
import Whiteboard from "@/components/Whiteboard";
import { myClassBoard } from "@/lib/localBoard";
import p from "@/components/Paper.module.css";

// This route is where a student lands *after* the join handshake in
// ../page.js resolves (it navigates here with ?board=<id>). It shows two
// things, switchable by tab: the teacher's shared board (read-only,
// ClassroomBoardViewer) and this student's own board.
//
// The student's own board is the same board a teacher uses (Whiteboard),
// in its "class board" mode: the full toolbar, minus pictures, simulations
// and reference documents. Students never sign in, so it is kept in this
// tab's memory rather than the database (src/lib/localBoard.js); the
// teacher watches it over the live connection and pins comments on it.
//
// Both tabs stay mounted the whole time (the one not showing is only
// hidden), so switching never loses any work or drops the connection.
function JoinCodeViewInner() {
  const { code } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const boardId = searchParams.get("board");
  const [tab, setTab] = useState("master"); // master | mine

  // Who this student is, and their own board for the lesson. It only
  // exists in the browser (there is no student until the page is open), so
  // the first, server-made version of the page goes without it.
  const mine = useSyncExternalStore(neverChanges, () => myClassBoard(code), () => null);
  const studentId = mine ? mine.student.studentId : null;
  const studentName = mine ? mine.student.name : "Student";

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
  // in-class roster (for opening a student's board) needs it kept
  // alive for as long as the student is actually watching.
  useEffect(() => {
    if (!code || !studentId) return;
    const normalizedCode = String(code).toUpperCase();
    const name = studentName;

    const channel = supabase.channel(`classroom-${normalizedCode}`, {
      config: { presence: { key: studentId } },
    });
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ studentId, name, joinedAt: Date.now() });
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [code, studentId, studentName]);

  if (!boardId) {
    return (
      <div className={p.screen}>
        <div className={p.sticky} role="status">
          <h1 className={p.stickyTitle}>Opening the lesson…</h1>
          <span className={p.dots} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <div className={p.tabBar} role="tablist" aria-label="Boards">
        <span className={p.tabBrand} aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 17c3-6 6-9 8-9s1 6 3 6 3-3 5-5" />
          </svg>
        </span>
        <button type="button" role="tab" aria-selected={tab === "master"} className={`${p.tab} ${tab === "master" ? p.tabOn : ""}`} onClick={() => setTab("master")}>
          Teacher&apos;s board
        </button>
        <button type="button" role="tab" aria-selected={tab === "mine"} className={`${p.tab} ${tab === "mine" ? p.tabOn : ""}`} onClick={() => setTab("mine")}>
          My board
        </button>
        <span className={p.tabNote}>class {String(code).toUpperCase()}</span>
      </div>

      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <div style={paneStyle(tab === "master")} inert={tab !== "master"}>
          <ClassroomBoardViewer boardId={boardId} />
        </div>
        <div style={paneStyle(tab === "mine")} inert={tab !== "mine"}>
          {mine && (
            <Whiteboard boardId={mine.boardId} student={mine.student} backend={mine.backend} active={tab === "mine"} />
          )}
        </div>
      </div>
    </div>
  );
}

// The student's board never changes once made, so there is nothing to
// listen for.
function neverChanges() {
  return () => {};
}

// The tab that isn't showing is hidden rather than removed: it keeps its
// size (so nothing has to be laid out again when it comes back) but can't
// be seen, tapped or reached with the keyboard.
function paneStyle(showing) {
  return {
    position: "absolute",
    inset: 0,
    visibility: showing ? "visible" : "hidden",
    pointerEvents: showing ? "auto" : "none",
    zIndex: showing ? 1 : 0,
  };
}

export default function JoinCodeViewPage() {
  return (
    <Suspense fallback={null}>
      <JoinCodeViewInner />
    </Suspense>
  );
}
