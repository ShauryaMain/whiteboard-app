"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import d from "@/components/Dialog.module.css";

// Save this file as: src/app/join/page.js
// No auth required to join a class — matches the low-friction,
// code-plus-name join flow this feature is deliberately modeled on.
// A link like /join?code=ABC123 (used by the Clean Slate landing page)
// pre-fills the class code, so the student only has to add their name.

function cleanCode(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

export default function JoinPage() {
  // useSearchParams needs a Suspense boundary so the page can still be
  // pre-rendered at build time.
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "var(--bg)" }} />}>
      <JoinForm />
    </Suspense>
  );
}

function JoinForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [code, setCode] = useState(() => cleanCode(searchParams.get("code")));
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
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        padding: 16,
      }}
    >
      <form onSubmit={handleJoin} className={d.card} style={{ width: 380, padding: 26, gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, textAlign: "center" }}>
          <h1 className={d.title} style={{ fontSize: 22 }}>Join a class</h1>
          <p className={d.subtitle}>Type the code your teacher is showing, then your name.</p>
        </div>
        <label className={d.label}>
          Class code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ABC123"
            maxLength={6}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className={d.input}
            style={{ height: 56, fontSize: 26, fontWeight: 600, textAlign: "center", letterSpacing: "0.3em", textTransform: "uppercase" }}
          />
        </label>
        <label className={d.label}>
          Your name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="First name"
            maxLength={40}
            className={d.input}
          />
        </label>
        <button
          type="submit"
          className={`${d.btn} ${d.btnPrimary}`}
          disabled={!code.trim() || !name.trim()}
          style={{ width: "100%", height: 48, fontSize: 15 }}
        >
          Join class
        </button>
      </form>
    </div>
  );
}
