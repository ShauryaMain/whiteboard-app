"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import p from "./Paper.module.css";

// Google's own "Sign in with Google" button.
//
// The usual sign-in sends people to Google by way of our database
// provider, so Google's screen says "continue to <something>.supabase.co".
// This button asks Google directly from our own page instead, so Google
// names this site, and then hands the result to Supabase to sign the
// person in. Same Google account, same Clean Slate account either way.
//
// It is only used when NEXT_PUBLIC_GOOGLE_CLIENT_ID is set (see
// SignInScreen.js). If Google's button can't load, or signing in this way
// fails, `onUnavailable(tried)` is called and the usual button is shown
// instead (`tried` says whether the person had already pressed it).

export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

const SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const LOAD_TIMEOUT_MS = 8000;

let scriptPromise = null;

// Loads Google's sign-in script once per page.
function loadGoogleScript() {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = SCRIPT_SRC;
    tag.async = true;
    const timer = setTimeout(() => reject(new Error("Google's sign-in button took too long to load")), LOAD_TIMEOUT_MS);
    tag.onload = () => {
      clearTimeout(timer);
      if (window.google?.accounts?.id) resolve(window.google.accounts.id);
      else reject(new Error("Google's sign-in button didn't start"));
    };
    tag.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Google's sign-in button couldn't be loaded"));
    };
    document.head.appendChild(tag);
  }).catch((err) => {
    scriptPromise = null; // let a later visit to this screen try again
    throw err;
  });
  return scriptPromise;
}

// A one-time random value that ties Google's answer to this page. Google
// is given a scrambled copy (the hash); Supabase is given the original and
// checks that the two match.
async function makeNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce));
  const hashed = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return { nonce, hashed };
}

export default function GoogleSignInButton({ onUnavailable }) {
  const holderRef = useRef(null);
  const unavailableRef = useRef(onUnavailable);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    unavailableRef.current = onUnavailable;
  }, [onUnavailable]);

  useEffect(() => {
    let current = true;
    // `tried` is true when the person had already pressed the button.
    const giveUp = (reason, tried = false) => {
      console.warn("Google sign-in button unavailable, using the usual sign-in instead:", reason);
      if (current) unavailableRef.current?.(tried);
    };

    (async () => {
      let googleId;
      let nonce;
      try {
        [googleId, nonce] = await Promise.all([loadGoogleScript(), makeNonce()]);
      } catch (err) {
        giveUp(err);
        return;
      }
      if (!current || !holderRef.current) return;

      try {
        googleId.initialize({
          client_id: GOOGLE_CLIENT_ID,
          nonce: nonce.hashed,
          ux_mode: "popup",
          auto_select: false,
          itp_support: true,
          use_fedcm_for_prompt: true,
          callback: async (response) => {
            if (!response || !response.credential) {
              giveUp(new Error("Google didn't return a sign-in"), true);
              return;
            }
            if (current) setBusy(true);
            const { error } = await supabase.auth.signInWithIdToken({
              provider: "google",
              token: response.credential,
              nonce: nonce.nonce,
            });
            // On success the app notices the new sign-in by itself (see
            // AuthContext.js) and this screen goes away.
            if (error) {
              if (current) setBusy(false);
              giveUp(error, true);
            }
          },
        });
        const width = Math.max(200, Math.min(400, Math.floor(holderRef.current.getBoundingClientRect().width)));
        googleId.renderButton(holderRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          shape: "pill",
          text: "signin_with",
          logo_alignment: "center",
          width,
        });
        setReady(true);
      } catch (err) {
        giveUp(err);
      }
    })();

    return () => {
      current = false;
    };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, minHeight: 52, justifyContent: "center" }}>
      {/* Google draws its button inside this box */}
      <div ref={holderRef} data-google-button="true" style={{ width: "100%", display: "flex", justifyContent: "center", minHeight: ready ? 44 : 0 }} />
      {(!ready || busy) && (
        <div role="status" className={p.footNote} style={{ margin: 0 }}>
          {busy ? "Signing you in…" : "Loading Google sign-in…"}
        </div>
      )}
    </div>
  );
}
