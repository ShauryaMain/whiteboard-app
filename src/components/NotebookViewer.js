"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Download, GraduationCap, Minus, PenLine, Plus } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { contentsFromRows } from "@/lib/boardSync";
import { graphsOf } from "@/lib/graphList";
import { layoutPages, normalizeNotebook, pageColorIsDark, DESK, DESK_DARK } from "@/lib/notebook";
import { contentsByPage, exportNotebookPdf, loadPagePictures, renderPage } from "@/lib/notebookRender";
import { parseBackground } from "@/lib/boardBackground";
import { isTape, tapesInReadingOrder } from "@/lib/tape";
import { startQuiz, showAnswer, markAnswer, currentTape, readTally, saveTally } from "@/lib/quiz";
import { rememberReturn } from "@/lib/returnTo";
import { landingLink } from "@/lib/links";
import { track } from "@/lib/track";
import { QuizBar } from "./StudyBits";
import d from "./Dialog.module.css";
import n from "./Notebook.module.css";
import p from "./Paper.module.css";

const CHECK_EVERY_MS = 30000; // how often an open notebook asks "has it changed?"
const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5, 2];

// Everything about a notebook opened from its link, ready to show.
function prepare(data) {
  const nb = normalizeNotebook(data.notebook);
  const contents = contentsFromRows(data);
  const graphs = graphsOf(data.grid_config);
  const layout = layoutPages(nb);
  const byPage = contentsByPage(nb, { ...contents, graphs });
  const color = parseBackground(data.background).color;
  return {
    id: data.id,
    name: data.name || "Untitled notebook",
    mode: data.mode,
    mine: !!data.mine,
    member: !!data.member,
    stamp: data.stamp || "",
    nb,
    layout,
    byPage,
    color,
    contents: { ...contents, graphs },
    // a key that changes whenever anything on a page does (to draw it again)
    keys: byPage.map((c, i) => `${data.stamp || ""}:${layout[i].id}:${c.strokes.length}:${c.texts.length}:${c.images.length}`),
  };
}

// The whole notebook as a PDF (null if it couldn't be made).
async function makePdfOf(ready) {
  try {
    return await exportNotebookPdf({ nb: ready.nb, indices: null, contents: ready.contents, color: ready.color, tape: "hide" });
  } catch (err) {
    return null;
  }
}

// Hands the browser a file to save.
function saveFile(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 60000);
}

// "Has it changed?": the notebook's stamp, null when the link has stopped
// working, undefined when it couldn't be asked (offline).
async function fetchStamp(token) {
  try {
    const { data, error } = await supabase.rpc("shared_notebook_stamp", { p_token: token });
    return error ? undefined : data;
  } catch (err) {
    return undefined;
  }
}

// The notebook a link opens: { phase: "ready", ... }, or { phase: "gone" }
// (the link is off or unknown), or { phase: "error" }.
async function fetchShared(token) {
  try {
    const { data, error } = await supabase.rpc("open_shared_notebook", { p_token: token });
    if (error) return { phase: "error" };
    if (!data) return { phase: "gone" };
    return { phase: "ready", ...prepare(data) };
  } catch (err) {
    return { phase: "error" };
  }
}

