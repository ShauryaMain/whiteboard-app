"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import LiveClassTeacherView from "@/components/LiveClassTeacherView";



export default function LiveClassPage() {
  const { id: boardId } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const [status, setStatus] = useState("checking"); // checking | allowed | denied

  useEffect(() => {
    if (!boardId || !user) return;
    async function checkOwnership() {
      const { data, error } = await supabase
        .from("boards")
        .select("owner_id")
        .eq("id", boardId)
        .maybeSingle();
      if (error || !data || data.owner_id !== user.id) {
        setStatus("denied");
        return;
      }
      setStatus("allowed");
    }
    checkOwnership();
  }, [boardId, user]);

  if (status === "checking") return null;

  if (status === "denied") {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ marginBottom: 16 }}>Only the board owner can start a live class.</p>
          <button
            onClick={() => router.push(`/board/${boardId}`)}
            style={{ border: "none", background: "#1E88E5", color: "#fff", borderRadius: 10, padding: "10px 18px", cursor: "pointer" }}
          >
            Back to board
          </button>
        </div>
      </div>
    );
  }

  return <LiveClassTeacherView boardId={boardId} />;
}