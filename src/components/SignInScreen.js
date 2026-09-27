"use client";

import Link from "next/link";
import d from "./Dialog.module.css";

// The first screen a teacher sees (and the loading state before it).
export default function SignInScreen({ loading, onSignIn }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "var(--bg)",
      }}
    >
      {loading ? (
        <div role="status" style={{ fontSize: 14, color: "var(--muted)" }}>
          Loading…
        </div>
      ) : (
        <div className={d.card} style={{ width: 380, alignItems: "stretch", textAlign: "center", padding: 28, gap: 18 }}>
          <span
            aria-hidden="true"
            style={{
              width: 48, height: 48, margin: "0 auto", borderRadius: 13, background: "var(--ink)", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 17c3-6 6-9 8-9s1 6 3 6 3-3 5-5" />
            </svg>
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h1 className={d.title} style={{ fontSize: 24 }}>Whiteboard</h1>
            <p className={d.subtitle} style={{ fontSize: 14 }}>
              Live boards for teaching maths — draw, share and run a class from any tablet.
            </p>
          </div>
          <button type="button" className={d.btn} onClick={onSignIn} style={{ width: "100%", height: 48, fontSize: 15, fontWeight: 600, gap: 10 }}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
            </svg>
            Sign in with Google
          </button>
          <p className={d.note} style={{ margin: 0 }}>
            Joining a class as a student?{" "}
            <Link href="/join" style={{ color: "var(--accent)", fontWeight: 600 }}>
              Enter your class code
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
