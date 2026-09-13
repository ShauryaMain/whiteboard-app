"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Save this file as: src/app/join/page.js
// No auth required to join a class — matches the low-friction,
// code-plus-name join flow this feature is deliberately modeled on.

export default function JoinPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  function handleJoin(e) {
    e.preventDefault();
    const trimmedCode = code.trim().toUpperCase();
    const trimmedName = name.trim();
    if (!trimmedCode || !trimmedName) return;

    try {
      sessionStorage.setItem("classroom_student_name", trimmedName);
    } catch (err) {}

    router.push(`/join/${trimmedCode}`);
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f5f6f8",
        padding: 24,
      }}
    >
      <form
        onSubmit={handleJoin}
        style={{
          width: "100%",
          maxWidth: 360,
          background: "#fff",
          borderRadius: 16,
          padding: 24,
          boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
        }}
      >
        <h1 style={{ fontSize: 20, marginBottom: 20, textAlign: "center" }}>Join a class</h1>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Class code"
          maxLength={6}
          autoCapitalize="characters"
          style={{
            width: "100%",
            fontSize: 24,
            textAlign: "center",
            letterSpacing: 4,
            padding: "12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            marginBottom: 12,
            boxSizing: "border-box",
            textTransform: "uppercase",
          }}
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          style={{
            width: "100%",
            fontSize: 16,
            padding: "12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            marginBottom: 16,
            boxSizing: "border-box",
          }}
        />
        <button
          type="submit"
          style={{
            width: "100%",
            padding: "12px",
            borderRadius: 10,
            border: "none",
            background: "#1E88E5",
            color: "#fff",
            fontSize: 16,
            cursor: "pointer",
          }}
        >
          Join
        </button>
      </form>
    </div>
  );
}