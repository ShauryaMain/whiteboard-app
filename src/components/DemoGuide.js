"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Compass, Copy, GraduationCap, Laptop, Users, X } from "lucide-react";
import { DEMO_CHANGE_EVENT } from "@/lib/demoBackend";
import { supabase } from "@/lib/supabaseClient";
import { DEMO_SIGNIN_EVENT, DEMO_LEAVE_EVENT } from "@/lib/demoEvents";
import { track } from "@/lib/track";
import SignInSheet from "./SignInSheet";
import o from "./Onboarding.module.css";

// The demo board's guide: the "What are you planning?" opener, and the
// small notes that offer to keep the visitor's board at the moments it's
// worth keeping (with a "Later" that just closes them), the summary at the
// end of the pretend class, and the sign-in sheet they all lead to.

const CHOICES = [
  {
    kind: "class",
    Icon: Users,
    title: "A lesson for my class",
    sub: "Solving linear equations, with the worksheet beside the board and a pretend class to try.",
  },
  {
    kind: "tutor",
    Icon: GraduationCap,
    title: "A 1:1 tutoring session",
    sub: "Straight-line graphs, on axes that snap your points onto the grid.",
  },
  {
    kind: "explore",
    Icon: Compass,
    title: "Just looking around",
    sub: "A quick tour of the board and its tools.",
  },
];

// A phone-sized screen (Clean Slate is made for a laptop or an iPad).
export function isPhoneScreen() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(max-width: 640px)").matches;
}

