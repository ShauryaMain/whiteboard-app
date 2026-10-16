"use client";

// Settings ▸ Shortcuts: the keyboard shortcuts (each one changeable: tap
// its key, then press the new one) and the touch-screen gestures.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { setSetting, useSetting } from "@/lib/settings";
import {
  SHORTCUT_ACTIONS, FIXED_SHORTCUTS, GESTURE_ACTIONS,
  keysWith, assignKey, keyFromEvent, keyLabel, isReserved, isValidKey, isMacLike,
} from "@/lib/shortcuts";
import d from "./Dialog.module.css";
import st from "./Settings.module.css";

const noSubscribe = () => () => {};
// a phone or iPad without a keyboard: the gestures come first
const isTouchOnly = () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(hover: none)").matches;

export default function SettingsShortcuts({ Row, Switch, Choice }) {
  const overrides = useSetting("shortcuts");
  const singleKeys = useSetting("singleKeys");
  const gesture2 = useSetting("gesture2");
  const gesture3 = useSetting("gesture3");
  const mac = useSyncExternalStore(noSubscribe, isMacLike, () => false);
  const touchFirst = useSyncExternalStore(noSubscribe, isTouchOnly, () => false);
  const keys = keysWith(overrides);
  const [capturing, setCapturing] = useState(null); // the action waiting for a key
  const [message, setMessage] = useState("");
  const chipRefs = useRef({});

  // While waiting for a key, the next key press is the new shortcut (before
  // anything else sees it: Escape here cancels, it doesn't close Settings).
  useEffect(() => {
    if (!capturing) return undefined;
    const action = capturing;
    const label = SHORTCUT_ACTIONS.find((a) => a.id === action).label;
    function done() {
      setCapturing(null);
      setTimeout(() => {
        const chip = chipRefs.current[action];
        if (chip) chip.focus();
      }, 0);
    }
    function onKey(e) {
      e.preventDefault();
      e.stopPropagation();
      const k = String(e.key || "").toLowerCase();
      if (k === "escape" || k === "tab") {
        setMessage("");
        done();
        return;
      }
      if (k === "backspace" || k === "delete") {
        setSetting("shortcuts", assignKey(overrides, action, "").overrides);
        setMessage(`${label} has no shortcut now.`);
        done();
        return;
      }
      const combo = keyFromEvent(e);
      if (!combo) return; // just Shift, Ctrl… on its own: keep waiting
      if (isReserved(combo) || !isValidKey(combo)) {
        setMessage(`${keyLabel(combo, mac)} is kept for something else. Try another key.`);
        return;
      }
      const { overrides: next, displaced } = assignKey(overrides, action, combo);
      setSetting("shortcuts", next);
      const was = displaced && SHORTCUT_ACTIONS.find((a) => a.id === displaced);
      setMessage(
        was
          ? `${keyLabel(combo, mac)} is ${label} now (it was ${was.label}, which has no shortcut now).`
          : `${label}: ${keyLabel(combo, mac)}.`
      );
      done();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, overrides, mac]);

  const changed = Object.keys(overrides || {}).length > 0;
  const groups = ["Tools", "Edit", "View"];

  const keyboard = (
      <section className={st.section} aria-labelledby="set-keys">
        <h3 id="set-keys" className={st.sectionTitle}>Keyboard</h3>
        <Row label="Single-key shortcuts" sub="Keys like P for the pen and 1–7 for colours. With this off, only the Ctrl / ⌘ ones work.">
          <Switch on={singleKeys} onChange={(v) => setSetting("singleKeys", v)} label="Single-key shortcuts" />
        </Row>
        <p className={st.note}>Tap a key to change it, then press the new key. Backspace leaves it with none, Esc keeps it. Shortcuts never fire while you&apos;re typing.</p>
        {groups.map((group) => (
          <div key={group} className={st.keyGroup} role="group" aria-label={group}>
            <span className={st.keyGroupTitle}>{group}</span>
            {SHORTCUT_ACTIONS.filter((a) => a.group === group).map((a) => {
              const key = keys[a.id];
              const off = key && !singleKeys && !key.startsWith("mod+");
              const waiting = capturing === a.id;
              return (
                <div key={a.id} className={st.keyRow}>
                  <span className={st.keyName}>{a.label}</span>
                  <button
                    type="button"
                    ref={(el) => {
                      chipRefs.current[a.id] = el;
                    }}
                    className={`${st.keyChip} ${waiting ? st.keyChipWaiting : ""} ${!key || off ? st.keyChipNone : ""}`}
                    aria-label={`Change the shortcut for ${a.label}. Now: ${key ? keyLabel(key, mac) : "none"}`}
                    data-shortcut={a.id}
                    onClick={() => {
                      setMessage("");
                      setCapturing(waiting ? null : a.id);
                    }}
                  >
                    {waiting ? "Press a key…" : key ? keyLabel(key, mac) : "None"}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
        <div className={st.keyGroup} role="group" aria-label="Always there">
          <span className={st.keyGroupTitle}>Always there</span>
          {FIXED_SHORTCUTS.map(([key, what]) => (
            <div key={key} className={st.keyRow}>
              <span className={st.keyName}>{what}</span>
              <span className={`${st.keyChip} ${st.keyChipFixed}`}>{keyLabel(key, mac)}</span>
            </div>
          ))}
        </div>
        <p className={st.status} role="status" aria-live="polite">
          {message}
        </p>
        <div className={st.buttons}>
          <button
            type="button"
            className={d.btn}
            disabled={!changed}
            onClick={() => {
              setSetting("shortcuts", {});
              setMessage("Shortcuts are back to how they started.");
            }}
          >
            Reset shortcuts
          </button>
        </div>
      </section>
  );

  const gestures = (
      <section className={st.section} aria-labelledby="set-gestures">
        <h3 id="set-gestures" className={st.sectionTitle}>Touch gestures</h3>
        <p className={st.note}>On an iPad, phone or touch screen: tap the board with your fingers, without moving them. A tap never draws anything.</p>
        <Row label="Two-finger tap">
          <Choice label="Two-finger tap" value={gesture2} options={GESTURE_ACTIONS} onChange={(v) => setSetting("gesture2", v)} />
        </Row>
        <Row label="Three-finger tap">
          <Choice label="Three-finger tap" value={gesture3} options={GESTURE_ACTIONS} onChange={(v) => setSetting("gesture3", v)} />
        </Row>
        {(gesture2 !== "undo" || gesture3 !== "redo") && (
          <div className={st.buttons}>
            <button
              type="button"
              className={d.btn}
              onClick={() => {
                setSetting("gesture2", "undo");
                setSetting("gesture3", "redo");
              }}
            >
              Back to undo / redo
            </button>
          </div>
        )}
      </section>
  );

  return touchFirst ? (
    <>
      {gestures}
      {keyboard}
    </>
  ) : (
    <>
      {keyboard}
      {gestures}
    </>
  );
}


