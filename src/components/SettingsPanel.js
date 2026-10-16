"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Info, LogOut, RotateCcw, Trash2, X } from "lucide-react";
import {
  DISPLAY_NAME_MAX, PEN_COLORS, PEN_SIZE_MAX, PEN_SIZE_MIN,
  cleanDisplayName, displayNameFor, flushSettings, forgetSettings, getServerSettingsWhere, getSettingsWhere,
  resetSettings, setSetting, subscribeSettings, useSetting,
} from "@/lib/settings";
import { getPencilOnly, getServerPrefSnapshot, setPencilOnly, subscribePencilPrefs } from "@/lib/pencilPrefs";
import { BOARD_BACKGROUNDS, backgroundCss } from "@/lib/boardBackground";
import { supabase } from "@/lib/supabaseClient";
import { LANDING_URL } from "@/lib/links";
import SettingsExplainer from "./SettingsExplainer";
import SettingsShortcuts from "./SettingsShortcuts";
import { POINTER_STYLES } from "@/lib/boardCursor";
import d from "./Dialog.module.css";
import st from "./Settings.module.css";

// The Settings panel: opened from the account menu on the boards page, or
// the gear beside the home button on a board. Changes apply straight away
// and are kept with the account (settings.js).
//
//   user      the signed-in teacher (null on the demo board: no Account part)
//   signOut   from AuthContext
//   onClose

function InfoButton({ name, label, onOpen }) {
  return (
    <button type="button" className={st.info} onClick={() => onOpen(name)} aria-label={`What is ${label}?`} title={`What is ${label}?`} data-settings-info={name}>
      <Info size={15} strokeWidth={2.2} aria-hidden="true" />
    </button>
  );
}

function Switch({ on, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`${st.switch} ${on ? st.switchOn : ""}`}
      onClick={() => onChange(!on)}
    />
  );
}

