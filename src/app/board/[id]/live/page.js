"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import LiveClassTeacherView from "@/components/LiveClassTeacherView";
import d from "@/components/Dialog.module.css";
import p from "@/components/Paper.module.css";



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
      <div className={p.screen}>
        <div className={`${p.sticky} ${p.stickyPink}`} role="alert">
          <h1 className={p.stickyTitle}>Only the board&apos;s owner can start a live class</h1>
          <button type="button" className={`${d.btn} ${d.btnPrimary}`} onClick={() => router.push(`/board/${boardId}`)} style={{ marginTop: 6 }}>
            Back to board
          </button>
        </div>
      </div>
    );
  }

  return <LiveClassTeacherView boardId={boardId} />;
}