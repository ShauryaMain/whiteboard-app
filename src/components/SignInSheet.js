"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { getRealClient } from "@/lib/supabaseClient";
import { stashDemoBoard } from "@/lib/demoCarry";
import { emailCodesAvailable } from "@/lib/emailCode";
import { noteSignInStarted } from "@/lib/signInNote";
import { track } from "@/lib/track";
import GoogleSignInButton, { GOOGLE_CLIENT_ID } from "./GoogleSignInButton";
import EmailCodeSignIn from "./EmailCodeSignIn";
import d from "./Dialog.module.css";
import o from "./Onboarding.module.css";

// Signing in from the demo board, without leaving it: a sheet over the
// board with Google and "Email me a code". Once signed in, the board is
// saved into the new account and opens there (see demoCarry.js).
//
//   trigger   why it opened ("toolbar", "work", "class_end", "phone", …)
//   next      what to show once the board opens ("class": point at Start
//             live class)
//   pictures  how many pictures are on the board (they can't come along)

const COPY = {
  class: {
    title: "Set this up for your next lesson",
    lead: "Sign in free and this board is saved to your account, ready for your class. When they're in front of you, press Start live class and they join with a code.",
  },
  phone: {
    title: "Keep it, and open it on your laptop",
    lead: "Clean Slate works best on a laptop or an iPad. Sign in free here and your board is waiting there: we'll email you a code, and the link to open it.",
  },
  keep: {
    title: "Keep your board",
    lead: "Sign in free and this board is saved to your account. Open it on any device, and run a live class with your students.",
  },
};

function leaveForApp() {
  window.location.assign("/");
}

// The real Supabase client, made only when it's first used (pressing a
// button), not as soon as the sheet opens.
const lazyClient = {
  get auth() {
    return getRealClient().auth;
  },
};

// What can't come along yet (in the demo these only live in the tab).
function leftBehindNote(pictures, worksheet) {
  if (worksheet && pictures > 0) return " The worksheet and pictures don't come along yet: add them again once you're in.";
  if (worksheet) return " The worksheet doesn't come along yet: add it again once you're in.";
  if (pictures > 0) return " Pictures don't come along yet: add them again once you're in.";
  return "";
}

export default function SignInSheet({ trigger = "toolbar", next = null, pictures = 0, worksheet = false, onClose }) {
  const copy = next === "class" ? COPY.class : trigger === "phone" ? COPY.phone : COPY.keep;
  const [emailReady, setEmailReady] = useState(false);
  const [googleDirect, setGoogleDirect] = useState(Boolean(GOOGLE_CLIENT_ID));
  const client = lazyClient;
  const emailFirst = trigger === "phone";

  useEffect(() => {
    track("signin_sheet_opened", { trigger });
    let live = true;
    emailCodesAvailable().then((ok) => {
      if (live) setEmailReady(ok);
    });
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      live = false;
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep the board (as one they asked to keep) before signing in
  const keep = () => stashDemoBoard({ next });

  async function googleRedirect() {
    keep();
    track("signin_started", { method: "google", trigger });
    noteSignInStarted("google", "demo_sheet");
    await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
  }

  const google = googleDirect ? (
    <GoogleSignInButton client={client} from="demo_sheet" onBefore={keep} onSignedIn={leaveForApp} onUnavailable={() => setGoogleDirect(false)} />
  ) : (
    <button type="button" className={`${d.btn} ${emailFirst ? "" : d.btnPrimary} ${o.wide}`} onClick={googleRedirect}>
      Continue with Google
    </button>
  );
  const email = emailReady ? (
    <EmailCodeSignIn client={client} from="demo_sheet" onBefore={keep} onSignedIn={leaveForApp} primary={emailFirst} />
  ) : null;

  return (
    <div
      className={d.overlay}
      style={{ zIndex: 320 }}
      data-board-shortcuts="off"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* ph-no-capture: kept out of demo recordings (it shows an email address) */}
      <div className={`${d.card} ${o.sheetCard} ph-no-capture`} role="dialog" aria-modal="true" aria-labelledby="signin-sheet-title" data-signin-sheet="true">
        <div className={d.header}>
          <div className={d.titleBlock}>
            <h2 id="signin-sheet-title" className={d.title}>{copy.title}</h2>
          </div>
          <button type="button" className={d.close} onClick={onClose} aria-label="Not now">
            <X size={16} />
          </button>
        </div>
        <p className={o.sheetLead}>{copy.lead}</p>
        <ul className={o.keeps}>
          <li><Check size={15} strokeWidth={2.6} aria-hidden="true" />This board, with everything you wrote on it</li>
          <li><Check size={15} strokeWidth={2.6} aria-hidden="true" />On your laptop, iPad and phone</li>
          <li><Check size={15} strokeWidth={2.6} aria-hidden="true" />Live classes: students join with a code, no accounts</li>
        </ul>
        {emailFirst && email}
        {emailFirst && email && <div className={o.or}>or</div>}
        {google}
        {!emailFirst && email && <div className={o.or}>or</div>}
        {!emailFirst && email}
        <p className={o.sheetFoot}>
          Free, with no card and no ads.
          {leftBehindNote(pictures, worksheet)}
        </p>
      </div>
    </div>
  );
}
