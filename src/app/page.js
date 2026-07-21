"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Share2, LogOut } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import NewBoardModal from "@/components/NewBoardModal";
import ShareModal from "@/components/ShareModal";


export default function Home() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [myBoards, setMyBoards] = useState([]);
  const [sharedBoards, setSharedBoards] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [shareTarget, setShareTarget] = useState(null);

  useEffect(() => {
    if (user) loadBoards();
  }, [user]);

  async function loadBoards() {
    const { data: owned, error: ownedError } = await supabase
      .from("boards")
      .select("id, name, created_at, owner_id, shared_with")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });

    const { data: shared, error: sharedError } = await supabase
      .from("boards")
      .select("id, name, created_at, owner_id, shared_with")
      .contains("shared_with", [user.email.toLowerCase()])
      .order("created_at", { ascending: false });

    if (ownedError) console.error("Error loading owned boards:", ownedError);
    if (sharedError) console.error("Error loading shared boards:", sharedError);

    if (!ownedError && owned) setMyBoards(owned);
    if (!sharedError && shared) setSharedBoards(shared);
  }

  async function handleCreate(name) {
    const { data, error } = await supabase
      .from("boards")
      .insert({ name: name || "Untitled board", owner_id: user.id })
      .select()
      .single();

    if (error) {
      alert("Couldn't create board: " + error.message);
      return;
    }
    router.push(`/board/${data.id}`);
  }

  function openShareModal(board, e) {
    e.stopPropagation();
    setShareTarget(board);
  }

  async function handleShareSubmit(email) {
    const board = shareTarget;
    setShareTarget(null);
    const updated = Array.from(new Set([...(board.shared_with || []), email.toLowerCase()]));
    const { error } = await supabase.from("boards").update({ shared_with: updated }).eq("id", board.id);
    if (error) {
      alert("Couldn't share: " + error.message);
      return;
    }
    loadBoards();
  }

  return (
    <div style={{ minHeight: "100vh", background: "#F5F6F8", padding: "48px 24px" }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
          <h1 style={{ fontSize: 26, fontWeight: 600, color: "#1a1a1a", margin: 0 }}>Boards</h1>
          <button
            onClick={signOut}
            style={{
              display: "flex", alignItems: "center", gap: 6, border: "none",
              background: "#fff", padding: "8px 14px", borderRadius: 999,
              fontSize: 13, color: "#666", cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
            }}
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 20 }}>
          <button onClick={() => setShowModal(true)} style={cardStyle(true)}>
            <Plus size={32} strokeWidth={1.5} color="#1E88E5" />
            <span style={{ marginTop: 10, fontSize: 15, color: "#1E88E5", fontWeight: 500 }}>New board</span>
          </button>

          {myBoards.map((b) => (
            <div key={b.id} onClick={() => router.push(`/board/${b.id}`)} style={{ ...cardStyle(false), position: "relative" }}>
              <button
                onClick={(e) => openShareModal(b, e)}
                title="Share"
                style={{
                  position: "absolute", top: 10, right: 10, border: "none",
                  background: "transparent", cursor: "pointer", padding: 4, color: "#999",
                }}
              >
                <Share2 size={15} />
              </button>
              <span style={{ fontSize: 16, fontWeight: 500, color: "#1a1a1a", textAlign: "center" }}>
                {b.name || "Untitled board"}
              </span>
              <span style={{ marginTop: 8, fontSize: 12, color: "#999" }}>
                {new Date(b.created_at).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>

        {sharedBoards.length > 0 && (
          <>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: "#1a1a1a", margin: "36px 0 16px" }}>Shared with me</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 20 }}>
              {sharedBoards.map((b) => (
                <div key={b.id} onClick={() => router.push(`/board/${b.id}`)} style={cardStyle(false)}>
                  <span style={{ fontSize: 16, fontWeight: 500, color: "#1a1a1a", textAlign: "center" }}>
                    {b.name || "Untitled board"}
                  </span>
                </div>
              ))}
            </div>
          </>
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

      {shareTarget && (
        <ShareModal
          onClose={() => setShareTarget(null)}
          onShare={handleShareSubmit}
        />
      )}
    </div>
  );
}

function cardStyle(isCreate) {
  return {
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    height: 140, borderRadius: 14, border: isCreate ? "2px dashed #C7D8EE" : "1px solid #E4E4E7",
    background: "#ffffff", cursor: "pointer", padding: 16,
    boxShadow: isCreate ? "none" : "0 1px 3px rgba(0,0,0,0.05)",
  };
}