"use client";

import { useState } from "react";
import { X } from "lucide-react";

export default function NewBoardModal({ onClose, onCreate }) {
  const [name, setName] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    onCreate(name.trim());
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 14,
          padding: 24,
          width: 340,
          boxShadow: "0 8px 30px rgba(0,0,0,0.2)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, margin: 0, color: "#1a1a1a" }}>New board</h2>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", padding: 4 }}>
            <X size={18} color="#666" />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Alex - Tuesdays"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #ddd",
              fontSize: 14,
              color: "#1a1a1a",
              background: "#ffffff",
              boxSizing: "border-box",
              marginBottom: 16,
            }}
          />
          <button
            type="submit"
            style={{
              width: "100%",
              padding: "10px 0",
              borderRadius: 8,
              border: "none",
              background: "#1E88E5",
              color: "#fff",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Create board
          </button>
        </form>
      </div>
    </div>
  );
}