"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { takeReturn } from "@/lib/returnTo";
import d from "@/components/Dialog.module.css";
import p from "@/components/Paper.module.css";

// "Write on it", from a notebook's link. This page needs an account (the
// sign-in screen shows here first), then adds you to the notebook if its
// link lets people write, and opens it.
export default function WriteOnSharedNotebook() {
  const { token } = useParams();
  const router = useRouter();
  const [problem, setProblem] = useState(null); // null | "view" | "off" | "error"

  useEffect(() => {
    let live = true;
    // signed in and here: the note to come back here has done its job
    takeReturn();
    supabase
      .rpc("join_notebook_link", { p_token: String(token || "") })
      .then(({ data, error }) => {
        if (!live) return;
        if (!error && data && data.board) {
          router.replace(`/board/${data.board}`);
          return;
        }
        setProblem(error ? "error" : data && data.reason === "view" ? "view" : "off");
      })
      .catch(() => {
        if (live) setProblem("error");
      });
    return () => {
      live = false;
    };
  }, [token, router]);

  if (!problem) {
    return (
      <div className={p.screen}>
        <div className={p.sticky} role="status">
          <h1 className={p.stickyTitle}>Opening the notebook…</h1>
          <span className={p.dots} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className={p.screen}>
      <div className={`${p.sticky} ${p.stickyPink}`} role="alert">
        <h1 className={p.stickyTitle}>
          {problem === "view" ? "This link is for reading only" : problem === "off" ? "This link doesn't work any more" : "Couldn't open the notebook"}
        </h1>
        <p className={p.stickyText}>
          {problem === "view"
            ? "Whoever shared it lets people look, not write. Ask them to add you, or to let the link write too."
            : problem === "off"
              ? "Whoever shared it has turned the link off or made a new one."
              : "Check your connection, then try again."}
        </p>
        {problem === "view" ? (
          <button type="button" className={`${d.btn} ${d.btnPrimary}`} onClick={() => router.replace(`/n/${token}`)} style={{ marginTop: 6 }}>
            Read it
          </button>
        ) : (
          <button type="button" className={`${d.btn} ${d.btnPrimary}`} onClick={() => router.replace("/")} style={{ marginTop: 6 }}>
            Your notebooks
          </button>
        )}
      </div>
    </div>
  );
}
