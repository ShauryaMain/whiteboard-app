// Counting the steps people take from the demo board to their first real
// class, with PostHog (posthog.com), so we can see where they stop.
//
// - Only switched on when NEXT_PUBLIC_POSTHOG_KEY is set (PostHog project
//   settings → Project API key). Without it, nothing loads and track()
//   does nothing.
// - Never on student pages (joining a class, a student's board, joining a
//   class's notebooks at /c/…, opening a notebook a teacher made at /s/…),
//   nor on a notebook opened from its link (/n/…, read by people with no account):
//   those pages don't load it at all, and nothing is sent from them.
// - No cookies: PostHog keeps its random visitor id in this browser's
//   local storage. A signed-in teacher is known by their account id only
//   (never their name or email).
// - Board ids and class codes are swapped for placeholders in addresses,
//   as with the Vercel visit counts (Analytics.js).
// - Screen recordings are only for the demo board, with everything typed
//   hidden (and only once recordings are switched on in PostHog).
//
// The events are listed in EVENTS below.

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY || "";
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

export const EVENTS = [
  "demo_opened", // the demo board opened ({ restored })
  "demo_start_chosen", // the answer to "What are you planning?" ({ choice })
  "demo_first_change", // first thing they wrote or drew ({ kind })
  "demo_class_started", // "Try a live class" ({ kind })
  "demo_class_step", // a step of the pretend class walkthrough ({ step })
  "demo_class_finished", // the pretend class summary appeared
  "signin_prompt_shown", // a "keep your board?" note appeared ({ trigger })
  "signin_prompt_answered", // ...and what they chose ({ trigger, answer })
  "signin_sheet_opened", // the sign-in sheet opened ({ trigger })
  "signin_started", // they pressed Google or asked for an email code ({ method, trigger })
  "signed_in", // signed in from the sheet or the sign-in page ({ method, from })
  "demo_board_carried", // a demo board was saved into a new account ({ kind, next })
  "board_created", // a new board from the boards page
  "live_class_started", // a real live class ({ })
  "live_class_ended", // ...and how many students joined ({ students })
  "phone_link_copied", // a phone visitor copied the demo's link
  "share_link_copied", // a teacher copied a link to pass on to a colleague ({ from })
  "notebook_created", // a new notebook from the shelf ({ paper, size })
  "notebook_page_added", // a page added to a notebook
  "notebook_pdf_imported", // pages added to a notebook from a PDF
  "notebook_exported", // a notebook (or some pages) exported as a PDF ({ pages, tape })
  "notebook_quiz_started", // Quiz me ({ tapes, again })
  "notebook_quiz_finished", // ...to the end ({ tapes, right })
  "notebook_link_changed", // a notebook's link turned on, off or replaced ({ mode, fresh })
  "notebook_link_copied", // ...and copied ({ mode })
  "lesson_kept", // a student's kept lesson became a notebook
  "demo_notebook_step", // a step of the demo notebook's walkthrough ({ step })
  "class_created", // a teacher made a class
  "student_notebook_created", // a teacher made a notebook for one student
  "clip_sent", // a teacher sent pages into notebooks ({ kind, pages, notebooks, from })
  "submission_returned", // a teacher marked and returned homework
];

// ?ref=... on the link that brought the visitor (e.g. ?ref=mswb-reply for
// a reply on Reddit). It goes with every event of this visit as `ref`,
// and the first one this browser ever came with is kept as `first_ref`,
// so PostHog can show which links bring people who go on to sign in.
const REF_RE = /^[A-Za-z0-9_-]{1,40}$/;
export function readRef(search) {
  let ref = null;
  try {
    ref = new URLSearchParams(search || "").get("ref");
  } catch (err) {
    ref = null;
  }
  if (!ref || !REF_RE.test(ref)) return null;
  return ref.toLowerCase();
}

function rememberRef(posthog) {
  const ref = readRef(window.location.search);
  if (!ref) return;
  try {
    posthog.register_for_session({ ref });
    posthog.register_once({ first_ref: ref });
  } catch (err) {
    // an older PostHog library: the address still carries it
  }
}

let loading = null;
let ph = null; // the PostHog library, once it's loaded
const queue = [];

function blocked(pathname) {
  const path = String(pathname || "");
  return path.startsWith("/join") || path.startsWith("/n/") || path.startsWith("/c/") || path.startsWith("/s/");
}

function currentPath() {
  return typeof window === "undefined" ? "" : window.location.pathname;
}