function Choice({ value, options, onChange, label, disabled }) {
  return (
    <div className={st.seg} role="radiogroup" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} disabled={disabled} onClick={() => onChange(id)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Row({ label, sub, info, onInfo, children }) {
  return (
    // an on/off switch stays beside its label, even on a phone
    <div className={`${st.row} ${children && children.type === Switch ? st.rowSwitch : ""}`}>
      <div className={st.rowText}>
        <span className={st.rowLabel}>
          {label}
          {info && <InfoButton name={info} label={label.toLowerCase()} onOpen={onInfo} />}
        </span>
        {sub && <span className={st.rowSub}>{sub}</span>}
      </div>
      {children}
    </div>
  );
}

const WHERE_TEXT = {
  account: "Saved to your account",
  saving: "Saving…",
  device: "Saved on this device",
};

export default function SettingsPanel({ user, signOut, onClose, initialTab = "board" }) {
  const scribbleErase = useSetting("scribbleErase");
  const scribbleLevel = useSetting("scribbleLevel");
  const eraserMode = useSetting("eraserMode");
  const moveReturns = useSetting("moveReturns");
  const showHints = useSetting("showHints");
  const nameTags = useSetting("nameTags");
  const pointerStyle = useSetting("pointerStyle");
  const rulerUnits = useSetting("rulerUnits");
  const [tab, setTab] = useState(initialTab === "shortcuts" ? "shortcuts" : "board");
  const calcAngle = useSetting("calcAngle");
  const paper = useSetting("paper");
  const penColor = useSetting("penColor");
  const penSize = useSetting("penSize");
  const pencilOnly = useSyncExternalStore(subscribePencilPrefs, getPencilOnly, getServerPrefSnapshot);
  const where = useSyncExternalStore(subscribeSettings, getSettingsWhere, getServerSettingsWhere);
  const [explain, setExplain] = useState(null);
  const closeRef = useRef(null);
  const signedIn = !!(user && user.id && user.id !== "demo-user");

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Keyboard: focus starts on Close, Tab stays inside the panel (or the
  // explainer, when one is open), Escape closes, and focus goes back to
  // where it was when the panel closes.
  useEffect(() => {
    const opener = document.activeElement;
    if (closeRef.current) closeRef.current.focus();
    function onKey(e) {
      const explainer = document.querySelector("[data-settings-explainer]");
      if (e.key === "Escape" && !explainer) {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const box = explainer || document.querySelector("[data-settings-panel]");
      if (!box) return;
      const items = [...box.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!box.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // (the account menu item that opened it has gone: use the account
      // button, or the gear on a board)
      const back = opener && opener !== document.body && opener.isConnected ? opener : document.querySelector('[data-open-settings="true"], button[aria-label="Account"]');
      if (back && typeof back.focus === "function") back.focus();
    };
  }, []);

  // closing an explainer puts focus back on its (i)
  const lastInfo = useRef(null);
  function openExplainer(name) {
    lastInfo.current = name;
    setExplain(name);
  }
  function closeExplainer() {
    setExplain(null);
    const name = lastInfo.current;
    setTimeout(() => {
      const btn = document.querySelector(`[data-settings-info="${name}"]`);
      if (btn) btn.focus();
    }, 0);
  }

  // on top of everything, including the board's toolbar
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className={d.overlay}
      style={{ zIndex: 330 }}
      data-board-shortcuts="off"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`${d.card} ${st.card}`} role="dialog" aria-modal="true" aria-labelledby="settings-title" data-settings-panel="true">
        <div className={st.top}>
          <h2 id="settings-title" className={st.topTitle}>Settings</h2>
          <span className={`${st.saved} ${where === "account" ? st.savedAccount : ""}`} role="status" data-settings-where={where}>
            {signedIn ? WHERE_TEXT[where] : "Saved on this device"}
          </span>
          <button type="button" ref={closeRef} className={d.close} onClick={onClose} aria-label="Close settings">
            <X size={16} />
          </button>
        </div>

        <div className={st.tabs} role="tablist" aria-label="Settings">
          {[["board", "Board"], ["shortcuts", "Shortcuts"]].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`set-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="set-tabpanel"
              tabIndex={tab === id ? 0 : -1}
              className={`${st.tab} ${tab === id ? st.tabOn : ""}`}
              onClick={() => setTab(id)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                const next = tab === "board" ? "shortcuts" : "board";
                setTab(next);
                setTimeout(() => {
                  const el = document.getElementById(`set-tab-${next}`);
                  if (el) el.focus();
                }, 0);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={st.body} role="tabpanel" id="set-tabpanel" aria-labelledby={`set-tab-${tab}`}>
          {tab === "shortcuts" ? (
            <SettingsShortcuts Row={Row} Switch={Switch} Choice={Choice} />
          ) : (
          <>
          <section className={st.section} aria-labelledby="set-draw">
            <h3 id="set-draw" className={st.sectionTitle}>Drawing &amp; erasing</h3>
            <Row label="Scribble to erase" sub="Scribble back and forth over a mistake with the pen to rub it out." info="scribble" onInfo={openExplainer}>
              <Switch on={scribbleErase} onChange={(v) => setSetting("scribbleErase", v)} label="Scribble to erase" />
            </Row>
            <Row label="How easily a scribble erases" sub={scribbleErase ? null : "Turn on Scribble to erase to use this."} info="sensitivity" onInfo={openExplainer}>
              <Choice
                label="How easily a scribble erases"
                value={scribbleLevel}
                disabled={!scribbleErase}
                options={[["gentle", "Gentle"], ["normal", "Normal"], ["eager", "Eager"]]}
                onChange={(v) => setSetting("scribbleLevel", v)}
              />
            </Row>
            <Row label="Eraser" info="eraser" onInfo={openExplainer}>
              <Choice
                label="Eraser"
                value={eraserMode}
                options={[["precise", "Precise"], ["stroke", "Whole stroke"]]}
                onChange={(v) => setSetting("eraserMode", v)}
              />
            </Row>
            <Row label="Pencil only" sub="On this device only." info="pencil" onInfo={openExplainer}>
              <Switch on={pencilOnly} onChange={(v) => setPencilOnly(v)} label="Pencil only" />
            </Row>
          </section>

          <section className={st.section} aria-labelledby="set-tools">
            <h3 id="set-tools" className={st.sectionTitle}>Tools</h3>
            <Row label="After moving the board" info="move" onInfo={openExplainer}>
              <Choice
                label="After moving the board"
                value={moveReturns ? "back" : "stay"}
                options={[["back", "Back to my tool"], ["stay", "Stay on Move"]]}
                onChange={(v) => setSetting("moveReturns", v === "back")}
              />
            </Row>
            <Row label="Pointer on the board" sub="Brush size shows a ring as big as the pen, highlighter or eraser, in the ink colour. Tool icon shows a little pen or eraser instead.">
              <Choice
                label="Pointer on the board"
                value={pointerStyle}
                options={POINTER_STYLES}
                onChange={(v) => setSetting("pointerStyle", v)}
              />
            </Row>
            <Row label="Ruler marks">
              <Choice
                label="Ruler marks"
                value={rulerUnits}
                options={[["cm", "Centimetres"], ["in", "Inches"]]}
                onChange={(v) => setSetting("rulerUnits", v)}
              />
            </Row>
            <Row label="Tool hints" sub="The line beside the tools that says what each one does (on wider screens)." info="hints" onInfo={openExplainer}>
              <Switch on={showHints} onChange={(v) => setSetting("showHints", v)} label="Tool hints" />
            </Row>
            <Row label="Names on other people's pens" sub="When someone else is writing on your board, a little tag with their name follows their pen.">
              <Switch on={nameTags} onChange={(v) => setSetting("nameTags", v)} label="Names on other people's pens" />
            </Row>
            <Row label="Calculator angles">
              <Choice
                label="Calculator angles"
                value={calcAngle}
                options={[["deg", "Degrees"], ["rad", "Radians"]]}
                onChange={(v) => setSetting("calcAngle", v)}
              />
            </Row>
          </section>

          <section className={st.section} aria-labelledby="set-new">
            <h3 id="set-new" className={st.sectionTitle}>New boards</h3>
            <div className={`${st.row} ${st.rowStack}`}>
              <span className={st.rowLabel}>Paper</span>
              <div className={st.choices} role="radiogroup" aria-label="Paper for new boards">
                {BOARD_BACKGROUNDS.map((bg) => (
                  <button
                    key={bg.id}
                    type="button"
                    role="radio"
                    aria-checked={paper === bg.id}
                    className={`${st.paper} ${paper === bg.id ? st.paperOn : ""}`}
                    onClick={() => setSetting("paper", bg.id)}
                    title={bg.desc}
                  >
                    <span className={st.paperPreview} style={backgroundCss(bg.id, 0.6, { x: 4, y: 4 })} />
                    {bg.label}
                  </button>
                ))}
              </div>
            </div>
            <div className={`${st.row} ${st.rowStack}`}>
              <span className={st.rowLabel}>Pen colour</span>
              <div className={st.choices} role="radiogroup" aria-label="Pen colour to start with">
                {PEN_COLORS.map(([name, hex]) => (
                  <button
                    key={hex}
                    type="button"
                    role="radio"
                    aria-checked={penColor === hex}
                    aria-label={name}
                    title={name}
                    className={`${st.swatch} ${penColor === hex ? st.swatchOn : ""}`}
                    style={{ background: hex }}
                    onClick={() => setSetting("penColor", hex)}
                  />
                ))}
              </div>
            </div>
            <div className={`${st.row} ${st.rowStack}`}>
              <label className={st.rowLabel} htmlFor="set-pen-size">Pen size</label>
              <div className={st.sizeRow}>
                <input
                  id="set-pen-size"
                  type="range"
                  min={PEN_SIZE_MIN}
                  max={PEN_SIZE_MAX}
                  value={penSize}
                  onChange={(e) => setSetting("penSize", Math.round(Number(e.target.value)))}
                />
                <span className={st.sizeValue}>{penSize}</span>
                <span className={st.sizeDot} aria-hidden="true">
                  <span style={{ width: Math.min(penSize, 40), height: Math.min(penSize, 40), borderRadius: "50%", background: penColor }} />
                </span>
              </div>
            </div>
            <p className={st.note}>Boards you open from now on start with these. You can still change them on any board.</p>
          </section>

          {signedIn ? (
            <AccountSection user={user} signOut={signOut} onClose={onClose} />
          ) : (
            <section className={st.section}>
              <p className={st.note}>These are kept in this browser. Sign in and they&apos;re kept with your account, on every device.</p>
            </section>
          )}
          </>
          )}
        </div>
      </div>
      {explain && <SettingsExplainer name={explain} onClose={closeExplainer} />}
    </div>,
    document.body
  );
}

// Asks the server to delete the account. Resolves to "ok" or an error name.
async function sendDelete(token, confirm) {
  try {
    const res = await fetch("/api/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ confirm }),
    });
    const body = await res.json().catch(() => ({}));
    return res.ok && body.ok ? "ok" : body.error || "failed";
  } catch (err) {
    return "failed";
  }
}

function AccountSection({ user, signOut, onClose }) {
  const [name, setName] = useState(() => displayNameFor(user));
  const [nameNote, setNameNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [problem, setProblem] = useState("");
  const provider = (user.app_metadata && user.app_metadata.provider) || "";
  const via = provider === "google" ? "Google" : provider === "email" ? "an email code" : "";

  function saveName(e) {
    e.preventDefault();
    const clean = cleanDisplayName(name);
    setName(clean);
    setSetting("displayName", clean);
    setNameNote(clean ? "Saved." : "Cleared: your Google name or email is shown instead.");
  }

  async function doSignOut() {
    await flushSettings();
    onClose();
    if (signOut) await signOut();
  }

  function deleteFailed(reason) {
    setDeleting(false);
    setProblem(
      reason === "signed_out"
        ? "You've been signed out. Sign in again, then try once more."
        : "Your account couldn't be deleted just now. Try again in a minute, or email cleanslatesupportoffical@gmail.com and we'll do it for you."
    );
  }

  async function deleteAccount() {
    if (deleting) return;
    setDeleting(true);
    setProblem("");
    const { data } = await supabase.auth.getSession().catch(() => ({ data: null }));
    const token = data && data.session && data.session.access_token;
    if (!token) return deleteFailed("signed_out");
    const result = await sendDelete(token, confirmText);
    if (result !== "ok") return deleteFailed(result);
    // the account is gone: forget its settings and session on this device
    forgetSettings();
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    window.location.assign(LANDING_URL);
  }

  return (
    <section className={st.section} aria-labelledby="set-account">
      <h3 id="set-account" className={st.sectionTitle}>Account</h3>
      <form className={`${st.row} ${st.rowStack}`} onSubmit={saveName}>
        <label className={st.rowLabel} htmlFor="set-name">Your name</label>
        <span className={st.rowSub}>Shown on your boards page and in emails from Clean Slate. Students don&apos;t see it.</span>
        <div className={st.nameRow}>
          <input
            id="set-name"
            className={d.input}
            value={name}
            maxLength={DISPLAY_NAME_MAX}
            autoComplete="name"
            placeholder="Your name"
            onChange={(e) => {
              setName(e.target.value);
              setNameNote("");
            }}
          />
          <button type="submit" className={`${d.btn} ${d.btnPrimary}`}>Save</button>
        </div>
        {nameNote && <span className={st.status} role="status">{nameNote}</span>}
      </form>
      <div className={st.row}>
        <div className={st.rowText}>
          <span className={st.rowLabel}>Signed in as</span>
          <span className={st.rowSub}>
            {user.email}
            {via ? `, with ${via}` : ""}
          </span>
        </div>
      </div>
      <div className={`${st.row} ${st.rowStack}`}>
        <div className={st.buttons}>
          <button type="button" className={d.btn} onClick={() => resetSettings()}>
            <RotateCcw size={15} aria-hidden="true" /> Reset settings
          </button>
          <button type="button" className={d.btn} onClick={doSignOut}>
            <LogOut size={15} aria-hidden="true" /> Sign out
          </button>
          <button type="button" className={`${d.btn} ${d.btnDanger}`} onClick={() => setConfirmOpen((v) => !v)} aria-expanded={confirmOpen}>
            <Trash2 size={15} aria-hidden="true" /> Delete my account
          </button>
        </div>
        {confirmOpen && (
          <div className={st.danger} data-settings-delete="true">
            <p>
              <b>This deletes your account and every board you made, for good.</b> Their ink, text, pictures and worksheets go too, and anyone you shared a board with loses it. It can&apos;t be undone.
            </p>
            <label className={st.rowLabel} htmlFor="set-delete">Type delete to confirm</label>
            <input
              id="set-delete"
              className={d.input}
              value={confirmText}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(e) => setConfirmText(e.target.value)}
            />
            {problem && <p className={st.problem} role="alert">{problem}</p>}
            <div className={st.buttons}>
              <button
                type="button"
                className={`${d.btn} ${d.btnDanger}`}
                disabled={deleting || confirmText.trim().toLowerCase() !== "delete"}
                onClick={deleteAccount}
              >
                {deleting ? "Deleting…" : "Delete my account and boards"}
              </button>
              <button type="button" className={d.btn} onClick={() => setConfirmOpen(false)}>
                Keep my account
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
