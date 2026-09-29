"use client";

import { useEffect, useRef, useState } from "react";
import { X, Lightbulb, Bug, MessageCircle, ImagePlus, Check, Mail } from "lucide-react";
import {
  MAX_SCREENSHOTS, SUPPORT_EMAIL, prepareScreenshot, imageFiles, collectDeviceDetails, sendFeedback, mailtoLink,
  getFeedbackDraft, setFeedbackDraft, nextShotId,
} from "@/lib/feedback";
import d from "./Dialog.module.css";
import f from "./Feedback.module.css";

const TYPES = [
  {
    id: "improvement",
    title: "Idea or improvement",
    desc: "Something new, or something that could work better",
    Icon: Lightbulb,
    on: f.typeOn,
    label: "What would you like Clean Slate to do?",
    placeholder: "e.g. Let me save a board as a PDF so I can send it to parents after the lesson.",
  },
  {
    id: "bug",
    title: "Something's broken",
    desc: "An error, or something not working as it should",
    Icon: Bug,
    on: f.typeBugOn,
    label: "What went wrong?",
    placeholder: "What were you doing, what did you expect to happen, and what happened instead?",
  },
  {
    id: "other",
    title: "Something else",
    desc: "Questions, praise, anything at all",
    Icon: MessageCircle,
    on: f.typeOtherOn,
    label: "What's on your mind?",
    placeholder: "Write as much or as little as you like.",
  },
];

const AREAS = ["Drawing & tools", "Selecting & pasting", "Live class", "Reference document", "Boards page", "Signing in", "Somewhere else"];
const IMPACTS = ["Nice to have", "Would help a lot", "I really need this"];
const MAX_MESSAGE = 5000;