// Board ids, class codes and sign-in tokens never leave the browser.
export function safeAddress(value) {
  if (typeof value !== "string" || !value) return value;
  let out = value
    .replace(/\/board\/[^/?#\s]+/g, "/board/[id]")
    .replace(/\/join\/[^/?#\s]+/g, "/join/[code]")
    .replace(/\/(class|mark|c|s|n|b)\/[^/?#\s]+/g, "/$1/[id]")
    .replace(/([?&])(code|token|email|board|access_token|refresh_token|page|mark)=[^&#\s]*/gi, "$1$2=[hidden]");
  // the part after # (a sign-in can briefly put tokens there)
  if (/^(https?:\/\/|\/)/i.test(out)) out = out.replace(/#.*$/, "");
  return out;
}

function scrubValues(obj) {
  if (!obj || typeof obj !== "object") return;
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === "string") obj[key] = safeAddress(value);
  }
}

// Every event, just before it's sent: nothing at all from student pages
// (in case PostHog was already loaded when the tab moved there), and every
// address-like value made safe, whichever property PostHog put it in.
export function scrubEvent(event) {
  if (!event) return event;
  if (typeof window !== "undefined" && blocked(currentPath())) return null;
  scrubValues(event.properties);
  scrubValues(event.$set);
  scrubValues(event.$set_once);
  return event;
}

// Loads PostHog (once), on a page where it's allowed.
export function startTracking() {
  if (!KEY || typeof window === "undefined" || blocked(currentPath())) return null;
  if (loading) return loading;
  loading = import("posthog-js")
    .then((mod) => {
      const posthog = mod.default || mod;
      posthog.init(KEY, {
        api_host: HOST,
        persistence: "localStorage",
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: true,
        disable_capture_url_hashes: true,
        // nothing extra, even if it's switched on in PostHog's settings
        capture_heatmaps: false,
        capture_dead_clicks: false,
        capture_performance: false,
        capture_exceptions: false,
        disable_surveys: true,
        // no feature flags: that request would carry the first address
        // seen, without going through the clean-up below
        advanced_disable_flags: true,
        person_profiles: "identified_only",
        // recordings hide everything typed, and anything marked
        // ph-no-capture (the sign-in sheet, which shows an email address)
        session_recording: { maskAllInputs: true, maskTextSelector: ".ph-no-capture" },
        before_send: scrubEvent,
      });
      ph = posthog;
      rememberRef(posthog);
      if (forgetPending) {
        forgetPending = false;
        forgetTeacher();
      }
      while (queue.length) {
        const [name, props] = queue.shift();
        if (!blocked(currentPath())) ph.capture(name, props);
      }
      return posthog;
    })
    .catch((err) => {
      console.warn("Couldn't start PostHog:", err);
      return null;
    });
  return loading;
}

export function track(name, props) {
  if (!KEY || typeof window === "undefined" || blocked(currentPath())) return;
  const clean = { ...(props || {}) };
  if (ph) {
    ph.capture(name, clean);
    return;
  }
  if (queue.length < 50) queue.push([name, clean]);
  startTracking();
}

// A page view, with the address made safe.
export function trackPage(route) {
  track("$pageview", { $current_url: safeAddress(window.location.origin + route), route });
}

// Screen recordings: only while on the demo board.
export function recordDemo(on) {
  if (!KEY) return;
  const run = (posthog) => {
    if (!posthog) return;
    try {
      if (on) posthog.startSessionRecording();
      else posthog.stopSessionRecording();
    } catch (err) {
      // recordings off in this project: nothing to do
    }
  };
  if (ph) run(ph);
  else if (on) {
    const started = startTracking();
    if (started) started.then(run);
  }
}

// A signed-in teacher: known by their account id from now on, joined up
// with what they did on the demo before signing in.
let identified = null;
export function identifyTeacher(userId) {
  if (!KEY || !userId || identified === userId || typeof window === "undefined" || blocked(currentPath())) return;
  identified = userId;
  const started = ph ? Promise.resolve(ph) : startTracking();
  if (started) {
    started.then((posthog) => {
      if (posthog) posthog.identify(String(userId));
    });
  }
}

// Signed out: the next person on this browser starts as a new visitor.
// (If PostHog isn't loaded yet, this happens as soon as it is.)
let forgetPending = false;
export function forgetTeacher() {
  identified = null;
  if (!KEY || typeof window === "undefined") return;
  if (!ph) {
    forgetPending = true;
    return;
  }
  try {
    if (ph.get_property("$user_state") === "identified") ph.reset();
  } catch (err) {
    // nothing to forget
  }
}
