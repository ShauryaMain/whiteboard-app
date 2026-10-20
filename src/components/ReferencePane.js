"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import {
  Hand, Pencil, Highlighter, Eraser, Lasso, Type, RectangleHorizontal, Sparkles, Crop, Undo2, Redo2,
  GalleryVerticalEnd, Search, Users, Minus, Plus, Trash2, Check, X,
} from "lucide-react";
import { browserCanOpenPdfs, PDF_UNSUPPORTED_MESSAGE } from "@/lib/loadPdfjs";
import { notePenActivity } from "@/lib/penActivity";
import { getPencilOnly, getServerPrefSnapshot, isPencilOnlyUndecided, markPenSeen, setPencilOnly, subscribePencilPrefs } from "@/lib/pencilPrefs";
import { getEraserMode, getServerEraserMode, setEraserMode, subscribeInkPrefs } from "@/lib/inkPrefs";
import {
  BLANK_ASPECT, REF_MAX_PAGES, TAPE_COLOR, drawInk, drawTape, drawTopLayer, drawInkLayer, hitMark, marksInLasso,
  newRefId, pageNumberOf, rotateMarkClockwise, tapeAt, textAt, transformMark, unionMarkBounds,
} from "@/lib/refDoc";
import { closePdf, openPdfUrl, pageBaseSize, renderClip } from "@/lib/refPdf";
import RefPage from "./RefPage";
import { RefPagesPanel, RefSearchPanel } from "./RefPanels";
import PalmSafeButton from "./PalmSafeButton";
import s from "./RefPane.module.css";
import { getSetting } from "@/lib/settings";

// Sizes are for a page shown 600 px wide (they grow and shrink with it).
const REF_W = 600;
const SIZES = {
  pen: [1.6, 2.6, 4.2],
  highlighter: [9, 15, 24],
  eraser: [10, 20, 40],
  text: [13, 17, 24],
};
const PEN_COLORS = ["#1a1a1a", "#E53935", "#1E88E5", "#43A047", "#FB8C00", "#8E24AA"];
const HIGHLIGHT_COLORS = ["#FFD54F", "#81D4FA", "#A5D6A7", "#F48FB1", "#FFAB91"];
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const GAP = 14;
const HOLD_MS = 500; // pen held still this long: the line straightens
const TAP_MS = 350;
const TAP_PX = 8;
const LASER_FADE_MS = 1200;
const FOLLOW_SEND_MS = 250;
const FOLLOW_BEAT_MS = 4000;
const FOLLOW_TIMEOUT_MS = 12000;

