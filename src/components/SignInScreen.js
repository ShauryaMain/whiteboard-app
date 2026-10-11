"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { demoCarryLeftPictures, demoKeepRequested, getDemoCarry, getServerDemoCarry, subscribeDemoCarry } from "@/lib/demoCarry";
import GoogleSignInButton, { GOOGLE_CLIENT_ID } from "./GoogleSignInButton";
import EmailCodeSignIn from "./EmailCodeSignIn";
import { emailCodesAvailable } from "@/lib/emailCode";
import { supabase } from "@/lib/supabaseClient";
import o from "./Onboarding.module.css";
import d from "./Dialog.module.css";
import p from "./Paper.module.css";
import { LANDING_URL } from "@/lib/links";

// The demo board runs on its own stand-in backend, which is chosen when a
// page loads, so open it with a full page load rather than an in-app hop.
function openDemo(e) {
  e.preventDefault();
  window.location.assign("/demo");
}

const LINK_BUTTON = {
  background: "none",
  border: 0,
  padding: 0,
  font: "inherit",
  fontWeight: 600,
  color: "var(--accent-ink)",
  textDecoration: "underline",
  cursor: "pointer",
};

// The first screen a teacher sees (and the loading state before it).
export default function SignInScreen({ loading, onSignIn }) {
  // Someone who just pressed "Keep it" on the demo has a board waiting on
  // this device (see src/lib/demoCarry.js). (A board kept only as they
  // worked is saved only into a brand-new account, so nothing is promised
  // for that one.)
  const demoWaiting = useSyncExternalStore(subscribeDemoCarry, getDemoCarry, getServerDemoCarry) === "waiting" && demoKeepRequested();
  // Google's own button is used when it has been set up (see
  // GoogleSignInButton.js). If it can't load or fails, the usual button
  // takes over, so there is always a way in.
  const [googleDirect, setGoogleDirect] = useState(Boolean(GOOGLE_CLIENT_ID));
  const [retryNote, setRetryNote] = useState(false);
  // "Email me a code", for anyone who'd rather not use Google (shown once
  // the site says it can send codes).
  const [emailReady, setEmailReady] = useState(false);
  useEffect(() => {
    // (only once it's clear they're not signed in already)
    if (loading) return undefined;
    let live = true;
    emailCodesAvailable().then((ok) => {
      if (live) setEmailReady(ok);
    });
    return () => {
      live = false;
    };
  }, [loading]);
  if (loading) {
    return (
      <div className={p.screen}>
        <div role="status" className={p.hand}>
          Getting your boards…
        </div>
      </div>
    );
  }
  return (
    <div className={p.screen}>
      <div className={d.card} style={{ width: 420, alignItems: "stretch", padding: "32px 28px 26px", gap: 18 }}>
        <a
          href={LANDING_URL}
          className={`${p.brandMark} ${p.brandMarkBig} ${p.brandMarkLink}`}
          aria-label="Clean Slate home page"
          title="About Clean Slate"
          style={{ margin: "0 auto" }}
        >
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 17c3-6 6-9 8-9s1 6 3 6 3-3 5-5" />
          </svg>
        </a>
        <span className={p.tapeLabel}>free for every teacher</span>
        <h1 className={p.heroTitle}>
          A clean slate for <span className={p.underlined}>every</span> lesson.
        </h1>
        <p className={`${d.subtitle} ${p.center}`} style={{ fontSize: 15 }}>
          Draw, share and run a whole class from any tablet.
        </p>
        {demoWaiting && (
          <p className={`${p.hand} ${p.center}`} role="status" style={{ margin: 0 }}>
            Your demo board is kept on this device. Sign in and it&apos;s saved to your account.
            {demoCarryLeftPictures() ? " Pictures don't come along, but you can add them again." : ""}
          </p>
        )}
        {retryNote && (
          <p className={p.footNote} role="alert" style={{ margin: 0 }}>
            That didn&apos;t go through. Please try once more with the button below.
          </p>
        )}
        {googleDirect ? (
          <>
            <GoogleSignInButton
              onUnavailable={(tried) => {
                setGoogleDirect(false);
                setRetryNote(Boolean(tried));
              }}
            />
            <p className={p.footNote} style={{ margin: 0 }}>
              Button not working?{" "}
              <button type="button" onClick={onSignIn} style={LINK_BUTTON}>
                Sign in another way
              </button>
            </p>
          </>
        ) : (
          <button type="button" className={`${d.btn} ${p.btnWide} ${p.googleBtn}`} onClick={onSignIn} style={{ gap: 10 }}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
            </svg>
            Sign in with Google
          </button>
        )}
        {emailReady && (
          <>
            <div className={o.or}>or</div>
            {/* signing in here lands on the boards page by itself */}
            <EmailCodeSignIn client={supabase} from="signin_page" />
          </>
        )}
        <p className={p.footNote} style={{ margin: 0 }}>
          Just looking?{" "}
          <Link href="/demo" prefetch={false} onClick={openDemo}>
            Try the demo board, no sign-in
          </Link>
        </p>
        <p className={p.footNote} style={{ margin: 0 }}>
          {/* a full page load, so nothing from the teacher pages (like the visit counts) comes along */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          Joining a class as a student? <a href="/join">Enter your class code</a>
        </p>
      </div>
      <span className={p.hand} aria-hidden="true" style={{ transform: "rotate(-2deg)" }}>
        no card, no ads, no board limit
      </span>
    </div>
  );
}
