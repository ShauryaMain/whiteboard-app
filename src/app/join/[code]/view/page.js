"use client";

import { Suspense, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import ClassroomBoardViewer from "@/components/ClassroomBoardViewer";

// This route is where a student lands *after* the join handshake in
// ../page.js resolves (it navigates here with ?board=<id>). Its only
// job is to read that boardId and hand off to the actual read-only
// board viewer — it must NOT re-run the join/connecting flow, that
// already happened one level up.
function JoinCodeViewInner() {
  const { code } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const boardId = searchParams.get("board");

  // Guards against someone landing on /view directly without a board
  // id (e.g. a bookmarked/typed URL) — bounce back to the join screen
  // so the handshake can run and supply one.
  useEffect(() => {
    if (!boardId) {
      router.replace(`/join/${code}`);
    }
  }, [boardId, code, router]);

  if (!boardId) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f6f8", padding: 24 }}>
        <div style={{ textAlign: "center", color: "#666" }}>Connecting…</div>
      </div>
    );
  }

  return <ClassroomBoardViewer boardId={boardId} />;
}

export default function JoinCodeViewPage() {
  return (
    <Suspense fallback={null}>
      <JoinCodeViewInner />
    </Suspense>
  );
}
