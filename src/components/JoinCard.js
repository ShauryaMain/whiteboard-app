"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { rememberReturn } from "@/lib/returnTo";
import SignInSheet from "./SignInSheet";
import d from "./Dialog.module.css";
import p from "./Paper.module.css";

// Whether this browser is signed in (a real account), once that's known:
// null while checking, then true or false.
export function useSignedIn() {
  const { user } = useAuth() || {};
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    let live = true;
    supabase.auth
      .getSession()
      .then(() => {
        if (live) setChecked(true);
      })
      .catch(() => {
        if (live) setChecked(true);
      });
    return () => {
      live = false;
    };
  }, []);
  if (user && user.id) return true;
  return checked ? false : null;
}

// The screen for joining a class (/c/…) or opening a notebook a teacher
// made (/s/…): what it is, then sign in or go ahead.
//
//   status   "loading" | "ready" | "working" | "gone" | "problem"
//   title    e.g. "Join 10B Maths"
//   text     a line under it
//   action   the button's words ("Join the class")
//   onGo     pressed it, signed in
//   back     the path to come back to after signing in
//   sheet    the sign-in sheet's words: { title, lead, keeps }
export default function JoinCard({ status, title, text, action, onGo, back, sheet, problem, secondary = null }) {
  const signedIn = useSignedIn();
  const [signing, setSigning] = useState(false);

  const tone = status === "gone" || status === "problem" ? p.stickyPink : p.stickyBlue;
  return (
    <div className={p.screen}>
      <Link href="/" className={p.brand} aria-label="Clean Slate">
        <span className={p.brandMark} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 17c3-6 6-9 8-9s1 6 3 6 3-3 5-5" />
          </svg>
        </span>
        Clean Slate
      </Link>
      <div className={`${p.sticky} ${tone}`} role={status === "gone" || status === "problem" ? "alert" : "status"} data-join-card={status}>
        <h1 className={p.stickyTitle}>{status === "loading" ? "One moment…" : title}</h1>
        {status === "loading" || status === "working" ? (
          <span className={p.dots} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        ) : (
          <>
            {(text || problem) && <p className={p.stickyText}>{problem || text}</p>}
            {status === "ready" && signedIn !== null && (
              <button
                type="button"
                className={`${d.btn} ${d.btnPrimary}`}
                style={{ marginTop: 6 }}
                onClick={() => {
                  if (signedIn) onGo();
                  else {
                    // (signing in can land on the home page: it comes back here)
                    rememberReturn(back);
                    setSigning(true);
                  }
                }}
                data-join-go="true"
              >
                {signedIn ? action : "Sign in to carry on"}
              </button>
            )}
            {secondary}
          </>
        )}
      </div>
      {signing && (
        <SignInSheet
          trigger="join"
          custom={sheet}
          onKeep={() => {
            rememberReturn(back);
            return true;
          }}
          onClose={() => setSigning(false)}
        />
      )}
    </div>
  );
}