// One page, drawn when it comes near the screen, with its tape on top
// (tap a piece to peek under it).
function ViewerPage({ rect, color, contents, width, drawKey, revealed, asking, onTapTape, near }) {
  const canvasRef = useRef(null);
  const height = Math.round((width * rect.h) / rect.w);
  const tapes = contents.images.filter(isTape);

  useEffect(() => {
    if (!near) return undefined;
    let live = true;
    (async () => {
      const pictures = await loadPagePictures(rect, contents);
      if (!live) return;
      const ratio = Math.min(3, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
      const scale = (width * ratio) / rect.w;
      const drawn = renderPage({ rect, color, contents, pictures, scale, tape: "hide" });
      const canvas = canvasRef.current;
      if (!canvas || !live) {
        drawn.width = 0;
        return;
      }
      canvas.width = drawn.width;
      canvas.height = drawn.height;
      canvas.getContext("2d").drawImage(drawn, 0, 0);
      drawn.width = 0;
      drawn.height = 0;
    })();
    return () => {
      live = false;
    };
    // (drawKey stands for the contents)
  }, [near, width, drawKey, color]);

  return (
    <div className={n.viewPage} style={{ width, height }} data-view-page={rect.index}>
      <canvas ref={canvasRef} style={{ width, height, display: "block" }} aria-label={`Page ${rect.index + 1}`} role="img" />
      {tapes.map((t) => {
        const shown = revealed.has(t.id);
        return (
          <button
            key={t.id}
            type="button"
            className={`${n.tape} ${n.viewTape} ${shown ? n.tapeShown : ""} ${asking === t.id ? n.tapeAsk : ""}`}
            style={{
              left: `${((t.x - rect.x) / rect.w) * 100}%`,
              top: `${((t.y - rect.y) / rect.h) * 100}%`,
              width: `${(t.width / rect.w) * 100}%`,
              height: `${(t.height / rect.h) * 100}%`,
            }}
            aria-label={shown ? "Cover this answer again" : "Show what's under the tape"}
            aria-pressed={shown}
            data-tape={shown ? "shown" : "covered"}
            data-tape-id={t.id}
            onClick={() => onTapTape(t.id)}
          />
        );
      })}
    </div>
  );
}

// A notebook opened from its link: read-only, for anyone (no account).
// Its tape can be peeked under and quizzed on; it can be downloaded as a
// PDF; and when the owner lets people write on it, "Write on it" adds
// you to it (after signing in).
export default function NotebookViewer({ token }) {
  const router = useRouter();
  const auth = useAuth();
  const user = auth ? auth.user : null;
  const [state, setState] = useState({ phase: "loading" }); // loading | gone | error | ready
  const [zoom, setZoom] = useState(1);
  const [paneWidth, setPaneWidth] = useState(0);
  const [near, setNear] = useState(() => new Set([0, 1]));
  const [current, setCurrent] = useState(0);
  const [revealed, setRevealed] = useState(() => new Set());
  const [quiz, setQuiz] = useState(null);
  const [tally, setTally] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [joining, setJoining] = useState(false);
  const [note, setNote] = useState("");
  const scrollRef = useRef(null);
  const stampRef = useRef("");

  // Fetches the notebook again (`quiet`: a check that fails leaves what's
  // on screen alone).
  function load(quiet = false) {
    return fetchShared(token).then((next) => {
      if (next.phase === "error" && quiet) return;
      if (next.phase === "ready") stampRef.current = next.stamp;
      setState(next);
    });
  }

  useEffect(() => {
    let live = true;
    fetchShared(token).then((next) => {
      if (!live) return;
      if (next.phase === "ready") stampRef.current = next.stamp;
      setState(next);
    });
    return () => {
      live = false;
    };
  }, [token]);

  // Has it changed? (asked now and then while the page is on screen; the
  // whole notebook is only fetched again when it has)
  useEffect(() => {
    if (state.phase !== "ready") return undefined;
    let live = true;
    async function check() {
      if (document.visibilityState !== "visible") return;
      const stamp = await fetchStamp(token);
      if (!live || stamp === undefined) return;
      if (stamp === null) setState({ phase: "gone" });
      else if (stamp !== stampRef.current) load(true);
    }
    const timer = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [state.phase, token]);

  // the width there is for the pages
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const measure = () => setPaneWidth(el.clientWidth);
    const frame = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [state.phase]);

  const layout = state.phase === "ready" ? state.layout : [];
  const widest = layout.reduce((m, r) => Math.max(m, r.w), 0) || 794;
  // the pages fit the screen at 100% (never wider than they really are, on
  // a big screen)
  const fit = paneWidth ? Math.min(1, (paneWidth - 24) / widest) : 1;
  const pageScale = fit * zoom;

  // which pages are near the screen (drawn), and which one is on it
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || state.phase !== "ready") return undefined;
    function onScroll() {
      const top = el.scrollTop;
      const bottom = top + el.clientHeight;
      const nextNear = new Set();
      let y = 16;
      let on = 0;
      layout.forEach((r, i) => {
        const h = r.h * pageScale;
        if (y + h > top - el.clientHeight && y < bottom + el.clientHeight) nextNear.add(i);
        if (y <= top + el.clientHeight * 0.4) on = i;
        y += h + 20;
      });
      setNear((prev) => {
        const merged = new Set([...prev, ...nextNear]);
        return merged.size === prev.size ? prev : merged;
      });
      setCurrent(on);
    }
    const frame = requestAnimationFrame(onScroll);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
    };
  }, [state.phase, layout, pageScale]);

  if (state.phase === "loading") {
    return (
      <div className={p.screen}>
        <div className={p.sticky} role="status">
          <h1 className={p.stickyTitle}>Opening the notebook…</h1>
          <span className={p.dots} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </div>
      </div>
    );
  }
  if (state.phase === "gone" || state.phase === "error") {
    return (
      <div className={p.screen}>
        <div className={`${p.sticky} ${p.stickyPink}`} role="alert">
          <h1 className={p.stickyTitle}>{state.phase === "gone" ? "This link doesn't work any more" : "Couldn't open the notebook"}</h1>
          <p className={p.stickyText}>
            {state.phase === "gone"
              ? "Whoever shared it has turned the link off or made a new one. Ask them for the new link."
              : "Check your connection, then try again."}
          </p>
          {state.phase === "error" && (
            <button type="button" className={`${d.btn} ${d.btnPrimary}`} onClick={() => load()} style={{ marginTop: 6 }}>
              Try again
            </button>
          )}
          <a href={landingLink("notebook-link")} target="_blank" rel="noopener" className={p.madeWith}>
            Made with Clean Slate: free notebooks for students
          </a>
        </div>
      </div>
    );
  }

  const dark = pageColorIsDark(state.color);
  const pageTapes = (i) => (layout[i] ? tapesInReadingOrder(state.byPage[i].images, layout[i]) : []);
  const asking = quiz && !quiz.done ? currentTape(quiz) : null;

  function toggle(id) {
    const next = new Set(revealed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setRevealed(next);
    if (quiz && !quiz.done && currentTape(quiz) === id && next.has(id)) setQuiz(showAnswer(quiz));
  }

  function scrollToTape(id) {
    const el = scrollRef.current;
    const node = el && el.querySelector(`[data-tape-id="${id}"]`);
    if (node && node.scrollIntoView) node.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function startQuizOn(i, only = null) {
    const ids = only && only.length ? only : pageTapes(i).map((t) => t.id);
    if (!ids.length) return;
    const next = new Set(revealed);
    ids.forEach((id) => next.delete(id));
    setRevealed(next);
    setTally(readTally(state.id, layout[i].id));
    setQuiz({ ...startQuiz(layout[i].id, ids), whole: !only });
    scrollToTape(ids[0]);
    track("notebook_quiz_started", { tapes: ids.length, via: "link" });
  }

  function mark(knew) {
    const q = markAnswer(quiz, knew);
    setQuiz(q);
    if (q.done) {
      if (q.whole) saveTally(state.id, q.pageId, q.right.length, q.ids.length);
    } else {
      scrollToTape(currentTape(q));
    }
  }

  function showIt() {
    const id = currentTape(quiz);
    if (!id) return;
    setRevealed(new Set([...revealed, id]));
    setQuiz(showAnswer(quiz));
  }

  async function download() {
    if (exporting) return;
    setExporting(true);
    setNote("Making the PDF…");
    const blob = await makePdfOf(state);
    setExporting(false);
    if (!blob) {
      setNote("The PDF couldn't be made. Please try again.");
      return;
    }
    saveFile(blob, `${String(state.name).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 80) || "Notebook"}.pdf`);
    setNote("");
    track("notebook_exported", { via: "link", pages: state.nb.pages.length });
  }

  async function writeOnIt() {
    if (state.mine || state.member) {
      router.push(`/board/${state.id}`);
      return;
    }
    if (!user) {
      // sign in first (the sign-in screen is on the next page), then back here
      rememberReturn(`/n/${token}/write`);
      track("notebook_link_signin", {});
      window.location.assign(`/n/${token}/write`);
      return;
    }
    setJoining(true);
    const { data, error } = await supabase.rpc("join_notebook_link", { p_token: token });
    setJoining(false);
    if (error || !data || !data.board) {
      setNote(data && data.reason === "view" ? "This link is for reading only now." : "That didn't work. Please try again.");
      if (data && data.reason === "view") load(true);
      return;
    }
    track("notebook_link_joined", {});
    router.push(`/board/${data.board}`);
  }

  const canWrite = state.mine || state.member || state.mode === "edit";
  const hereTapes = pageTapes(current).length > 0;

  return (
    <div className={n.viewShell} style={{ background: dark ? DESK_DARK : DESK }}>
      <header className={n.viewBar}>
        <span className={n.viewTitle}>
          <BookOpen size={18} aria-hidden="true" />
          <span>{state.name}</span>
        </span>
        <span className={n.viewPageNo} aria-live="polite">
          Page {current + 1} / {layout.length}
        </span>
        <span style={{ flex: 1 }} />
        <span className={n.viewZoom} role="group" aria-label="Zoom">
          <button type="button" className={`${n.btn} ${n.btnIcon}`} aria-label="Zoom out" disabled={zoom <= ZOOMS[0]} onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])}>
            <Minus size={15} />
          </button>
          <button type="button" className={n.btn} onClick={() => setZoom(1)} aria-label="Fit the page">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" className={`${n.btn} ${n.btnIcon}`} aria-label="Zoom in" disabled={zoom >= ZOOMS[ZOOMS.length - 1]} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])}>
            <Plus size={15} />
          </button>
        </span>
        {hereTapes && !quiz && (
          <button type="button" className={n.btn} onClick={() => startQuizOn(current)} data-quiz-start="true">
            <GraduationCap size={15} aria-hidden="true" /> Quiz me
          </button>
        )}
        <button type="button" className={n.btn} onClick={download} disabled={exporting} data-viewer-pdf="true">
          <Download size={15} aria-hidden="true" /> PDF
        </button>
        {canWrite && (
          <button type="button" className={`${n.btn} ${n.btnPrimary}`} onClick={writeOnIt} disabled={joining} data-viewer-write="true">
            <PenLine size={15} aria-hidden="true" />
            {state.mine ? "Open your notebook" : state.member ? "Open it" : user ? "Write on it" : "Sign in to write on it"}
          </button>
        )}
      </header>
      {note && (
        <div className={n.viewNote} role="status">
          {note}
        </div>
      )}
      <div ref={scrollRef} className={n.viewScroll}>
        {paneWidth > 0 &&
          layout.map((rect, i) => (
            <ViewerPage
              key={rect.id}
              rect={rect}
              color={state.color}
              contents={state.byPage[i]}
              width={Math.round(rect.w * pageScale)}
              drawKey={state.keys[i]}
              near={near.has(i)}
              revealed={revealed}
              asking={asking}
              onTapTape={toggle}
            />
          ))}
        {!state.mine && !state.member && (
          <a href={landingLink("notebook-link")} target="_blank" rel="noopener" className={n.viewMadeWith}>
            Made with Clean Slate: free notebooks for students, on any device
          </a>
        )}
      </div>
      {quiz && (
        <QuizBar
          quiz={quiz}
          tally={tally}
          onShow={showIt}
          onMark={mark}
          onAgain={(onlyMissed) => {
            const i = layout.findIndex((r) => r.id === quiz.pageId);
            if (i >= 0) startQuizOn(i, onlyMissed ? quiz.missed : null);
          }}
          onClose={() => setQuiz(null)}
        />
      )}
    </div>
  );
}
