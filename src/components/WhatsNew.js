"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X, Sparkles, ChevronLeft, ChevronRight, ArrowRight } from "lucide-react";
import { RELEASES, unreadReleases } from "@/lib/releases";
import { TOURS } from "@/lib/tours";
import {
  subscribeWhatsNew, getWhatsNew, getServerWhatsNew,
  markReleasesSeen, setWhatsNewQuiet, openTourBoard,
} from "@/lib/whatsNew";
import s from "./WhatsNew.module.css";

function formatDay(day) {
  const d = new Date(day + "T12:00:00");
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

// The "What's new" button for the boards page, and the pop-up it opens.
//
// The pop-up also opens by itself the first time someone visits after an
// update has been announced (an entry added to src/lib/releases.js), unless
// they've ticked "Don't show on startup again" — then the button just
// shows a dot. What's been seen is remembered on this device.
export default function WhatsNew({ user, className = "", labelClassName = "" }) {
  const router = useRouter();
  const prefs = useSyncExternalStore(subscribeWhatsNew, getWhatsNew, getServerWhatsNew);
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const unread = prefs.ready ? unreadReleases(RELEASES, prefs.seen, user ? user.created_at : null) : [];
  const popsUp = unread.length > 0 && !prefs.quiet;
  const open = RELEASES.length > 0 && (manual || popsUp);

  function close(quiet) {
    setWhatsNewQuiet(quiet);
    markReleasesSeen(unread.map((r) => r.id));
    setManual(false);
    setProblem("");
  }

  async function showMe(release, quiet) {
    if (busy || !user) return;
    setBusy(true);
    setProblem("");
    const result = await openTourBoard(release, user.id);
    if (result.error) {
      console.error("What's new: couldn't open the walkthrough board:", result.error);
      setBusy(false);
      setProblem("Couldn't open a board just now. Check your connection and try again.");
      return;
    }
    setWhatsNewQuiet(quiet);
    markReleasesSeen(unread.map((r) => r.id));
    router.push(`/board/${result.id}?tour=${encodeURIComponent(release.tour)}`);
  }

  if (RELEASES.length === 0) return null;

  return (
    <>
      <button
        type="button"
        className={`${className} ${s.trigger}`}
        onClick={() => setManual(true)}
        aria-label={unread.length > 0 ? "What's new (something new to see)" : "What's new"}
        title="What's new in Clean Slate"
        data-whats-new-unread={unread.length > 0 ? "true" : "false"}
      >
        <Sparkles size={16} />
        <span className={labelClassName}>What&apos;s new</span>
        {unread.length > 0 && <span className={s.dot} aria-hidden="true" />}
      </button>
      {open && (
        <WhatsNewModal
          releases={RELEASES}
          startId={(unread[0] || RELEASES[0]).id}
          startQuiet={prefs.quiet}
          busy={busy}
          problem={problem}
          onClose={close}
          onShowMe={showMe}
        />
      )}
    </>
  );
}

function WhatsNewModal({ releases, startId, startQuiet, busy, problem, onClose, onShowMe }) {
  const [pickedId, setPickedId] = useState(startId);
  const [quiet, setQuiet] = useState(startQuiet);
  const cardRef = useRef(null);
  const release = releases.find((r) => r.id === pickedId) || releases[0];
  const hasTour = !!(release.tour && TOURS[release.tour]);

  useEffect(() => {
    if (cardRef.current) cardRef.current.focus();
  }, []);

  function onKeyDown(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose(quiet);
    }
  }

  return createPortal(
    <div
      className={s.overlay}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose(quiet);
      }}
    >
      <div className={s.card} role="dialog" aria-modal="true" aria-labelledby="whats-new-title" tabIndex={-1} ref={cardRef}>
        <div className={s.header}>
          <div className={s.headText}>
            <div className={s.kicker}>
              <span className={s.tape}>What&apos;s new</span>
              <span className={s.date}>{formatDay(release.date)}</span>
            </div>
            <h2 className={s.title} id="whats-new-title">{release.headline}</h2>
          </div>
          <button type="button" className={s.closeBtn} onClick={() => onClose(quiet)} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className={s.scroll}>
          {releases.length > 1 && (
            <div className={s.chips} role="group" aria-label="Updates">
              {releases.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`${s.chip} ${r.id === release.id ? s.chipOn : ""}`}
                  aria-pressed={r.id === release.id}
                  onClick={() => setPickedId(r.id)}
                >
                  {r.title}
                </button>
              ))}
            </div>
          )}

          <Slides key={release.id} slides={release.slides || []} />

          <p className={s.intro}>{release.intro}</p>
          {release.points && release.points.length > 0 && (
            <ul className={s.points}>
              {release.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          )}
        </div>

        {problem && <div className={s.problem} role="alert">{problem}</div>}

        <div className={s.footer}>
          <label className={s.check}>
            <input type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} />
            <span className={s.checkBox} aria-hidden="true" />
            Don&apos;t show on startup again
          </label>
          <div className={s.buttons}>
            <button type="button" className={s.btn} onClick={() => onClose(quiet)}>Close</button>
            {hasTour && (
              <button
                type="button"
                className={`${s.btn} ${s.btnPrimary}`}
                onClick={() => onShowMe(release, quiet)}
                disabled={busy}
                aria-busy={busy}
              >
                {busy ? "Opening a board…" : "Show me the update"}
                {!busy && <ArrowRight size={17} />}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// The screenshots: swipe, use the arrows, or tap a dot.
function Slides({ slides }) {
  const trackRef = useRef(null);
  const [index, setIndex] = useState(0);
  if (slides.length === 0) return null;
  const slide = slides[Math.min(index, slides.length - 1)];

  function go(to) {
    const track = trackRef.current;
    if (!track) return;
    const target = Math.max(0, Math.min(slides.length - 1, to));
    const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollTo({ left: target * track.clientWidth, behavior: calm ? "auto" : "smooth" });
  }

  function onScroll(e) {
    const track = e.currentTarget;
    if (!track.clientWidth) return;
    const at = Math.round(track.scrollLeft / track.clientWidth);
    if (at !== index) setIndex(at);
  }

  function onKeyDown(e) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(index - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      go(index + 1);
    }
  }

  return (
    <div className={s.slides}>
      <div className={s.frame}>
        <div
          className={s.track}
          ref={trackRef}
          onScroll={onScroll}
          onKeyDown={onKeyDown}
          tabIndex={0}
          role="group"
          aria-roledescription="carousel"
          aria-label={`Screenshots, ${index + 1} of ${slides.length}`}
        >
          {slides.map((item, i) => (
            <div className={s.slide} key={item.src}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.src} alt={item.alt} width={1600} height={1000} loading={i === 0 ? "eager" : "lazy"} draggable={false} />
            </div>
          ))}
        </div>
        {slides.length > 1 && (
          <>
            <button type="button" className={`${s.arrow} ${s.arrowLeft}`} onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous screenshot">
              <ChevronLeft size={20} />
            </button>
            <button type="button" className={`${s.arrow} ${s.arrowRight}`} onClick={() => go(index + 1)} disabled={index >= slides.length - 1} aria-label="Next screenshot">
              <ChevronRight size={20} />
            </button>
          </>
        )}
      </div>
      <div className={s.under}>
        <p className={s.caption} aria-live="polite">{slide.caption}</p>
        {slides.length > 1 && (
          <div className={s.dots}>
            {slides.map((item, i) => (
              <button
                key={item.src}
                type="button"
                className={`${s.dotBtn} ${i === index ? s.dotBtnOn : ""}`}
                onClick={() => go(i)}
                aria-label={`Screenshot ${i + 1} of ${slides.length}`}
                aria-current={i === index ? "true" : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
