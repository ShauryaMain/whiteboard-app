"use client";

import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function Home() {
  const router = useRouter();

  async function createBoard() {
    const { data, error } = await supabase
      .from("boards")
      .insert({})
      .select()
      .single();

    if (error) {
      alert("Something went wrong creating the board: " + error.message);
      return;
    }

    router.push(`/board/${data.id}`);
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        gap: 16,
      }}
    >
      <h1 style={{ fontSize: 24 }}>Whiteboard</h1>
      <button
        onClick={createBoard}
        style={{
          padding: "12px 24px",
          fontSize: 16,
          borderRadius: 8,
          border: "none",
          background: "#1E88E5",
          color: "#fff",
          cursor: "pointer",
        }}
      >
        Create new board
      </button>
    </div>
  );
}