const TOOLS = [
  { id: "hand", label: "Move around (scroll)", Icon: Hand },
  { id: "pen", label: "Pen", Icon: Pencil },
  { id: "highlighter", label: "Highlighter", Icon: Highlighter },
  { id: "eraser", label: "Eraser", Icon: Eraser },
  { id: "lasso", label: "Lasso: select markings to move, resize or recolour", Icon: Lasso },
  { id: "text", label: "Text box", Icon: Type },
  { id: "tape", label: "Tape: cover an answer, tap to show it", Icon: RectangleHorizontal },
  { id: "laser", label: "Laser pointer", Icon: Sparkles },
  { id: "clip", label: "Clip a part of the page onto the board", Icon: Crop },
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// A page's height / width as shown now. Measured shapes remember how the
// page was turned when measured, so a page that has just been turned (and
// isn't measured again yet) is already the right shape.
function aspectOf(aspects, entry) {
  const known = aspects[entry.id];
  if (!known) return BLANK_ASPECT;
  const quarterTurns = Math.round((((entry.rotate || 0) - known.r) % 360 + 360) % 360 / 90);
  return quarterTurns % 2 ? 1 / known.a : known.a;
}

// ---------- the "live" layer: what's being drawn right now ----------
//
// One small object, made once per pane, that knows each page's live
// canvas and draws on it: the line being drawn, a lasso, the selected
// markings, the clip box, laser pointers. Kept outside React state so it
// can be redrawn every frame without re-rendering the pane.
function createLiveEngine() {
  const regs = new Map(); // pageId -> { canvas, width, height, ratio }
  let gesture = null;
  let selection = null; // { pageId, ids, marks }
  let clip = null; // { pageId, box }
  const trails = new Map(); // who -> { pageId, pts: [{ x, y, t }] }
  const pending = new Set();
  let raf = 0;
  let laserRaf = 0;

  function ctxOf(reg) {
    const ctx = reg.canvas.getContext("2d");
    ctx.setTransform(reg.ratio, 0, 0, reg.ratio, 0, 0);
    return ctx;
  }

  function drawBox(ctx, b, handles) {
    ctx.save();
    ctx.strokeStyle = "#2451D6";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.setLineDash([]);
    if (handles) {
      ctx.fillStyle = "#fff";
      for (const [hx, hy] of handles) {
        ctx.beginPath();
        ctx.arc(hx, hy, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function paintLaser(ctx, pageId, W, H, now) {
    for (const trail of trails.values()) {
      if (trail.pageId !== pageId) continue;
      const pts = trail.pts.filter((p) => now - p.t < LASER_FADE_MS);
      if (!pts.length) continue;
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.shadowColor = "rgba(229, 57, 53, 0.9)";
      ctx.shadowBlur = 10;
      for (let i = 1; i < pts.length; i++) {
        const a = 1 - (now - pts[i].t) / LASER_FADE_MS;
        ctx.strokeStyle = `rgba(229, 57, 53, ${Math.max(0, a).toFixed(3)})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x * W, pts[i - 1].y * H);
        ctx.lineTo(pts[i].x * W, pts[i].y * H);
        ctx.stroke();
      }
      const last = pts[pts.length - 1];
      ctx.fillStyle = "rgba(229, 57, 53, 0.95)";
      ctx.beginPath();
      ctx.arc(last.x * W, last.y * H, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function paint(pageId) {
    const reg = regs.get(pageId);
    if (!reg) return;
    const W = reg.width, H = reg.height;
    const ctx = ctxOf(reg);
    ctx.clearRect(0, 0, W, H);
    const g = gesture;
    if (g && g.pageId === pageId) {
      if (g.kind === "draw") {
        if (g.mark.tool === "eraser") {
          // (the rubbing out shows once the line is finished)
          drawInk(ctx, { ...g.mark, tool: "pen", color: "rgba(120, 120, 120, 0.35)", opacity: 1 }, W, H);
        } else {
          drawInk(ctx, g.mark, W, H);
        }
      } else if (g.kind === "lasso" && g.poly.length > 1) {
        ctx.save();
        ctx.strokeStyle = "#2451D6";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(g.poly[0].x, g.poly[0].y);
        for (const p of g.poly) ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.restore();
      } else if (g.kind === "tape" && g.end) {
        const x = Math.min(g.start.x, g.end.x), y = Math.min(g.start.y, g.end.y);
        drawTape(ctx, { x: x / W, y: y / H, w: Math.abs(g.end.x - g.start.x) / W, h: Math.abs(g.end.y - g.start.y) / H, color: TAPE_COLOR }, W, H);
      }
    }
    // the selection (moved / resized while it's being dragged)
    if (selection && selection.pageId === pageId) {
      let marks = selection.marks;
      if (g && (g.kind === "move" || g.kind === "resize") && g.pageId === pageId) {
        marks = marks.map((m) => transformMark(m, g.du || 0, g.dv || 0, g.scale || 1, g.ou || 0, g.ov || 0));
        drawInkLayer(ctx, marks, W, H);
        drawTopLayer(ctx, marks, W, H);
      }
      const b = unionMarkBounds(marks, W, H);
      if (b) {
        const pad = 6;
        const box = { x: b.minX - pad, y: b.minY - pad, w: b.maxX - b.minX + pad * 2, h: b.maxY - b.minY + pad * 2 };
        drawBox(ctx, box, [[box.x + box.w, box.y + box.h]]);
      }
    }
    // the clip box: the rest of the page dimmed
    const c = g && g.kind === "clip" && g.pageId === pageId && g.box ? { pageId, box: g.box } : clip && clip.pageId === pageId ? clip : null;
    if (c) {
      const bx = c.box.x * W, by = c.box.y * H, bw = c.box.w * W, bh = c.box.h * H;
      ctx.save();
      ctx.fillStyle = "rgba(27, 29, 36, 0.28)";
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.rect(bx, by, bw, bh);
      ctx.fill("evenodd");
      ctx.restore();
      drawBox(ctx, { x: bx, y: by, w: bw, h: bh }, [[bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]]);
    }
    paintLaser(ctx, pageId, W, H, Date.now());
  }

  function flush() {
    raf = 0;
    const ids = [...pending];
    pending.clear();
    for (const id of ids) paint(id);
  }

  function schedule(pageId) {
    if (pageId == null) return;
    pending.add(pageId);
    if (!raf && typeof requestAnimationFrame !== "undefined") raf = requestAnimationFrame(flush);
  }

  // Laser pointers fade out: keep redrawing their pages until they have.
  function laserFrame() {
    laserRaf = 0;
    const now = Date.now();
    let alive = false;
    for (const [who, trail] of trails) {
      trail.pts = trail.pts.filter((p) => now - p.t < LASER_FADE_MS);
      schedule(trail.pageId);
      if (trail.pts.length) alive = true;
      else trails.delete(who);
    }
    if (alive) laserRaf = requestAnimationFrame(laserFrame);
  }

  return {
    register(pageId, reg) {
      if (reg) regs.set(pageId, reg);
      else regs.delete(pageId);
      if (reg) schedule(pageId);
    },
    reg: (pageId) => regs.get(pageId) || null,
    gesture: () => gesture,
    setGesture(g) {
      const old = gesture;
      gesture = g;
      if (old) schedule(old.pageId);
      if (g) schedule(g.pageId);
    },
    schedule,
    setSelection(sel) {
      const old = selection;
      selection = sel;
      if (old) schedule(old.pageId);
      if (sel) schedule(sel.pageId);
    },
    setClip(c) {
      const old = clip;
      clip = c;
      if (old) schedule(old.pageId);
      if (c) schedule(c.pageId);
    },
    laser(who, pageId, pts) {
      const now = Date.now();
      const trail = trails.get(who);
      const fresh = !trail || trail.pageId !== pageId;
      const next = fresh ? { pageId, pts: [] } : trail;
      if (fresh && trail) schedule(trail.pageId);
      pts.forEach((p, i) => next.pts.push({ x: p[0], y: p[1], t: now - (pts.length - 1 - i) * 12 }));
      if (next.pts.length > 200) next.pts.splice(0, next.pts.length - 200);
      trails.set(who, next);
      if (!laserRaf && typeof requestAnimationFrame !== "undefined") laserRaf = requestAnimationFrame(laserFrame);
    },
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      if (laserRaf) cancelAnimationFrame(laserRaf);
      raf = 0;
      laserRaf = 0;
    },
  };
}

// Finger-flick scrolling that carries on and slows down.
function startMomentum(el, vx, vy) {
  let last = performance.now();
  let id = 0;
  let x = vx, y = vy;
  const step = (now) => {
    const dt = Math.min(40, now - last);
    last = now;
    el.scrollLeft -= x * dt;
    el.scrollTop -= y * dt;
    const decay = Math.pow(0.95, dt / 16);
    x *= decay;
    y *= decay;
    if (Math.abs(x) < 0.02 && Math.abs(y) < 0.02) {
      id = 0;
      return;
    }
    id = requestAnimationFrame(step);
  };
  id = requestAnimationFrame(step);
  return () => {
    if (id) cancelAnimationFrame(id);
    id = 0;
  };
}

function toolButtonClass(on) {
  return on ? `${s.toolBtn} ${s.toolBtnOn}` : s.toolBtn;
}

// ---------- the pane ----------

export default function ReferencePane({
  doc,
  marks = [],
  readOnly = false,
  canEditPages = false,
  compact = false,
  me = null, // { id, name }
  bus = null, // live pointers and "follow me" from others (refDoc.createBus)
  onMarks, // ({ add, update, remove })
  onPagesChange, // (pages, markChange)
  onAddPages, // () -> the board opens the file picker
  onClip, // ({ blob, type, width, height, source }) -> Promise
  onLaser, // ({ pageId, pts } | { end: true })
  onView, // ({ on, pageId, v })
  registerHandle = null, // (api | null): api = { showArea(pageId, box) }
}) {
  const scrollRef = useRef(null);
  const scrollId = useId();
  const contentRef = useRef(null);
  const handleElRef = useRef(null);
  const trackRef = useRef(null);
  const textRef = useRef(null);
  const [scrollRoot, setScrollRoot] = useState(null);
  const [availW, setAvailW] = useState(0);
  const [zoom, setZoom] = useState(1);
  // the PDF file, once loaded: { url, doc, status: "ready" | "error" }
  const [loadedPdf, setLoadedPdf] = useState(null);
  const [images, setImages] = useState({}); // url -> loaded <img>
  const [aspects, setAspects] = useState({}); // pageId -> { a: height / width, r: the turn it was measured at }
  const [tool, setToolState] = useState(readOnly ? "hand" : "pen");
  const [colors, setColors] = useState({ pen: "#E53935", highlighter: "#FFD54F", text: "#1a1a1a" });
  const [sizes, setSizes] = useState({ pen: 1, highlighter: 1, eraser: 1, text: 1 });
  const [popover, setPopover] = useState(false);
  const [panel, setPanel] = useState(null); // null | "pages" | "search"
  const [hidden, setHidden] = useState(null); // Set of mark ids not drawn on their page right now
  const [selection, setSelection] = useState(null); // { pageId, ids }
  const [clip, setClip] = useState(null); // { pageId, box, withMarks }
  const [clipBusy, setClipBusy] = useState(false);
  const [textEdit, setTextEdit] = useState(null);
  const [hits, setHits] = useState(null); // { pageId, rects }
  const [flash, setFlash] = useState(null); // { pageId, x, y, w, h, key }
  const [currentPage, setCurrentPage] = useState(0);
  const [handleBubble, setHandleBubble] = useState(false);
  const [leader, setLeader] = useState(null); // { by, name }
  const [following, setFollowing] = useState(true);
  const [leading, setLeading] = useState(false);
  const [history, setHistory] = useState({ undo: [], redo: [] });

  const engine = useMemo(() => createLiveEngine(), []);
  const eraserMode = useSyncExternalStore(subscribeInkPrefs, getEraserMode, getServerEraserMode);
  const pencilOnly = useSyncExternalStore(subscribePencilPrefs, getPencilOnly, getServerPrefSnapshot);

  const pointersRef = useRef(new Map());
  const momentumRef = useRef(null);
  const pendingScrollRef = useRef(null);
  const layoutRef = useRef(null);
  const marksByPageRef = useRef(new Map());
  const laserOutRef = useRef({ pts: [], pageId: null, timer: null });
  const followRef = useRef({ lastSent: 0, leaderSeen: 0, following: true, leading: false, leaderBy: null });
  const scrollRafRef = useRef(0);

  const pages = useMemo(() => (doc && Array.isArray(doc.pages) ? doc.pages : []), [doc]);
  const meId = me ? me.id : "me";
  const pdfUrl = doc && doc.pdf ? doc.pdf.url : null;
  const pdfSupported = browserCanOpenPdfs();
  const pdfDoc = loadedPdf && loadedPdf.url === pdfUrl ? loadedPdf.doc : null;
  // none | loading | ready | error | unsupported
  const pdfStatus = !pdfUrl ? "none" : !pdfSupported ? "unsupported" : loadedPdf && loadedPdf.url === pdfUrl ? loadedPdf.status : "loading";

  // ---------- loading ----------

  useEffect(() => {
    if (!pdfUrl || !pdfSupported) return;
    let cancelled = false;
    let loaded = null;
    openPdfUrl(pdfUrl).then(
      (d) => {
        if (cancelled) {
          closePdf(d);
          return;
        }
        loaded = d;
        setLoadedPdf({ url: pdfUrl, doc: d, status: "ready" });
      },
      (err) => {
        console.error("Error loading reference document:", err);
        if (!cancelled) setLoadedPdf({ url: pdfUrl, doc: null, status: "error" });
      }
    );
    return () => {
      cancelled = true;
      closePdf(loaded);
    };
  }, [pdfUrl, pdfSupported]);

  // pictures (loaded so they can also be clipped onto the board); each
  // one is asked for once
  const loadingImagesRef = useRef(new Set());
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    const urls = [...new Set(pages.filter((p) => p.kind === "image" && p.url).map((p) => p.url))];
    const loading = loadingImagesRef.current;
    const done = (url, img) => {
      if (mountedRef.current) setImages((prev) => ({ ...prev, [url]: img }));
    };
    urls.forEach((url) => {
      if (loading.has(url)) return;
      loading.add(url);
      const img = new Image();
      if (!/^blob:|^data:/.test(url)) img.crossOrigin = "anonymous";
      img.onload = () => done(url, img);
      img.onerror = () => {
        // (a picture whose server won't allow clipping still shows)
        const plain = new Image();
        plain.onload = () => done(url, plain);
        plain.src = url;
      };
      img.src = url;
    });
  }, [pages]);

  // each page's shape
  useEffect(() => {
    let cancelled = false;
    const todo = pages.filter((p) => {
      if (p.kind === "pdf") return !!pdfDoc;
      if (p.kind === "image") return !!images[p.url];
      return true;
    });
    Promise.all(
      todo.map((p) =>
        pageBaseSize(pdfDoc, p, images[p.url]).then(
          (b) => [p.id, b.h / b.w, p.rotate || 0],
          () => [p.id, BLANK_ASPECT, p.rotate || 0]
        )
      )
    ).then((list) => {
      if (cancelled) return;
      setAspects((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [id, a, r] of list) {
          const old = prev[id];
          if (!old || old.r !== r || Math.abs(old.a - a) > 1e-4) {
            next[id] = { a, r };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [pages, pdfDoc, images]);

  // the pane's width
  useEffect(() => {
    const el = scrollRoot;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setAvailW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRoot]);

  useEffect(() => () => engine.destroy(), [engine]);

  // Closing the pane: a laser still waiting to be sent goes, and anyone
  // following this page is let go.
  const onViewRef = useRef(onView);
  useEffect(() => {
    onViewRef.current = onView;
  });
  useEffect(() => {
    const out = laserOutRef.current;
    const follow = followRef.current;
    return () => {
      if (out.timer) clearTimeout(out.timer);
      if (follow.leading && onViewRef.current) onViewRef.current({ on: false });
    };
  }, []);

  // ---------- layout ----------

  const padL = compact ? 8 : 16;
  const padR = pages.length > 1 ? 34 : padL;
  const layout = useMemo(() => {
    const fitW = Math.max(60, availW - padL - padR);
    const pageW = fitW * zoom;
    const innerW = Math.max(pageW, fitW);
    const left = padL + (innerW - pageW) / 2;
    let y = padL;
    const list = [];
    for (const p of pages) {
      const h = pageW * aspectOf(aspects, p);
      list.push({ id: p.id, entry: p, left, top: y, width: pageW, height: h });
      y += h + GAP;
    }
    return { pages: list, width: innerW + padL + padR, height: y - GAP + padL, pageW, fitW };
  }, [pages, aspects, availW, zoom, padL, padR]);

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  const marksByPage = useMemo(() => {
    const map = new Map();
    for (const p of pages) map.set(p.id, []);
    for (const m of marks) {
      const list = map.get(m.pageId);
      if (list) list.push(m);
    }
    return map;
  }, [marks, pages]);

  useEffect(() => {
    marksByPageRef.current = marksByPage;
  }, [marksByPage]);

  // the selection follows the markings it's made of (someone else may have
  // changed or removed them)
  const selMarks = useMemo(() => {
    if (!selection) return null;
    const ids = new Set(selection.ids);
    const list = (marksByPage.get(selection.pageId) || []).filter((m) => ids.has(m.id));
    return list.length ? list : null;
  }, [selection, marksByPage]);

  useEffect(() => {
    engine.setSelection(selection && selMarks ? { pageId: selection.pageId, marks: selMarks } : null);
  }, [engine, selection, selMarks]);

  useEffect(() => {
    engine.setClip(clip ? { pageId: clip.pageId, box: clip.box } : null);
  }, [engine, clip]);

  useEffect(() => {
    followRef.current.following = following;
    followRef.current.leading = leading;
  }, [following, leading]);

  // a scroll position asked for before the new layout was on screen
  useLayoutEffect(() => {
    const want = pendingScrollRef.current;
    const el = scrollRef.current;
    const content = contentRef.current;
    if (content) content.style.transform = "";
    if (!want || !el) return;
    pendingScrollRef.current = null;
    const p = layout.pages.find((x) => x.id === want.pageId);
    if (!p) return;
    el.scrollLeft = p.left + want.u * p.width - want.sx;
    el.scrollTop = p.top + want.v * p.height - want.sy;
  }, [layout]);

  // ---------- helpers ----------

  function pageIndexAt(y) {
    const list = layout.pages;
    for (let i = 0; i < list.length; i++) {
      if (y < list[i].top + list[i].height + GAP / 2) return i;
    }
    return list.length - 1;
  }

  // a point in the content (px) -> { index, page, x, y } (x, y on the page)
  function pagePoint(cx, cy, index) {
    const i = index ?? pageIndexAt(cy);
    const p = layout.pages[i];
    if (!p) return null;
    return { index: i, page: p, x: cx - p.left, y: cy - p.top };
  }

  function contentPoint(e) {
    const rect = contentRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // where a point on the screen is in the document, to keep it there
  // through a zoom: { pageId, u, v, sx, sy }
  function anchorAt(clientX, clientY) {
    const el = scrollRef.current;
    const rect = el.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const cx = el.scrollLeft + sx;
    const cy = el.scrollTop + sy;
    const pp = pagePoint(cx, cy);
    if (!pp) return null;
    return { pageId: pp.page.id, u: pp.x / pp.page.width, v: pp.y / pp.page.height, sx, sy };
  }

  function zoomTo(next, clientX, clientY) {
    const z = clamp(next, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(z - zoom) < 0.001) return;
    const el = scrollRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      pendingScrollRef.current = anchorAt(clientX ?? rect.left + rect.width / 2, clientY ?? rect.top + rect.height / 2);
    }
    setZoom(z);
  }

  function pushHistory(entry) {
    setHistory((h) => ({ undo: [...h.undo.slice(-99), entry], redo: [] }));
  }

  function addMarks(list) {
    if (!list.length || !onMarks) return;
    onMarks({ add: list });
    pushHistory({ type: "add", marks: list });
  }

  function removeMarks(list) {
    if (!list.length || !onMarks) return;
    onMarks({ remove: list.map((m) => m.id) });
    pushHistory({ type: "remove", marks: list });
  }

  function updateMarks(before, after) {
    if (!after.length || !onMarks) return;
    onMarks({ update: after });
    pushHistory({ type: "update", before, after });
  }

  // (only markings on pages that are still in the document)
  function onPages(list) {
    const ids = new Set(pages.map((p) => p.id));
    return list.filter((m) => ids.has(m.pageId));
  }

  function undo() {
    const last = history.undo[history.undo.length - 1];
    if (!last || !onMarks) return;
    if (last.type === "add") onMarks({ remove: last.marks.map((m) => m.id) });
    else if (last.type === "remove") onMarks({ add: onPages(last.marks) });
    else onMarks({ update: onPages(last.before) });
    setHistory((h) => ({ undo: h.undo.slice(0, -1), redo: [...h.redo, last] }));
    setSelection(null);
  }

  function redo() {
    const last = history.redo[history.redo.length - 1];
    if (!last || !onMarks) return;
    if (last.type === "add") onMarks({ add: onPages(last.marks) });
    else if (last.type === "remove") onMarks({ remove: last.marks.map((m) => m.id) });
    else onMarks({ update: onPages(last.after) });
    setHistory((h) => ({ undo: [...h.undo, last], redo: h.redo.slice(0, -1) }));
    setSelection(null);
  }

  function setTool(next) {
    setPopover(next === tool ? !popover && ["pen", "highlighter", "eraser", "text"].includes(next) : false);
    setToolState(next);
    if (next !== "lasso") setSelection(null);
    if (next !== "clip") setClip(null);
  }

  function stopMomentum() {
    if (momentumRef.current) momentumRef.current();
    momentumRef.current = null;
  }

  // someone scrolling by hand stops following the leader
  function userMoved() {
    if (leader && following) setFollowing(false);
  }

  // ---------- following someone's page ----------

  function sendView(force) {
    if (!onView || !followRef.current.leading) return;
    const now = Date.now();
    if (!force && now - followRef.current.lastSent < FOLLOW_SEND_MS) return;
    followRef.current.lastSent = now;
    const el = scrollRef.current;
    if (!el) return;
    const cy = el.scrollTop + el.clientHeight / 2;
    const pp = pagePoint(0, cy);
    if (!pp) return;
    onView({ on: true, pageId: pp.page.id, v: clamp(pp.y / pp.page.height, 0, 1) });
  }

  function goToView(pageId, v) {
    const el = scrollRef.current;
    const p = layoutRef.current && layoutRef.current.pages.find((x) => x.id === pageId);
    if (!el || !p) return;
    el.scrollTop = p.top + v * p.height - el.clientHeight / 2;
  }

  useEffect(() => {
    if (!bus) return;
    const offLaser = bus.on("laser", (p) => {
      if (!p || !p.by) return;
      if (p.end) return;
      if (p.pageId && Array.isArray(p.pts)) engine.laser(p.by, p.pageId, p.pts);
    });
    const offView = bus.on("view", (p) => {
      if (!p || !p.by || p.by === meId) return;
      if (!p.on) {
        if (followRef.current.leaderBy === p.by) followRef.current.leaderBy = null;
        setLeader((l) => (l && l.by === p.by ? null : l));
        return;
      }
      followRef.current.leaderSeen = Date.now();
      if (followRef.current.leaderBy !== p.by) {
        // someone (new) starts showing their page: everyone follows again
        followRef.current.leaderBy = p.by;
        followRef.current.following = true;
        setFollowing(true);
      }
      if (followRef.current.leading) {
        // someone else has started leading: they take over
        setLeading(false);
      }
      setLeader((l) => (l && l.by === p.by && l.name === p.name ? l : { by: p.by, name: p.name || "Someone" }));
      if (followRef.current.following && p.pageId) goToView(p.pageId, Number(p.v) || 0);
    });
    return () => {
      offLaser();
      offView();
    };
  }, [bus, engine, meId]);

  // the leader is gone when they've been quiet a while
  useEffect(() => {
    if (!leader) return;
    const timer = setInterval(() => {
      if (Date.now() - followRef.current.leaderSeen > FOLLOW_TIMEOUT_MS) {
        followRef.current.leaderBy = null;
        setLeader(null);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [leader]);

  // while leading: where we are, now and then even when still
  const sendViewRef = useRef(null);
  useEffect(() => {
    sendViewRef.current = sendView;
  });
  useEffect(() => {
    if (!leading) return;
    const beat = () => {
      if (sendViewRef.current) sendViewRef.current(true);
    };
    const first = setTimeout(beat, 0);
    const timer = setInterval(beat, FOLLOW_BEAT_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [leading]);

  function toggleLeading() {
    if (leading) {
      setLeading(false);
      if (onView) onView({ on: false });
    } else {
      setLeading(true);
      setLeader(null);
    }
  }

  // ---------- scrolling ----------

  function onScroll() {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      const el = scrollRef.current;
      const lay = layoutRef.current;
      if (!el || !lay) return;
      const cy = el.scrollTop + el.clientHeight / 2;
      let idx = 0;
      for (let i = 0; i < lay.pages.length; i++) {
        if (cy >= lay.pages[i].top - GAP / 2) idx = i;
      }
      setCurrentPage((c) => (c === idx ? c : idx));
      const handle = handleElRef.current;
      const track = trackRef.current;
      if (handle && track) {
        const room = Math.max(1, el.scrollHeight - el.clientHeight);
        const frac = clamp(el.scrollTop / room, 0, 1);
        handle.style.top = `${frac * Math.max(0, track.clientHeight - handle.offsetHeight)}px`;
      }
      sendView(false);
    });
  }

  // ctrl / pinch-on-trackpad wheel: zoom where the pointer is
  useEffect(() => {
    const el = scrollRoot;
    if (!el) return;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) {
        if (leader && following) setFollowing(false);
        return;
      }
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0025);
      zoomTo(zoom * factor, e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  function onHandleDown(e) {
    e.stopPropagation();
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {
      // (old browsers) moves still arrive while over the handle
    }
    stopMomentum();
    userMoved();
    setHandleBubble(true);
  }

  function onHandleMove(e) {
    if (!handleBubble) return;
    const el = scrollRef.current;
    const track = trackRef.current;
    const handle = handleElRef.current;
    if (!el || !track || !handle) return;
    const rect = track.getBoundingClientRect();
    const frac = clamp((e.clientY - rect.top - handle.offsetHeight / 2) / Math.max(1, rect.height - handle.offsetHeight), 0, 1);
    el.scrollTop = frac * (el.scrollHeight - el.clientHeight);
  }

  function onHandleUp() {
    setHandleBubble(false);
  }

  function goToPage(index, rect) {
    const el = scrollRef.current;
    const p = layout.pages[index];
    if (!el || !p) return;
    userMoved();
    if (rect) {
      el.scrollTop = p.top + (rect.y + rect.h / 2) * p.height - el.clientHeight / 2;
      el.scrollLeft = p.left + (rect.x + rect.w / 2) * p.width - el.clientWidth / 2;
    } else {
      el.scrollTop = p.top - 8;
    }
  }

  // A place in the document asked for from the board ("Show in document"):
  // gone to as soon as the pane is on screen and that page's shape is known.
  const pendingShowRef = useRef(null);
  const aspectsRef = useRef(aspects);
  useEffect(() => {
    aspectsRef.current = aspects;
  }, [aspects]);
  function showPending() {
    const want = pendingShowRef.current;
    const el = scrollRef.current;
    const lay = layoutRef.current;
    if (!want || !el || !lay || el.clientHeight <= 0) return;
    const p = lay.pages.find((x) => x.id === want.pageId);
    if (!p) {
      pendingShowRef.current = null;
      return;
    }
    if (p.entry.kind !== "blank" && !aspectsRef.current[p.id]) return;
    pendingShowRef.current = null;
    el.scrollTop = p.top + (want.box.y + want.box.h / 2) * p.height - el.clientHeight / 2;
    el.scrollLeft = p.left + (want.box.x + want.box.w / 2) * p.width - el.clientWidth / 2;
  }

  // ---------- the parent's handle ----------

  useEffect(() => {
    if (!registerHandle) return;
    registerHandle({
      showArea(pageId, box) {
        const known = (layoutRef.current ? layoutRef.current.pages : []).some((p) => p.id === pageId);
        if (!known) return false;
        // (gone to once the page is on screen at its real shape)
        pendingShowRef.current = { pageId, box };
        showPending();
        setFollowing(false);
        setFlash({ pageId, ...box, key: Date.now() });
        return true;
      },
    });
    return () => registerHandle(null);
  }, [registerHandle]);

  useEffect(() => {
    showPending();
  }, [layout]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 2400);
    return () => clearTimeout(timer);
  }, [flash]);

  // ---------- pointer gestures ----------

  function touches() {
    return [...pointersRef.current.values()].filter((p) => p.type === "touch");
  }

  // Ends whatever one-finger gesture was going (a second finger landed):
  // nothing it was drawing is kept.
  function abandonGesture() {
    const g = engine.gesture();
    if (!g) return;
    if (g.holdTimer) clearTimeout(g.holdTimer);
    if (g.kind === "erase" || g.kind === "move" || g.kind === "resize") setHidden(null);
    engine.setGesture(null);
  }

  function startPinch() {
    const [a, b] = touches();
    const el = scrollRef.current;
    if (!a || !b || !el) return;
    const rect = el.getBoundingClientRect();
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    engine.setGesture({
      kind: "pinch",
      pageId: null,
      d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)),
      m0: { x: mx, y: my },
      rect0: { left: rect.left, top: rect.top },
      s0: { x: el.scrollLeft, y: el.scrollTop },
      p0: { x: el.scrollLeft + mx - rect.left, y: el.scrollTop + my - rect.top },
      zoom0: zoom,
      k: 1,
      m: { x: mx, y: my },
    });
    userMoved();
  }

  function movePinch(g) {
    const [a, b] = touches();
    if (!a || !b) return;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    // two fingers moving together scroll; only spreading / pinching zooms
    if (!g.zooming && Math.abs(d / g.d0 - 1) > 0.08) g.zooming = true;
    const k = g.zooming ? clamp(d / g.d0, MIN_ZOOM / g.zoom0, MAX_ZOOM / g.zoom0) : 1;
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    g.k = k;
    g.m = m;
    const content = contentRef.current;
    if (!content) return;
    // previewed by stretching what's there (the point that was under the
    // fingers follows them); drawn properly when the fingers lift
    const tx = m.x - g.rect0.left + g.s0.x - k * g.p0.x;
    const ty = m.y - g.rect0.top + g.s0.y - k * g.p0.y;
    content.style.transformOrigin = "0 0";
    content.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
  }

  function endPinch(g) {
    const content = contentRef.current;
    const z = clamp(g.zoom0 * g.k, MIN_ZOOM, MAX_ZOOM);
    // the point that was under the fingers stays under them
    const pp = pagePoint(g.p0.x, g.p0.y);
    if (pp && Math.abs(z - zoom) > 0.001) {
      pendingScrollRef.current = {
        pageId: pp.page.id, u: pp.x / pp.page.width, v: pp.y / pp.page.height,
        sx: g.m.x - g.rect0.left, sy: g.m.y - g.rect0.top,
      };
      setZoom(z);
    } else {
      // no zoom: the fingers moved the document
      if (content) content.style.transform = "";
      const el = scrollRef.current;
      if (el) {
        el.scrollLeft = g.s0.x - (g.m.x - g.m0.x);
        el.scrollTop = g.s0.y - (g.m.y - g.m0.y);
      }
    }
  }

  function commitText() {
    const t = textEdit;
    if (!t) return;
    const el = textRef.current;
    const value = (el ? el.value : t.text).replace(/\s+$/, "");
    setTextEdit(null);
    const pageMarks = marksByPageRef.current.get(t.pageId) || [];
    const before = pageMarks.find((m) => m.id === t.id);
    if (!value) {
      if (before) removeMarks([before]);
      return;
    }
    const mark = { id: t.id, pageId: t.pageId, type: "text", x: t.x, y: t.y, w: t.w, size: t.size, color: t.color, text: value };
    if (before) {
      if (before.text !== value) updateMarks([before], [mark]);
    } else {
      addMarks([mark]);
    }
  }

  // A short, still tap: shows/hides a piece of tape under it.
  function tapOnTape(g, pt) {
    if (readOnly || !onMarks) return false;
    if (Date.now() - g.t0 > TAP_MS || Math.hypot(pt.x - g.c0.x, pt.y - g.c0.y) > TAP_PX) return false;
    const pp = pagePoint(pt.x, pt.y);
    if (!pp || pp.page.id !== (g.pageId || pp.page.id)) return false;
    const list = marksByPageRef.current.get(pp.page.id) || [];
    const tape = tapeAt(list, pp.x, pp.y, pp.page.width, pp.page.height);
    if (!tape) return false;
    updateMarks([tape], [{ ...tape, revealed: !tape.revealed }]);
    return true;
  }

  function selectionBox(pageId, list) {
    const p = layout.pages.find((x) => x.id === pageId);
    if (!p || !list) return null;
    const b = unionMarkBounds(list, p.width, p.height);
    return b ? { p, b } : null;
  }

  function eraseAt(g, x, y, list) {
    let added = false;
    for (const m of list) {
      if (g.ids.has(m.id)) continue;
      if (hitMark(m, x, y, g.W, g.H, g.size / 2)) {
        g.ids.add(m.id);
        added = true;
      }
    }
    if (added) setHidden(new Set(g.ids));
  }

  function straighten(g) {
    const pts = g.mark.points;
    if (pts.length < 2) return;
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot((pts[i].x - pts[i - 1].x) * g.W, (pts[i].y - pts[i - 1].y) * g.H);
    if (len < 24) return;
    g.straight = true;
    g.mark.points = [pts[0], pts[pts.length - 1]];
    engine.schedule(g.pageId);
  }

  function beginTool(e, pt) {
    const pp = pagePoint(pt.x, pt.y);
    if (!pp) return null;
    const { page, x, y } = pp;
    const W = page.width, H = page.height;
    const base = { pageId: page.id, index: pp.index, W, H, t0: Date.now(), c0: pt };
    const list = marksByPageRef.current.get(page.id) || [];

    if (tool === "pen" || tool === "highlighter" || (tool === "eraser" && eraserMode !== "stroke")) {
      const size = SIZES[tool][sizes[tool]];
      const mark = {
        id: newRefId(), pageId: page.id, type: "ink", tool,
        color: tool === "eraser" ? "#000" : colors[tool],
        opacity: tool === "highlighter" ? 0.35 : 1,
        widthFrac: size / REF_W,
        points: [{ x: x / W, y: y / H }],
      };
      return { ...base, kind: "draw", mark, hold: { x, y }, holdTimer: null, straight: false, anchor: null, last: { x, y } };
    }
    if (tool === "eraser") {
      const g = { ...base, kind: "erase", ids: new Set(), size: SIZES.eraser[sizes.eraser] * (W / REF_W) };
      eraseAt(g, x, y, list);
      return g;
    }
    if (tool === "lasso") {
      const sb = selection && selMarks && selection.pageId === page.id ? selectionBox(page.id, selMarks) : null;
      if (sb) {
        const { b } = sb;
        const nearCorner = Math.hypot(x - b.maxX - 6, y - b.maxY - 6) < 26;
        if (nearCorner) {
          setHidden(new Set(selection.ids));
          return { ...base, kind: "resize", start: { x, y }, box: b, scale: 1, ou: b.minX / W, ov: b.minY / H };
        }
        if (x >= b.minX - 10 && x <= b.maxX + 10 && y >= b.minY - 10 && y <= b.maxY + 10) {
          setHidden(new Set(selection.ids));
          return { ...base, kind: "move", start: { x, y }, du: 0, dv: 0 };
        }
      }
      setSelection(null);
      return { ...base, kind: "lasso", poly: [{ x, y }] };
    }
    if (tool === "text") return { ...base, kind: "text", at: { x, y } };
    if (tool === "tape") return { ...base, kind: "tape", start: { x, y }, end: null };
    if (tool === "laser") {
      engine.laser(meId, page.id, [[x / W, y / H]]);
      laserOutRef.current.pageId = page.id;
      laserOutRef.current.pts.push([x / W, y / H]);
      return { ...base, kind: "laser" };
    }
    if (tool === "clip") {
      const c = clip && clip.pageId === page.id ? clip.box : null;
      if (c) {
        const bx = c.x * W, by = c.y * H, bw = c.w * W, bh = c.h * H;
        const corners = [[bx, by, "tl"], [bx + bw, by, "tr"], [bx, by + bh, "bl"], [bx + bw, by + bh, "br"]];
        const corner = corners.find(([cx, cy]) => Math.hypot(x - cx, y - cy) < 26);
        if (corner) return { ...base, kind: "clip", mode: corner[2], orig: c, start: { x, y }, box: c };
        if (x >= bx && x <= bx + bw && y >= by && y <= by + bh) return { ...base, kind: "clip", mode: "move", orig: c, start: { x, y }, box: c };
      }
      setClip(null);
      return { ...base, kind: "clip", mode: "new", start: { x, y }, box: null };
    }
    return null;
  }

  function moveTool(g, e, pt) {
    const x = pt.x - layout.pages[g.index].left;
    const y = pt.y - layout.pages[g.index].top;
    const { W, H } = g;
    if (g.kind === "draw") {
      const events = e.nativeEvent && e.nativeEvent.getCoalescedEvents ? e.nativeEvent.getCoalescedEvents() : [];
      const list = events.length ? events : [e.nativeEvent || e];
      const rect = contentRef.current.getBoundingClientRect();
      const page = layout.pages[g.index];
      if (e.shiftKey || g.straight) {
        // a straight line from where it started (Shift snaps to 15°)
        const first = g.mark.points[0];
        let ex = x / W, ey = y / H;
        if (e.shiftKey) {
          const dx = (ex - first.x) * W, dy = (ey - first.y) * H;
          const dist = Math.hypot(dx, dy);
          const step = Math.PI / 12;
          const ang = Math.round(Math.atan2(dy, dx) / step) * step;
          ex = first.x + (Math.cos(ang) * dist) / W;
          ey = first.y + (Math.sin(ang) * dist) / H;
        }
        g.mark.points = [first, { x: ex, y: ey }];
      } else {
        for (const ev of list) {
          g.mark.points.push({ x: (ev.clientX - rect.left - page.left) / W, y: (ev.clientY - rect.top - page.top) / H });
        }
        // held still: the line straightens
        if (Math.hypot(x - g.hold.x, y - g.hold.y) > 3) {
          g.hold = { x, y };
          if (g.holdTimer) clearTimeout(g.holdTimer);
          if (g.mark.tool !== "eraser" && getSetting("holdStraighten")) g.holdTimer = setTimeout(() => straighten(g), HOLD_MS);
        }
      }
      engine.schedule(g.pageId);
      return;
    }
    if (g.kind === "erase") {
      eraseAt(g, x, y, marksByPageRef.current.get(g.pageId) || []);
      return;
    }
    if (g.kind === "lasso") {
      g.poly.push({ x, y });
      engine.schedule(g.pageId);
      return;
    }
    if (g.kind === "move") {
      g.du = (x - g.start.x) / W;
      g.dv = (y - g.start.y) / H;
      engine.schedule(g.pageId);
      return;
    }
    if (g.kind === "resize") {
      const b = g.box;
      const w0 = Math.max(4, b.maxX - b.minX), h0 = Math.max(4, b.maxY - b.minY);
      g.scale = clamp(Math.max((x - b.minX) / w0, (y - b.minY) / h0), 0.15, 8);
      engine.schedule(g.pageId);
      return;
    }
    if (g.kind === "tape") {
      g.end = { x, y };
      engine.schedule(g.pageId);
      return;
    }
    if (g.kind === "laser") {
      engine.laser(meId, g.pageId, [[x / W, y / H]]);
      const out = laserOutRef.current;
      out.pageId = g.pageId;
      out.pts.push([x / W, y / H]);
      if (!out.timer && onLaser) {
        out.timer = setTimeout(() => {
          out.timer = null;
          if (out.pts.length) onLaser({ pageId: out.pageId, pts: out.pts.splice(0) });
        }, 50);
      }
      return;
    }
    if (g.kind === "clip") {
      const fx = clamp(x / W, 0, 1), fy = clamp(y / H, 0, 1);
      const sx = g.start.x / W, sy = g.start.y / H;
      const o = g.orig;
      let box;
      if (g.mode === "new") box = { x: Math.min(sx, fx), y: Math.min(sy, fy), w: Math.abs(fx - sx), h: Math.abs(fy - sy) };
      else if (g.mode === "move") {
        box = { ...o, x: clamp(o.x + fx - sx, 0, 1 - o.w), y: clamp(o.y + fy - sy, 0, 1 - o.h) };
      } else {
        let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
        if (g.mode.includes("l")) x0 = fx;
        if (g.mode.includes("r")) x1 = fx;
        if (g.mode.includes("t")) y0 = fy;
        if (g.mode.includes("b")) y1 = fy;
        box = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
      }
      g.box = box;
      engine.schedule(g.pageId);
    }
  }

  function endTool(g, pt) {
    if (g.holdTimer) clearTimeout(g.holdTimer);
    const list = marksByPageRef.current.get(g.pageId) || [];
    if (g.kind === "draw") {
      if (tapOnTape(g, pt)) return;
      const m = g.mark;
      if (m.tool === "eraser" && m.points.length < 2) return;
      addMarks([m]);
      return;
    }
    if (g.kind === "erase") {
      const gone = list.filter((m) => g.ids.has(m.id));
      setHidden(null);
      removeMarks(gone);
      return;
    }
    if (g.kind === "lasso") {
      const picked = marksInLasso(list, g.poly, g.W, g.H);
      setSelection(picked.length ? { pageId: g.pageId, ids: picked.map((m) => m.id) } : null);
      return;
    }
    if (g.kind === "move" || g.kind === "resize") {
      setHidden(null);
      if (!selMarks) return;
      const moved = Math.abs(g.du || 0) > 1e-4 || Math.abs(g.dv || 0) > 1e-4 || Math.abs((g.scale || 1) - 1) > 1e-3;
      if (!moved) return;
      const after = selMarks.map((m) => transformMark(m, g.du || 0, g.dv || 0, g.scale || 1, g.ou || 0, g.ov || 0));
      updateMarks(selMarks, after);
      return;
    }
    if (g.kind === "text") {
      if (tapOnTape(g, pt)) return;
      const existing = textAt(list, g.at.x, g.at.y, g.W, g.H);
      const size = SIZES.text[sizes.text] / REF_W;
      const x = g.at.x / g.W;
      const next = existing
        ? { ...existing, isNew: false }
        : {
            id: newRefId(), pageId: g.pageId, isNew: true, x, y: clamp(g.at.y / g.H - (size * g.W * 0.6) / g.H, 0, 1),
            w: clamp(0.98 - x, 0.12, 0.5), size, color: colors.text, text: "",
          };
      // shown straight away, so the keyboard can open (iPads only allow
      // that during the tap itself)
      flushSync(() => setTextEdit(next));
      if (textRef.current) textRef.current.focus();
      return;
    }
    if (g.kind === "tape") {
      if (!g.end || Math.abs(g.end.x - g.start.x) < 8 || Math.abs(g.end.y - g.start.y) < 6) {
        tapOnTape(g, pt);
        return;
      }
      const x0 = Math.min(g.start.x, g.end.x), y0 = Math.min(g.start.y, g.end.y);
      addMarks([{
        id: newRefId(), pageId: g.pageId, type: "tape", color: TAPE_COLOR, revealed: false,
        x: x0 / g.W, y: y0 / g.H, w: Math.abs(g.end.x - g.start.x) / g.W, h: Math.abs(g.end.y - g.start.y) / g.H,
      }]);
      return;
    }
    if (g.kind === "laser") {
      const out = laserOutRef.current;
      if (out.timer) clearTimeout(out.timer);
      out.timer = null;
      if (onLaser && out.pts.length) onLaser({ pageId: out.pageId, pts: out.pts.splice(0) });
      if (onLaser) onLaser({ end: true });
      return;
    }
    if (g.kind === "clip") {
      const b = g.box;
      if (b && b.w * g.W > 12 && b.h * g.H > 12) setClip({ pageId: g.pageId, box: b, withMarks: clip ? clip.withMarks : true });
      else if (g.mode !== "new" && g.orig) setClip({ pageId: g.pageId, box: g.orig, withMarks: clip ? clip.withMarks : true });
    }
  }

  function onPointerDown(e) {
    if (e.pointerType === "pen") {
      notePenActivity();
      markPenSeen();
      if (isPencilOnlyUndecided()) setPencilOnly(true);
    }
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
    stopMomentum();
    if (popover) setPopover(false);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType, t: Date.now() });
    try {
      contentRef.current.setPointerCapture(e.pointerId);
    } catch (err) {
      // (old browsers) the gesture still works while over the pages
    }
    if (e.pointerType === "touch" && touches().length >= 2) {
      const g = engine.gesture();
      if (g && g.kind !== "pinch") abandonGesture();
      if (!engine.gesture()) startPinch();
      return;
    }
    if (engine.gesture()) return;
    if (textEdit) {
      // a tap elsewhere finishes the text box
      commitText();
      return;
    }
    const pt = contentPoint(e);
    const fingerScrolls = e.pointerType === "touch" && (pencilOnly || readOnly);
    if (readOnly || tool === "hand" || fingerScrolls || e.button === 1 || !onMarks) {
      engine.setGesture({
        kind: "pan", pageId: null, pointerId: e.pointerId, last: { x: e.clientX, y: e.clientY },
        samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }], t0: Date.now(), c0: pt, touch: e.pointerType === "touch",
      });
      return;
    }
    const g = beginTool(e, pt);
    if (g) {
      g.pointerId = e.pointerId;
      engine.setGesture(g);
    }
  }

  function onPointerMove(e) {
    const known = pointersRef.current.get(e.pointerId);
    if (!known) return;
    known.x = e.clientX;
    known.y = e.clientY;
    const g = engine.gesture();
    if (!g) return;
    if (g.kind === "pinch") {
      movePinch(g);
      return;
    }
    if (g.pointerId !== e.pointerId) return;
    if (g.kind === "pan") {
      const el = scrollRef.current;
      el.scrollLeft -= e.clientX - g.last.x;
      el.scrollTop -= e.clientY - g.last.y;
      if (Math.hypot(e.clientX - g.samples[0].x, e.clientY - g.samples[0].y) > TAP_PX) userMoved();
      g.last = { x: e.clientX, y: e.clientY };
      const now = performance.now();
      g.samples.push({ x: e.clientX, y: e.clientY, t: now });
      while (g.samples.length > 2 && now - g.samples[0].t > 100) g.samples.shift();
      return;
    }
    moveTool(g, e, contentPoint(e));
  }

  function onPointerUp(e) {
    const wasTouch = pointersRef.current.get(e.pointerId);
    pointersRef.current.delete(e.pointerId);
    const g = engine.gesture();
    if (!g) return;
    if (g.kind === "pinch") {
      if (touches().length < 2) {
        endPinch(g);
        // (the finger still down does nothing until it lifts too)
        engine.setGesture(touches().length ? { kind: "idle", pageId: null, pointerId: -1 } : null);
      }
      return;
    }
    if (g.kind === "idle") {
      if (!pointersRef.current.size) engine.setGesture(null);
      return;
    }
    if (g.pointerId !== e.pointerId) return;
    engine.setGesture(null);
    if (e.type === "pointercancel") {
      if (g.kind === "erase" || g.kind === "move" || g.kind === "resize") setHidden(null);
      return;
    }
    const pt = contentPoint(e);
    if (g.kind === "pan") {
      if (tapOnTape(g, pt)) return;
      if (wasTouch && wasTouch.type === "touch" && g.samples.length > 1) {
        const a = g.samples[0], b = g.samples[g.samples.length - 1];
        const dt = Math.max(1, b.t - a.t);
        const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
        if (Math.hypot(vx, vy) > 0.15 && performance.now() - b.t < 80) momentumRef.current = startMomentum(scrollRef.current, vx, vy);
      }
      return;
    }
    endTool(g, pt);
  }

  // ---------- selection actions ----------

  function recolourSelection(color) {
    if (!selMarks) return;
    const after = selMarks.map((m) => (m.type === "ink" || m.type === "text" ? { ...m, color } : m));
    updateMarks(selMarks, after);
  }

  function deleteSelection() {
    if (!selMarks) return;
    removeMarks(selMarks);
    setSelection(null);
  }

  async function clipToBoard(pageId, box, withMarks) {
    const entry = pages.find((p) => p.id === pageId);
    if (!entry || !onClip || clipBusy) return;
    setClipBusy(true);
    const number = pageNumberOf(doc, pageId);
    const label = `p. ${number} · ${doc.fileName || "Document"}`;
    const image = entry.kind === "image" ? images[entry.url] : null;
    const clipMarks = withMarks ? marksByPage.get(pageId) || [] : null;
    const result = await renderClip({ pdfDoc, entry, image, box, marks: clipMarks, caption: label }).catch((err) => {
      console.error("Couldn't make the clip:", err);
      return null;
    });
    if (!result) {
      setClipBusy(false);
      window.alert("Couldn't clip that part of the page. Please try again.");
      return;
    }
    const source = { kind: "clip", pageId, box, page: number, fileName: doc.fileName || "", docPath: (doc.pdf && doc.pdf.path) || doc.path || "" };
    const added = await Promise.resolve(onClip({ ...result, source })).then(
      () => true,
      (err) => {
        console.error("Couldn't add the clip:", err);
        return false;
      }
    );
    if (added) setClip(null);
    setClipBusy(false);
  }

  function clipSelection() {
    if (!selMarks || !selection) return;
    const p = layout.pages.find((x) => x.id === selection.pageId);
    const b = p && unionMarkBounds(selMarks, p.width, p.height);
    if (!b) return;
    const pad = 12;
    const box = {
      x: clamp((b.minX - pad) / p.width, 0, 1),
      y: clamp((b.minY - pad) / p.height, 0, 1),
    };
    box.w = clamp((b.maxX + pad) / p.width, 0, 1) - box.x;
    box.h = clamp((b.maxY + pad) / p.height, 0, 1) - box.y;
    clipToBoard(selection.pageId, box, true);
  }

  // ---------- page changes (the board's owner) ----------

  // Undo / redo steps about a page that has been turned or taken out
  // would put things back in the wrong place: they go.
  function forgetPageHistory(pageId) {
    const about = (e) => [...(e.marks || []), ...(e.before || []), ...(e.after || [])].some((m) => m.pageId === pageId);
    setHistory((h) => ({ undo: h.undo.filter((e) => !about(e)), redo: h.redo.filter((e) => !about(e)) }));
  }

  function rotatePage(pageId) {
    if (!onPagesChange) return;
    const entry = pages.find((p) => p.id === pageId);
    if (!entry) return;
    const aspect = aspectOf(aspects, entry);
    const next = pages.map((p) => (p.id === pageId ? { ...p, rotate: (((p.rotate || 0) + 90) % 360) } : p));
    const list = marksByPage.get(pageId) || [];
    onPagesChange(next, { update: list.map((m) => rotateMarkClockwise(m, aspect)) });
    forgetPageHistory(pageId);
    setSelection(null);
  }

  function removePage(pageId) {
    if (!onPagesChange || pages.length <= 1) return;
    if (!window.confirm("Take this page out of the document? Anything written on it goes too.")) return;
    const list = marksByPage.get(pageId) || [];
    onPagesChange(pages.filter((p) => p.id !== pageId), { remove: list.map((m) => m.id) });
    forgetPageHistory(pageId);
    setSelection(null);
  }

  function addBlankPage(afterId, style) {
    if (!onPagesChange || pages.length >= REF_MAX_PAGES) return;
    const at = pages.findIndex((p) => p.id === afterId);
    const next = pages.slice();
    next.splice(at + 1, 0, { id: newRefId(), kind: "blank", style, rotate: 0 });
    onPagesChange(next, null);
  }

  // ---------- rendering ----------

  if (!doc) return null;

  const activeTool = TOOLS.find((t) => t.id === tool);
  const styleKey = tool === "eraser" ? "eraser" : tool === "highlighter" ? "highlighter" : tool === "text" ? "text" : "pen";
  const showStyle = !readOnly && ["pen", "highlighter", "eraser", "text"].includes(tool);
  const sizeList = SIZES[styleKey];
  const colorList = styleKey === "highlighter" ? HIGHLIGHT_COLORS : PEN_COLORS;
  const currentColor = colors[styleKey] || "#1a1a1a";
  const pageCount = pages.length;

  // where the selection's / clip's buttons go (content px)
  let selBar = null;
  if (selection && selMarks) {
    const sb = selectionBox(selection.pageId, selMarks);
    if (sb) selBar = { left: sb.p.left + (sb.b.minX + sb.b.maxX) / 2, top: sb.p.top + sb.b.maxY + 16 };
  }
  let clipBar = null;
  if (clip) {
    const p = layout.pages.find((x) => x.id === clip.pageId);
    if (p) clipBar = { left: p.left + (clip.box.x + clip.box.w / 2) * p.width, top: p.top + (clip.box.y + clip.box.h) * p.height + 14 };
  }
  let textBox = null;
  if (textEdit) {
    const p = layout.pages.find((x) => x.id === textEdit.pageId);
    if (p) {
      textBox = {
        left: p.left + textEdit.x * p.width,
        top: p.top + textEdit.y * p.height,
        width: textEdit.w * p.width,
        fontSize: textEdit.size * p.width,
      };
    }
  }

  const leaderBanner = leader && !leading;

  return (
    <div className={s.pane}>
      {!readOnly && (
        <div className={s.toolbar} role="toolbar" aria-label="Document tools">
          {TOOLS.map(({ id, label, Icon }) => (
            <PalmSafeButton key={id} className={toolButtonClass(tool === id)} onPress={() => setTool(id)} title={label} aria-label={label} aria-pressed={tool === id}>
              <Icon size={19} strokeWidth={1.9} />
            </PalmSafeButton>
          ))}
          <span className={s.divider} />
          {showStyle && (
            <PalmSafeButton className={s.styleBtn} onPress={() => setPopover(!popover)} aria-label={`${activeTool.label}: colour and size`} aria-expanded={popover}>
              {tool !== "eraser" && <span className={s.styleDot} style={{ background: currentColor }} />}
              <span className={s.styleSize} style={{ height: Math.max(2, Math.min(9, sizeList[sizes[styleKey]] / (styleKey === "highlighter" ? 3 : styleKey === "eraser" ? 4 : styleKey === "text" ? 3 : 0.6))) }} />
            </PalmSafeButton>
          )}
          <PalmSafeButton className={s.toolBtn} onPress={undo} disabled={!history.undo.length} title="Undo" aria-label="Undo">
            <Undo2 size={19} strokeWidth={1.9} />
          </PalmSafeButton>
          <PalmSafeButton className={s.toolBtn} onPress={redo} disabled={!history.redo.length} title="Redo" aria-label="Redo">
            <Redo2 size={19} strokeWidth={1.9} />
          </PalmSafeButton>
          <span className={s.divider} />
          <PalmSafeButton className={toolButtonClass(panel === "pages")} onPress={() => setPanel(panel === "pages" ? null : "pages")} title="Pages" aria-label="Pages" aria-pressed={panel === "pages"}>
            <GalleryVerticalEnd size={19} strokeWidth={1.9} />
          </PalmSafeButton>
          {pdfDoc && (
            <PalmSafeButton className={toolButtonClass(panel === "search")} onPress={() => setPanel(panel === "search" ? null : "search")} title="Find words in the document" aria-label="Find words in the document" aria-pressed={panel === "search"}>
              <Search size={19} strokeWidth={1.9} />
            </PalmSafeButton>
          )}
          {onView && (
            <PalmSafeButton className={toolButtonClass(leading)} onPress={toggleLeading} title="Follow me: everyone sees the page you're on" aria-label="Follow me" aria-pressed={leading}>
              <Users size={19} strokeWidth={1.9} />
            </PalmSafeButton>
          )}
          {popover && showStyle && (
            <div className={s.popover} role="dialog" aria-label="Colour and size">
              {tool !== "eraser" && (
                <div className={s.popRow}>
                  {colorList.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`${s.swatch} ${currentColor === c ? s.swatchOn : ""}`}
                      aria-label={`Colour ${c}`}
                      aria-pressed={currentColor === c}
                      onClick={() => setColors((prev) => ({ ...prev, [styleKey]: c }))}
                    >
                      <span style={{ background: c }} />
                    </button>
                  ))}
                  <label className={s.customColor} aria-label="Pick any colour">
                    <span />
                    <input type="color" value={currentColor} onChange={(e) => setColors((prev) => ({ ...prev, [styleKey]: e.target.value }))} />
                  </label>
                </div>
              )}
              <div className={s.popRow}>
                {sizeList.map((px, i) => {
                  const dot = Math.max(4, Math.min(24, styleKey === "text" ? px : styleKey === "pen" ? px * 2.4 : px * 0.7));
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`${s.sizeBtn} ${sizes[styleKey] === i ? s.sizeBtnOn : ""}`}
                      aria-label={["Small", "Medium", "Large"][i]}
                      aria-pressed={sizes[styleKey] === i}
                      onClick={() => setSizes((prev) => ({ ...prev, [styleKey]: i }))}
                    >
                      {styleKey === "text" ? (
                        <b style={{ fontSize: dot }}>A</b>
                      ) : (
                        <span style={{ width: dot, height: dot }} />
                      )}
                    </button>
                  );
                })}
              </div>
              {tool === "eraser" && (
                <div className={s.segment} role="group" aria-label="Eraser">
                  <button type="button" className={eraserMode !== "stroke" ? s.segOn : ""} onClick={() => setEraserMode("precise")}>
                    Part of a line
                  </button>
                  <button type="button" className={eraserMode === "stroke" ? s.segOn : ""} onClick={() => setEraserMode("stroke")}>
                    Whole lines
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {readOnly && (
        <div className={s.toolbar} role="toolbar" aria-label="Document">
          <PalmSafeButton className={toolButtonClass(panel === "pages")} onPress={() => setPanel(panel === "pages" ? null : "pages")} title="Pages" aria-label="Pages" aria-pressed={panel === "pages"}>
            <GalleryVerticalEnd size={19} strokeWidth={1.9} />
          </PalmSafeButton>
          {pdfDoc && (
            <PalmSafeButton className={toolButtonClass(panel === "search")} onPress={() => setPanel(panel === "search" ? null : "search")} title="Find words in the document" aria-label="Find words in the document" aria-pressed={panel === "search"}>
              <Search size={19} strokeWidth={1.9} />
            </PalmSafeButton>
          )}
        </div>
      )}

      {leading && (
        <div className={s.banner}>
          <Users size={16} strokeWidth={1.9} />
          <span>Everyone here is following your page.</span>
          <button type="button" className={s.bannerBtn} onClick={toggleLeading}>
            Stop
          </button>
        </div>
      )}
      {leaderBanner && (
        <div className={s.banner}>
          <Users size={16} strokeWidth={1.9} />
          <span>{following ? `Following ${leader.name}'s page` : `${leader.name} is showing a page`}</span>
          <button
            type="button"
            className={s.bannerBtn}
            onClick={() => {
              if (!following) followRef.current.leaderSeen = Date.now();
              setFollowing(!following);
            }}
          >
            {following ? "Stop following" : "Follow"}
          </button>
        </div>
      )}

      <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div
          ref={(el) => {
            scrollRef.current = el;
            if (el !== scrollRoot) setScrollRoot(el);
          }}
          id={scrollId}
          className={s.scroller}
          onScroll={onScroll}
          data-ref-scroller="true"
        >
          {pdfStatus === "loading" && <div className={`${s.status} ${s.statusHand}`}>Loading document…</div>}
          {pdfStatus === "error" && <div className={s.status}>Couldn&apos;t load this document.</div>}
          {pdfStatus === "unsupported" && <div className={s.status}>{PDF_UNSUPPORTED_MESSAGE}</div>}
          <div
            ref={contentRef}
            className={s.content}
            style={{ width: layout.width, height: Math.max(layout.height, 1), cursor: tool === "hand" || readOnly ? "grab" : "crosshair" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onContextMenu={(e) => e.preventDefault()}
            data-ref-content="true"
          >
            {(pdfStatus === "ready" || pdfStatus === "none" || pages.some((p) => p.kind !== "pdf")) &&
              layout.pages.map((p, i) =>
                p.entry.kind === "pdf" && !pdfDoc ? null : (
                  <RefPage
                    key={p.id}
                    entry={p.entry}
                    number={i + 1}
                    left={p.left}
                    top={p.top}
                    width={p.width}
                    height={p.height}
                    scrollRoot={scrollRoot}
                    pdfDoc={pdfDoc}
                    image={p.entry.kind === "image" ? images[p.entry.url] || null : null}
                    marks={marksByPage.get(p.id)}
                    hidden={hidden}
                    editingId={textEdit && textEdit.pageId === p.id ? textEdit.id : null}
                    register={engine.register}
                    highlights={hits && hits.pageId === p.id ? hits.rects : null}
                    flash={flash && flash.pageId === p.id ? flash : null}
                  />
                )
              )}
            {selBar && (
              <div className={s.floatBar} style={{ left: selBar.left, top: selBar.top }} onPointerDown={(e) => e.stopPropagation()}>
                {PEN_COLORS.slice(0, 5).map((c) => (
                  <button key={c} type="button" className={s.floatSwatch} style={{ background: c }} aria-label={`Make it ${c}`} onClick={() => recolourSelection(c)} />
                ))}
                <button type="button" className={s.floatBtn} onClick={clipSelection} disabled={clipBusy || !onClip}>
                  <Crop size={16} strokeWidth={1.9} />
                  Clip to board
                </button>
                <button type="button" className={`${s.floatBtn} ${s.floatBtnDanger}`} onClick={deleteSelection}>
                  <Trash2 size={16} strokeWidth={1.9} />
                  Delete
                </button>
              </div>
            )}
            {clipBar && (
              <div className={s.floatBar} style={{ left: clipBar.left, top: clipBar.top }} onPointerDown={(e) => e.stopPropagation()}>
                <label className={s.check}>
                  <input type="checkbox" checked={clip.withMarks} onChange={(e) => setClip({ ...clip, withMarks: e.target.checked })} />
                  With my markings
                </label>
                <button type="button" className={s.floatBtn} onClick={() => setClip(null)}>
                  <X size={16} strokeWidth={1.9} />
                  Cancel
                </button>
                <button
                  type="button"
                  className={`${s.floatBtn} ${s.floatBtnPrimary}`}
                  disabled={clipBusy || !onClip}
                  onClick={() => clipToBoard(clip.pageId, clip.box, clip.withMarks)}
                >
                  <Check size={16} strokeWidth={2.2} />
                  {clipBusy ? "Adding…" : "Add to board"}
                </button>
              </div>
            )}
            {textBox && (
              <textarea
                key={textEdit.id}
                ref={textRef}
                className={s.textEditor}
                defaultValue={textEdit.text}
                autoFocus
                aria-label="Text on the document"
                placeholder="Type here"
                rows={1}
                onPointerDown={(e) => e.stopPropagation()}
                onBlur={commitText}
                onInput={(e) => {
                  e.currentTarget.style.height = "auto";
                  e.currentTarget.style.height = `${e.currentTarget.scrollHeight + 2}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") e.currentTarget.blur();
                }}
                style={{
                  left: textBox.left,
                  top: textBox.top,
                  width: textBox.width,
                  fontSize: textBox.fontSize,
                  color: textEdit.color,
                  minHeight: textBox.fontSize * 1.3,
                }}
              />
            )}
          </div>
        </div>

        {pageCount > 1 && (
          <div ref={trackRef} className={s.handleTrack} style={{ top: 8, bottom: 56 }}>
            <div
              ref={handleElRef}
              className={s.handle}
              role="scrollbar"
              aria-controls={scrollId}
              aria-orientation="vertical"
              aria-label="Drag to move through the pages"
              aria-valuemin={1}
              aria-valuemax={pageCount}
              aria-valuenow={currentPage + 1}
              tabIndex={0}
              onPointerDown={onHandleDown}
              onPointerMove={onHandleMove}
              onPointerUp={onHandleUp}
              onPointerCancel={onHandleUp}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "PageDown") goToPage(Math.min(pageCount - 1, currentPage + 1));
                if (e.key === "ArrowUp" || e.key === "PageUp") goToPage(Math.max(0, currentPage - 1));
              }}
            >
              <i />
              <i />
              <i />
              {handleBubble && (
                <span className={s.handleBubble}>
                  Page {currentPage + 1} of {pageCount}
                </span>
              )}
            </div>
          </div>
        )}

        <div className={s.cornerBox}>
          <div className={s.chip}>
            <button type="button" aria-label="Zoom out" onClick={() => zoomTo(zoom / 1.25)}>
              <Minus size={16} strokeWidth={2} />
            </button>
            <button type="button" aria-label="Fit the page to the width" title="Fit to width" onClick={() => zoomTo(1)}>
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" aria-label="Zoom in" onClick={() => zoomTo(zoom * 1.25)}>
              <Plus size={16} strokeWidth={2} />
            </button>
          </div>
          {pageCount > 1 && (
            <div className={s.chip}>
              <span className={s.chipText} aria-live="polite">
                {currentPage + 1} / {pageCount}
              </span>
            </div>
          )}
        </div>

        {panel === "pages" && (
          <RefPagesPanel
            doc={doc}
            pdfDoc={pdfDoc}
            images={images}
            currentPage={currentPage}
            canEdit={canEditPages && !readOnly && !!onPagesChange}
            canAdd={pages.length < REF_MAX_PAGES}
            onGo={(i) => {
              goToPage(i);
              if (compact) setPanel(null);
            }}
            onRotate={rotatePage}
            onRemove={removePage}
            onAddBlank={addBlankPage}
            onAddFromFile={onAddPages}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === "search" && pdfDoc && (
          <RefSearchPanel
            doc={doc}
            pdfDoc={pdfDoc}
            onGo={(pageId, rects) => {
              const i = layout.pages.findIndex((p) => p.id === pageId);
              setHits({ pageId, rects });
              goToPage(i, rects[0]);
              if (compact) setPanel(null);
            }}
            onClose={() => {
              setPanel(null);
              setHits(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