export default function FeedbackModal({ userEmail, boardCount, onClose }) {
  const [draft] = useState(getFeedbackDraft);
  const [type, setType] = useState(draft ? draft.type : "improvement");
  const [message, setMessage] = useState(draft ? draft.message : "");
  const [area, setArea] = useState(draft ? draft.area : "");
  const [impact, setImpact] = useState(draft ? draft.impact : "");
  const [shots, setShots] = useState(draft ? draft.shots : []);
  const [includeTech, setIncludeTech] = useState(draft ? draft.includeTech : false);
  const [techTouched, setTechTouched] = useState(draft ? draft.techTouched : false);
  const [replyOk, setReplyOk] = useState(draft ? draft.replyOk : true);
  const [showTech, setShowTech] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const latest = useRef(null);
  const closeRef = useRef(null);

  const current = TYPES.find((t) => t.id === type) || TYPES[0];
  const readyShots = shots.filter((s) => s.file);
  const busy = shots.some((s) => s.busy);
  const canSend = message.trim().length > 0 && status !== "sending" && !busy;

  function close() {
    const s = latest.current;
    if (s && s.status !== "sent" && (s.message.trim() || s.shots.length)) {
      setFeedbackDraft({
        type: s.type, message: s.message, area: s.area, impact: s.impact,
        shots: s.shots.filter((x) => x.file), includeTech: s.includeTech, techTouched: s.techTouched, replyOk: s.replyOk,
      });
    } else if (s && s.status === "sent") {
      setFeedbackDraft(null);
    }
    onClose();
  }

  function chooseType(id) {
    setType(id);
    // Device details matter most for bugs: switch them on for bug reports
    // unless the person already decided.
    if (!techTouched) setIncludeTech(id === "bug");
    if (status === "error") setStatus("idle");
  }

  async function addFiles(list) {
    const files = imageFiles(list);
    if (!files.length) return;
    const room = MAX_SCREENSHOTS - shots.length;
    const take = files.slice(0, Math.max(0, room));
    if (!take.length) return;
    const placeholders = take.map(() => ({ id: nextShotId(), busy: true }));
    setShots((prev) => [...prev, ...placeholders]);
    await Promise.all(
      take.map(async (file, i) => {
        const prepared = await prepareScreenshot(file);
        const id = placeholders[i].id;
        setShots((prev) =>
          prepared ? prev.map((s) => (s.id === id ? { id, file: prepared.file, url: prepared.url } : s)) : prev.filter((s) => s.id !== id)
        );
      })
    );
  }

  function removeShot(id) {
    setShots((prev) => {
      const gone = prev.find((s) => s.id === id);
      if (gone && gone.url) URL.revokeObjectURL(gone.url);
      return prev.filter((s) => s.id !== id);
    });
  }

  function handlePaste(e) {
    const files = imageFiles(e.clipboardData && e.clipboardData.files);
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer && e.dataTransfer.files);
  }

  async function handleSubmit(e) {
    if (e) e.preventDefault();
    if (!canSend) return;
    setStatus("sending");
    setError(null);
    const result = await sendFeedback({
      type,
      message: message.trim(),
      area: type === "bug" ? area : "",
      impact: type === "improvement" ? impact : "",
      replyOk,
      tech: includeTech ? collectDeviceDetails({ boards: boardCount != null ? String(boardCount) : "" }) : null,
      screenshots: readyShots,
    });
    if (result.ok) {
      setStatus("sent");
      setFeedbackDraft(null);
    } else {
      setStatus("error");
      setError(result);
    }
  }

  function startAnother() {
    shots.forEach((s) => s.url && URL.revokeObjectURL(s.url));
    setMessage("");
    setArea("");
    setImpact("");
    setShots([]);
    setStatus("idle");
    setError(null);
  }

  // Keep a snapshot for the close handler, and close on Escape.
  useEffect(() => {
    latest.current = { type, message, area, impact, shots, includeTech, techTouched, replyOk, status };
    closeRef.current = close;
  });

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape" && closeRef.current) closeRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const techPreview = showTech ? collectDeviceDetails({ boards: boardCount != null ? String(boardCount) : "" }) : null;
  const fallback = error && ["not_configured", "send_failed", "offline", "http_500", "http_502", "http_404"].includes(error.code);

  return (
    <div className={d.overlay} onClick={close}>
      <form
        className={`${d.card} ${f.card}`}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        onPaste={handlePaste}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types || []).includes("Files")) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
        }}
        onDrop={handleDrop}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
      >
        <div className={`${d.header} ${f.head}`}>
          <div className={d.titleBlock}>
            <h2 id="feedback-title" className={d.title}>{status === "sent" ? "Feedback sent" : "Send feedback"}</h2>
            {status !== "sent" && (
              <p className={d.subtitle}>Tell us what would make Clean Slate better. It goes straight to the people who build it.</p>
            )}
          </div>
          <button type="button" className={d.close} onClick={close} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {status === "sent" ? (
          <>
            <div className={f.body}>
            <div className={f.done} role="status">
              <span className={f.doneIcon}>
                <Check size={28} strokeWidth={2.4} />
              </span>
              <strong style={{ fontSize: 17 }}>Thanks — we&apos;ve got it.</strong>
              <span className={d.subtitle}>
                We read every message.
                {replyOk && userEmail ? ` If we need more detail, we'll email you at ${userEmail}.` : ""}
              </span>
            </div>
            </div>
            <div className={f.footer}>
              <span className={f.footNote} />
              <button type="button" className={d.btn} onClick={startAnother}>
                Send another
              </button>
              <button type="button" className={`${d.btn} ${d.btnPrimary}`} onClick={close}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div className={f.body}>
            <div className={f.types} role="radiogroup" aria-label="What kind of feedback?">
              {TYPES.map(({ id, title, desc, Icon, on }) => {
                const selected = id === type;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`${f.type} ${selected ? on : ""}`}
                    onClick={() => chooseType(id)}
                  >
                    <span className={f.typeIcon}>
                      <Icon size={18} strokeWidth={2} />
                    </span>
                    <span>
                      <span className={f.typeTitle}>{title}</span>
                      <br />
                      <span className={f.typeDesc}>{desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <label className={d.label}>
              {current.label}
              <textarea
                autoFocus
                className={f.textarea}
                value={message}
                maxLength={MAX_MESSAGE}
                placeholder={current.placeholder}
                onChange={(e) => {
                  setMessage(e.target.value);
                  if (status === "error") setStatus("idle");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
                }}
              />
              <span className={f.fieldFoot}>
                <span>A sentence is fine — or give us every detail.</span>
                {message.length > MAX_MESSAGE * 0.8 && <span>{MAX_MESSAGE - message.length} left</span>}
              </span>
            </label>

            {type === "bug" && (
              <div className={d.label} role="group" aria-label="Where did it happen?">
                <span>
                  Where did it happen? <span className={f.optional}>(optional)</span>
                </span>
                <div className={f.chips}>
                  {AREAS.map((a) => (
                    <button key={a} type="button" aria-pressed={area === a} className={`${f.chip} ${area === a ? f.chipOn : ""}`} onClick={() => setArea(area === a ? "" : a)}>
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {type === "improvement" && (
              <div className={d.label} role="group" aria-label="How much would it help?">
                <span>
                  How much would it help? <span className={f.optional}>(optional)</span>
                </span>
                <div className={f.chips}>
                  {IMPACTS.map((a) => (
                    <button key={a} type="button" aria-pressed={impact === a} className={`${f.chip} ${impact === a ? f.chipOn : ""}`} onClick={() => setImpact(impact === a ? "" : a)}>
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className={d.label}>
              <span>
                Screenshots <span className={f.optional}>(optional{shots.length ? ` · ${shots.length} of ${MAX_SCREENSHOTS}` : ""})</span>
              </span>
              {shots.length < MAX_SCREENSHOTS && (
                <div className={`${f.drop} ${dragOver ? f.dropActive : ""}`}>
                  <span className={f.dropIcon}>
                    <ImagePlus size={18} />
                  </span>
                  <span className={f.dropText}>
                    <b>{type === "bug" ? "Show us what you saw" : "Add a picture"}</b>
                    Drop images here, paste one, or choose from your files.
                  </span>
                  <button type="button" className={d.btn} style={{ height: 40, padding: "0 14px" }} onClick={() => fileInputRef.current && fileInputRef.current.click()}>
                    Choose
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    multiple
                    hidden
                    onChange={(e) => {
                      addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </div>
              )}
              {shots.length > 0 && (
                <div className={f.shots}>
                  {shots.map((s, i) => (
                    <div key={s.id} className={f.shot}>
                      {s.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.url} alt={`Screenshot ${i + 1}`} />
                      ) : (
                        <span className={f.shotBusy} style={{ width: "100%", height: "100%" }}>Preparing…</span>
                      )}
                      {s.file && (
                        <button type="button" className={f.shotRemove} aria-label={`Remove screenshot ${i + 1}`} onClick={() => removeShot(s.id)}>
                          <X size={14} strokeWidth={2.4} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={f.checks}>
              <label className={f.check}>
                <input
                  type="checkbox"
                  checked={includeTech}
                  onChange={(e) => {
                    setIncludeTech(e.target.checked);
                    setTechTouched(true);
                  }}
                />
                <span>
                  Include device details
                  <small>
                    Your browser, screen size and device type — it helps us fix bugs.{" "}
                    <button type="button" className={f.linkish} onClick={() => setShowTech((v) => !v)} aria-expanded={showTech}>
                      {showTech ? "Hide" : "See exactly what's sent"}
                    </button>
                  </small>
                </span>
              </label>
              {techPreview && (
                <div className={f.techList}>
                  {Object.entries(techPreview)
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <div key={k}>
                        <b>{k}:</b> {v}
                      </div>
                    ))}
                </div>
              )}
              {userEmail && (
                <label className={f.check}>
                  <input type="checkbox" checked={replyOk} onChange={(e) => setReplyOk(e.target.checked)} />
                  <span>
                    It&apos;s OK to email me back
                    <small>We&apos;d reply to {userEmail}.</small>
                  </span>
                </label>
              )}
            </div>

            {status === "error" && error && (
              <div className={f.error} role="alert">
                <span>{error.message}</span>
                {fallback && (
                  <span>
                    You can also{" "}
                    <a href={mailtoLink({ type, message })}>email us directly</a> at {SUPPORT_EMAIL}
                    {readyShots.length ? " (attach your screenshots to the email)" : ""}.
                  </span>
                )}
              </div>
            )}

            </div>
            <div className={f.footer}>
              <span className={f.footNote}>
                <Mail size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} aria-hidden="true" />
                Goes to the Clean Slate team
              </span>
              <button type="button" className={d.btn} onClick={close}>
                Cancel
              </button>
              <button type="submit" className={`${d.btn} ${d.btnPrimary}`} disabled={!canSend}>
                {status === "sending" ? <span className={f.spinner} aria-hidden="true" /> : null}
                {status === "sending" ? "Sending…" : status === "error" ? "Try again" : "Send feedback"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
