"use client";

import { useSyncExternalStore } from "react";
import Whiteboard from "@/components/Whiteboard";
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
  if (!ready) {
    return (
      <div className={p.screen}>
        <div role="status" className={p.hand}>
          Opening the demo board…
        </div>
      </div>
    );
  }
  return <Whiteboard boardId={DEMO_BOARD_ID} demo />;
}
