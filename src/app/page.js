"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import NewBoardModal from "@/components/NewBoardModal";

export default function Home() {
  const router = useRouter();
  const [boards, setBoards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    loadBoards();
  }, []);

  async function loadBoards() {
    setLoading(true);
    const { data, error } = await supabase
      .from("boards")
      .select("id, name, created_at")
      .order("created_at", { ascending: false });
    if (!error && data) setBoards(data);
    setLoading(false);
  }

  async function handleCreate(name) {
    const { data, error } = await supabase
      .from("boards")
      .insert({ name: name || "Untitled board" })
      .select()
      .single();

    if (error) {
      alert("Couldn't create board: " + error.message);
      return;
    }
    router.push(`/board/${data.id}?owner=true`);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#F5F6F8", padding: "48px 24px" }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <h1 style={{ fontSize: 26, fontWeight: 600, marginBottom: 28, color: "#1a1a1a" }}>
          Boards
        </h1>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: 20,
          }}
        >
          <button onClick={() => setShowModal(true)} style={cardStyle(true)}>
            <Plus size={32} strokeWidth={1.5} color="#1E88E5" />
            <span style={{ marginTop: 10, fontSize: 15, color: "#1E88E5", fontWeight: 500 }}>
              New board
            </span>
          </button>

          {boards.map((b) => (
            <button
              key={b.id}
              onClick={() => router.push(`/board/${b.id}?owner=true`)}
              style={cardStyle(false)}
            >
              <span style={{ fontSize: 16, fontWeight: 500, color: "#1a1a1a", textAlign: "center" }}>
                {b.name || "Untitled board"}
              </span>
              <span style={{ marginTop: 8, fontSize: 12, color: "#999" }}>
                {new Date(b.created_at).toLocaleDateString()}
              </span>
            </button>
          ))}
        </div>

        {!loading && boards.length === 0 && (
          <p style={{ marginTop: 24, color: "#999", fontSize: 14 }}>
            No boards yet — create one to get started.
          </p>
        )}
      </div>

      {showModal && (
        <NewBoardModal
          onClose={() => setShowModal(false)}
          onCreate={(name) => {
            setShowModal(false);
            handleCreate(name);
          }}
        />
      )}
    </div>
  );
}

function cardStyle(isCreate) {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: 140,
    borderRadius: 14,
    border: isCreate ? "2px dashed #C7D8EE" : "1px solid #E4E4E7",
    background: "#ffffff",
    cursor: "pointer",
    padding: 16,
    boxShadow: isCreate ? "none" : "0 1px 3px rgba(0,0,0,0.05)",
  };
}