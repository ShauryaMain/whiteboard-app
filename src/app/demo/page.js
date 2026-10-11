"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import Whiteboard from "@/components/Whiteboard";
import TourGuide from "@/components/TourGuide";
import DemoGuide, { DemoOpener } from "@/components/DemoGuide";
import { TOURS } from "@/lib/tours";
import { supabase } from "@/lib/supabaseClient";
import { DEMO_BOARD_ID, DEMO_KINDS, DEMO_WORKSHEET } from "@/lib/demoBackend";
import { readDemoStash, rememberPersona } from "@/lib/demoStash";
import { track } from "@/lib/track";
import p from "@/components/Paper.module.css";

// The demo board: the real whiteboard, with no sign-in. It runs on the
// in-memory stand-in backend (src/lib/demoBackend.js), and the visitor's
// board is kept in this browser as they work (demoStash.js).
//
// It opens on "What are you planning?" (DemoGuide.js), unless:
//   - the visitor has a board kept from an earlier visit (it opens again,
//     with a "welcome back" note), or
//   - the link says where to start: /demo?start=class | tutor | explore
//     (this wins over a kept board; /demo?start=new always asks)

const subscribe = () => () => {};
const demoReady = () => supabase.__demo === true;
const notOnServer = () => false;

// Worked out once, the first time the page draws on this device.
let plan = null;
function startPlan() {
  if (plan) return plan;
  const asked = new URLSearchParams(window.location.search).get("start");
  if (DEMO_KINDS.includes(asked)) {
    // a link that says where to start wins (a board kept from before is
    // replaced once they change this one)
    plan = { kind: supabase.__start(asked), restored: false };
    rememberPersona(asked);
  } else if (asked !== "new" && readDemoStash()) {
    const kind = supabase.__start("restore");
    plan = { kind, restored: true };
  } else {
    // "What are you planning?" (?start=new: "Start a new board" on the
    // welcome-back note)
    plan = { kind: null, restored: false };
  }
  track("demo_opened", { restored: plan.restored, start: plan.kind || "ask" });
  return plan;
}

export default function DemoPage() {
  // Only show the board once this tab is confirmed to be on the stand-in
  // backend. (If it somehow isn't, AuthContext reloads the page.)
  const ready = useSyncExternalStore(subscribe, demoReady, notOnServer);
  // the answer to "What are you planning?"
  const [chosen, setChosen] = useState(null);
  // "Try a live class" starts a short walkthrough of the pretend class.
  const [classTour, setClassTour] = useState(0);
  const [classStep, setClassStep] = useState(null);
  // how the pretend class ended: null (it hasn't), "full" (they got as far
  // as pinning a comment) or "short" (ended before that)
  const [classFinished, setClassFinished] = useState(null);
  const classStepRef = useRef(null);

  if (!ready) {
    return (
      <div className={p.screen}>
        <div role="status" className={p.hand}>
          Opening the demo board…
        </div>
      </div>
    );
  }

  const start = startPlan();
  const kind = start.kind || chosen;

  if (!kind) {
    return (
      <DemoOpener
        onChoose={(choice) => {
          const k = supabase.__start(choice);
          rememberPersona(choice);
          track("demo_start_chosen", { choice });
          setChosen(k);
        }}
      />
    );
  }

  function endClassTour() {
    setClassTour(-1);
    // the walkthrough got to the end: the class summary follows
    if (classStep === "done") setClassFinished("full");
  }

  return (
    <>
      <Whiteboard
        boardId={DEMO_BOARD_ID}
        demo
        initialReferenceDoc={kind === "class" ? DEMO_WORKSHEET : null}
        onDemoClassStart={() => {
          track("demo_class_started", { kind });
          setClassTour((n) => (n > 0 ? n + 1 : 1));
        }}
        onDemoClassEnd={() => {
          setClassTour(-1);
          setClassFinished(classStepRef.current === "done" ? "full" : "short");
        }}
      />
      {classTour > 0 && (
        <TourGuide
          key={classTour}
          tour={TOURS.demoClass}
          onEnd={endClassTour}
          onStep={(step) => {
            setClassStep(step);
            classStepRef.current = step;
            track("demo_class_step", { step });
          }}
        />
      )}
      <DemoGuide kind={kind} restored={start.restored} classTourRunning={classTour > 0} classFinished={classFinished} />
    </>
  );
}
