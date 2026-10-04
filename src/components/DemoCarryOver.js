"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { bringAcross, dismissDemoCarry, getDemoCarry, getServerDemoCarry, subscribeDemoCarry } from "@/lib/demoCarry";
import d from "./Dialog.module.css";
import p from "./Paper.module.css";

// Shown on the boards page. If someone pressed "Sign in free to keep your
// work" on the demo board, this saves that board into their account as
// soon as they're signed in, then opens it. (See src/lib/demoCarry.js.)
export default function DemoCarryOver({ userId }) {
  const router = useRouter();
  const carry = useSyncExternalStore(subscribeDemoCarry, getDemoCarry, getServerDemoCarry);
  // Saved, and the new board is on its way to opening.
  const [opening, setOpening] = useState(false);

  // Still on screen? (Saving takes a moment; don't open the board if the
  // person has gone elsewhere in the meantime.)
  const onScreen = useRef(true);
  useEffect(() => {
    onScreen.current = true;
    return () => {
      onScreen.current = false;
    };
  }, []);

  function save() {
    bringAcross(userId).then((boardId) => {
      if (!onScreen.current || !boardId) return;
      setOpening(true);
      router.push(`/board/${boardId}`);
    });
  }

  useEffect(() => {
    if (userId && carry === "waiting") save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, carry]);

  if (carry === "none" && !opening) return null;

  if (carry === "failed") {
    return (
      <div className={d.overlay} role="alertdialog" aria-modal="true" aria-labelledby="carry-title">
        <div className={d.card}>
          <div className={d.header}>
            <div className={d.titleBlock}>
              <h2 id="carry-title" className={d.title}>Your demo board couldn&apos;t be saved</h2>
              <p className={d.subtitle}>
                It&apos;s still kept on this device. Check your connection and try again, or carry on without it.
              </p>
            </div>
          </div>
          <div className={d.actions}>
            <button type="button" className={d.btn} onClick={dismissDemoCarry}>
              Carry on without it
            </button>
            <button
              type="button"
              className={`${d.btn} ${d.btnPrimary}`}
              onClick={save}
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // waiting, saving or opening: cover the boards page for the moment it takes
  return (
    <div className={p.screen} style={{ position: "fixed", inset: 0, zIndex: 200 }}>
      <div role="status" className={p.hand}>
        Bringing your demo board across…
      </div>
    </div>
  );
}