export function DemoOpener({ onChoose }) {
  const phone = isPhoneScreen();
  return (
    <div className={o.openerScreen}>
      <section className={o.opener} aria-labelledby="demo-opener-title" data-demo-opener="true">
        <div className={o.openerHead}>
          <span className={o.kicker}>Clean Slate · free whiteboard for teaching</span>
          <h1 id="demo-opener-title" className={o.openerTitle}>What are you planning?</h1>
          <p className={o.openerText}>
            Pick one and you get a real board to try, ready to go. Nothing to install, no sign-in.
            {phone ? " It's made for a laptop or an iPad, but have a look here." : ""}
          </p>
        </div>
        <div className={o.choices} role="group" aria-label="Start with">
          {CHOICES.map(({ kind, Icon, title, sub }, i) => (
            <button key={kind} type="button" className={`${o.choice} ${i === 0 ? o.choicePrimary : ""}`} onClick={() => onChoose(kind)} data-demo-choice={kind}>
              <span className={o.choiceIcon} aria-hidden="true">
                <Icon size={21} strokeWidth={1.9} />
              </span>
              <span className={o.choiceText}>
                <span className={o.choiceTitle}>{title}</span>
                <span className={o.choiceSub}>{sub}</span>
              </span>
              <ArrowRight size={18} className={o.choiceArrow} aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className={o.openerFoot}>
          <span>
            {/* full page loads: the app runs on its real backend (see supabaseClient.js) */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            Joining a class as a student? <a href="/join">Enter your class code</a>
          </span>
          <span>
            {/* a full page load: the app runs on its real backend (see supabaseClient.js) */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            Have an account? <a href="/">Sign in</a>
          </span>
        </div>
      </section>
    </div>
  );
}

// "14 pen strokes and 2 text boxes"
function describeWork(work) {
  const parts = [];
  if (work.strokes) parts.push(`${work.strokes} pen ${work.strokes === 1 ? "stroke" : "strokes"}`);
  if (work.texts) parts.push(`${work.texts} text ${work.texts === 1 ? "box" : "boxes"}`);
  if (!parts.length) return "your work";
  return parts.join(" and ");
}

const amount = (work) => (work ? work.strokes + work.texts : 0);

// Whether the board is kept in this browser right now (storage can be full
// or switched off, as in some private windows).
function keptHere() {
  return typeof supabase.__kept === "function" ? supabase.__kept() : false;
}

// How much work, and how long on the page, before offering to keep it.
const WORK_FOR_PROMPT = 12;
const TIME_FOR_PROMPT_MS = 45 * 1000;
const IDLE_MS = 2500; // only once they've stopped writing for a moment
const QUIET_AFTER_LATER_MS = 90 * 1000;

export default function DemoGuide({ kind, restored, classTourRunning, classFinished }) {
  const phone = isPhoneScreen();
  // the note on show: { trigger } | null
  const [note, setNote] = useState(() => (restored ? { trigger: "return" } : phone ? { trigger: "phone" } : null));
  const [sheet, setSheet] = useState(null); // { trigger, next } | null
  const [work, setWork] = useState(null);
  const [copied, setCopied] = useState(false);
  const shown = useRef(new Set(restored ? ["return"] : phone ? ["phone"] : []));
  const openedAt = useRef(0);
  const quietUntil = useRef(0);
  const idleTimer = useRef(null);
  const firstChange = useRef(false);
  const workRef = useRef(typeof supabase.__work === "function" ? supabase.__work() : null);
  const busy = useRef({ sheet: false, tour: false });
  const copiedTimer = useRef(null);
  // a worksheet is open beside the board (the class lesson has one; they
  // may upload their own). It can't come along when they sign in.
  const [worksheet, setWorksheet] = useState(kind === "class");

  useEffect(() => {
    busy.current = { sheet: !!sheet, tour: !!classTourRunning };
  }, [sheet, classTourRunning]);

  // offer to keep the board (each kind of moment once)
  function offer(trigger) {
    if (shown.current.has(trigger) || busy.current.sheet) return;
    if (trigger !== "class_end" && (busy.current.tour || Date.now() < quietUntil.current)) return;
    shown.current.add(trigger);
    setNote({ trigger });
    track("signin_prompt_shown", { trigger, kind });
  }

  useEffect(() => {
    openedAt.current = Date.now();
    if (restored) track("signin_prompt_shown", { trigger: "return", kind });
    else if (phone) track("signin_prompt_shown", { trigger: "phone", kind });

    function onChange(e) {
      const detail = (e && e.detail) || {};
      if (detail.upload === "reference-docs") setWorksheet(true);
      if (detail.work) {
        workRef.current = detail.work;
        setWork(detail.work);
      }
      if (!firstChange.current && amount(detail.work) > 0) {
        firstChange.current = true;
        track("demo_first_change", { kind });
      }
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => {
        if (amount(detail.work) >= WORK_FOR_PROMPT && Date.now() - openedAt.current >= TIME_FOR_PROMPT_MS) offer("work");
      }, IDLE_MS);
    }
    function onSignIn(e) {
      e.preventDefault();
      setNote(null);
      setSheet({ trigger: "toolbar", next: null });
    }
    function onLeave(e) {
      const w = workRef.current;
      if (shown.current.has("leave") || !w || amount(w) + (w.kept || 0) === 0) return;
      e.preventDefault();
      // keep the very latest before saying whether it's kept
      if (typeof supabase.__keepNow === "function") supabase.__keepNow();
      shown.current.add("leave");
      setNote({ trigger: "leave" });
      track("signin_prompt_shown", { trigger: "leave", kind });
    }
    window.addEventListener(DEMO_CHANGE_EVENT, onChange);
    window.addEventListener(DEMO_SIGNIN_EVENT, onSignIn);
    window.addEventListener(DEMO_LEAVE_EVENT, onLeave);
    return () => {
      window.removeEventListener(DEMO_CHANGE_EVENT, onChange);
      window.removeEventListener(DEMO_SIGNIN_EVENT, onSignIn);
      window.removeEventListener(DEMO_LEAVE_EVENT, onLeave);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the end of the pretend class
  useEffect(() => {
    if (!classFinished || shown.current.has("class_end")) return;
    shown.current.add("class_end");
    setNote({ trigger: "class_end" });
    track("demo_class_finished", { kind });
    track("signin_prompt_shown", { trigger: "class_end", kind });
  }, [classFinished, kind]);

  function answer(trigger, choice) {
    track("signin_prompt_answered", { trigger, answer: choice, kind });
    setNote(null);
    if (choice === "keep") {
      setSheet({ trigger, next: trigger === "class_end" ? "class" : null });
    } else if (choice === "leave") {
      window.location.assign("/");
    } else if (choice === "new") {
      // back to "What are you planning?" (the kept board is replaced once
      // they change the new one)
      window.location.assign("/demo?start=new");
    } else {
      quietUntil.current = Date.now() + QUIET_AFTER_LATER_MS;
    }
  }

  function copyLink() {
    const url = `${window.location.origin}/demo?start=${kind}`;
    track("phone_link_copied", { kind });
    const done = () => {
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2500);
    };
    try {
      navigator.clipboard.writeText(url).then(done, () => window.prompt("Copy this link:", url));
    } catch (err) {
      window.prompt("Copy this link:", url);
    }
  }

  let card = null;
  if (note && !sheet) {
    const t = note.trigger;
    const close = (
      <button type="button" className={o.noteClose} onClick={() => answer(t, "later")} aria-label="Close">
        <X size={16} />
      </button>
    );
    if (t === "class_end") {
      card = (
        <div className={`${o.note} ${o.noteBlue}`} role="dialog" aria-labelledby="demo-note-title" data-demo-note={t}>
          {close}
          <h2 id="demo-note-title" className={o.noteTitle}>That&apos;s a live class</h2>
          {classFinished === "full" && (
            <ul className={o.stats}>
              <li>5 students joined</li>
              <li>you pinned a comment</li>
            </ul>
          )}
          <p className={o.noteText}>With your own class, every student works on their own device, with no accounts, and you see all of them at once.</p>
          <div className={o.noteActions}>
            <button type="button" className={`${o.noteBtn} ${o.noteBtnPrimary}`} onClick={() => answer(t, "keep")}>
              Set this up for my next lesson
            </button>
            <button type="button" className={o.noteBtn} onClick={() => answer(t, "later")}>
              Later
            </button>
          </div>
        </div>
      );
    } else if (t === "return") {
      card = (
        <div className={`${o.note} ${o.noteBlue}`} role="dialog" aria-labelledby="demo-note-title" data-demo-note={t}>
          {close}
          <h2 id="demo-note-title" className={o.noteTitle}>Welcome back</h2>
          <p className={o.noteText}>Your board is just as you left it, kept in this browser. Sign in free to keep it on every device.</p>
          <div className={o.noteActions}>
            <button type="button" className={`${o.noteBtn} ${o.noteBtnPrimary}`} onClick={() => answer(t, "keep")}>
              Keep it, free
            </button>
            <button type="button" className={o.noteBtn} onClick={() => answer(t, "later")}>
              Later
            </button>
            <button type="button" className={o.textBtn} onClick={() => answer(t, "new")}>
              Start a new board
            </button>
          </div>
        </div>
      );
    } else if (t === "phone") {
      card = (
        <div className={o.note} role="dialog" aria-labelledby="demo-note-title" data-demo-note={t}>
          {close}
          <h2 id="demo-note-title" className={o.noteTitle}>On a phone?</h2>
          <p className={o.noteText}>Clean Slate is made for a laptop or an iPad, with a pen. Have a look here. To carry on there, keep this board, or copy the link to try the demo there.</p>
          <div className={o.noteActions}>
            <button type="button" className={`${o.noteBtn} ${o.noteBtnPrimary}`} onClick={() => answer(t, "keep")}>
              <Laptop size={15} aria-hidden="true" /> Keep it for my laptop
            </button>
            <button type="button" className={o.noteBtn} onClick={copyLink}>
              <Copy size={15} aria-hidden="true" /> {copied ? "Link copied" : "Copy link"}
            </button>
          </div>
        </div>
      );
    } else if (t === "leave") {
      card = (
        <div className={o.note} role="dialog" aria-labelledby="demo-note-title" data-demo-note={t}>
          {close}
          <h2 id="demo-note-title" className={o.noteTitle}>Leaving the demo?</h2>
          <p className={o.noteText}>
            {keptHere()
              ? "Your board is kept in this browser for now, so it should be here if you come back soon. Sign in free to keep it for good, on every device."
              : "This browser isn't keeping your board, so it goes when you leave. Sign in free to keep it, on every device."}
          </p>
          <div className={o.noteActions}>
            <button type="button" className={`${o.noteBtn} ${o.noteBtnPrimary}`} onClick={() => answer(t, "keep")}>
              Keep it, free
            </button>
            <button type="button" className={o.noteBtn} onClick={() => answer(t, "leave")}>
              Leave
            </button>
          </div>
        </div>
      );
    } else {
      card = (
        <div className={o.note} role="dialog" aria-labelledby="demo-note-title" data-demo-note={t}>
          {close}
          <h2 id="demo-note-title" className={o.noteTitle}>Keep this board for your lesson?</h2>
          <p className={o.noteText}>
            You&apos;ve added {describeWork(work || {})}.{keptHere() ? " It's kept in this browser for now." : ""} Sign in free to keep it on every device.
          </p>
          <div className={o.noteActions}>
            <button type="button" className={`${o.noteBtn} ${o.noteBtnPrimary}`} onClick={() => answer(t, "keep")}>
              Keep it, free
            </button>
            <button type="button" className={o.noteBtn} onClick={() => answer(t, "later")}>
              Later
            </button>
          </div>
        </div>
      );
    }
  }

  return (
    <>
      {card}
      {sheet && (
        <SignInSheet
          trigger={sheet.trigger}
          next={sheet.next}
          pictures={work ? work.pictures : 0}
          worksheet={worksheet}
          onClose={() => {
            setSheet(null);
            quietUntil.current = Date.now() + QUIET_AFTER_LATER_MS;
          }}
        />
      )}
    </>
  );
}
