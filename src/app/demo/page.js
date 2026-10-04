"use client";

import { useState, useSyncExternalStore } from "react";
import Whiteboard from "@/components/Whiteboard";
import TourGuide from "@/components/TourGuide";
import { TOURS } from "@/lib/tours";
import { supabase } from "@/lib/supabaseClient";
import { DEMO_BOARD_ID } from "@/lib/demoBackend";
import p from "@/components/Paper.module.css";

// The demo board: the real whiteboard, with no sign-in. It runs on the
// in-memory stand-in backend (src/lib/demoBackend.js), so nothing drawn
// here is saved or sent anywhere.

const subscribe = () => () => {};
const demoReady = () => supabase.__demo === true;
const notOnServer = () => false;

export default function DemoPage() {
  // Only show the board once this tab is confirmed to be on the stand-in
  // backend. (If it somehow isn't, AuthContext reloads the page.)
  const ready = useSyncExternalStore(subscribe, demoReady, notOnServer);
  // "Try a live class" starts a short walkthrough of the pretend class.
  const [classTour, setClassTour] = useState(0);
  if (!ready) {
    return (
      <div className={p.screen}>
        <div role="status" className={p.hand}>
          Opening the demo board…
        </div>
      </div>
    );
  }
  return (
    <>
      <Whiteboard boardId={DEMO_BOARD_ID} demo onDemoClassStart={() => setClassTour((n) => (n > 0 ? n + 1 : 1))} onDemoClassEnd={() => setClassTour(-1)} />
      {classTour > 0 && <TourGuide key={classTour} tour={TOURS.demoClass} onEnd={() => setClassTour(-1)} />}
    </>
  );
}
