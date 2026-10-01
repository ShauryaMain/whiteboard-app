"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import ReferencePane from "./ReferencePane";
import { renderGrid } from "@/lib/gridRenderer";
import { applyBackground, normalizeBackground } from "@/lib/boardBackground";
import { translateStroke, translateText, translateImage } from "@/lib/boardObjects";
import cls from "./Classroom.module.css";

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const STATE_REQUEST_RETRY_MS = 3000;

function distance(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function smoothPath(ctx, pts, startIdx, endIdx) {
  if (endIdx - startIdx < 1) return;
  ctx.beginPath();
  ctx.moveTo(pts[startIdx].x, pts[startIdx].y);
  if (endIdx - startIdx === 1) {
    ctx.lineTo(pts[endIdx].x, pts[endIdx].y);
  } else {
    for (let i = startIdx + 1; i < endIdx; i++) {
      const xc = (pts[i].x + pts[i + 1].x) / 2;
      const yc = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
    }
    ctx.lineTo(pts[endIdx].x, pts[endIdx].y);
  }
  ctx.stroke();
}

function strokeSegment(ctx, p0, p1, width) {
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.stroke();
}

function drawVariableWidthPath(ctx, pts, startIdx, endIdx, fallbackWidth) {
  for (let i = startIdx; i < endIdx; i++) {
    const w0 = pts[i].w ?? fallbackWidth;
    const w1 = pts[i + 1].w ?? fallbackWidth;
    strokeSegment(ctx, pts[i], pts[i + 1], (w0 + w1) / 2);
  }
}

function drawStroke(ctx, stroke) {
  if (!stroke || !stroke.points || stroke.points.length < 2) return;
  if (stroke.tool === "eraser") {
    // Punch a transparent hole (like the teacher's board) so the page
    // background shows through instead of a white smear.
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "#000000";
    drawVariableWidthPath(ctx, stroke.points, 0, stroke.points.length - 1, stroke.width);
    ctx.globalCompositeOperation = "source-over";
  } else {
    ctx.globalAlpha = stroke.opacity ?? 1;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = "round";
    smoothPath(ctx, stroke.points, 0, stroke.points.length - 1);
  }
  ctx.globalAlpha = 1;
}

function wrapTextLines(ctx, textContent, fontSize, maxWidth) {
  ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
  const paragraphs = String(textContent).split("\n");
  const lines = [];
  for (const para of paragraphs) {
    if (para === "") {
      lines.push("");
      continue;
    }
    const words = para.split(" ");
    let currentLine = "";
    for (const word of words) {
      const testLine = currentLine ? currentLine + " " + word : word;
      const testWidth = ctx.measureText(testLine).width;
      if (testWidth > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    lines.push(currentLine);
  }
  return lines;
}

function drawTexts(ctx, textsArr) {
  for (const t of textsArr) {
    const lines = wrapTextLines(ctx, t.text, t.fontSize, t.width || 240);
    const lineHeight = t.fontSize * 1.3;
    const boxHeight = lines.length * lineHeight;
    const center = { x: t.x + (t.width || 240) / 2, y: t.y + boxHeight / 2 };
    const rotation = t.rotation || 0;

    ctx.save();
    if (rotation) {
      ctx.translate(center.x, center.y);
      ctx.rotate(rotation);
      ctx.translate(-center.x, -center.y);
    }
    ctx.fillStyle = t.color;
    ctx.font = `${t.fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textBaseline = "top";
    lines.forEach((line, i) => ctx.fillText(line, t.x, t.y + i * lineHeight));
    ctx.restore();
  }
}

// Same graph renderer as the teacher's board (and the graph dialog's
// preview), so students see exactly the graph the teacher placed.
function drawGrid(ctx, grid, scale) {
  if (!grid) return;
  const { x, y, size, cols } = grid;
  renderGrid(ctx, grid, { cellPx: size / cols, originXPx: x, originYPx: y, lineScale: 1 / scale });
}

export default function ClassroomBoardViewer({ boardId }) {
  const router = useRouter();
  const canvasRef = useRef(null);
  const boardPaneRef = useRef(null);
  const ctxRef = useRef(null);
  const panRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const channelRef = useRef(null);
  const remoteStrokes = useRef({});
  const strokesRef = useRef([]);
  const textsRef = useRef([]);
  const gridConfigRef = useRef(null);
  const backgroundRef = useRef("blank");
  const backgroundCssKeyRef = useRef("");
  const pageBgRef = useRef(null);
  const touchPoints = useRef(new Map());
  const panZoomState = useRef(null);
  const panDragActive = useRef(false);
  const panDragStart = useRef(null);
  const hasReceivedSnapshot = useRef(false);

  const [strokes, setStrokes] = useState([]);
  const [texts, setTexts] = useState([]);
  const [images, setImages] = useState([]);
  const imagesRef = useRef([]);
  const imageNodesRef = useRef({});
  const [connectionStatus, setConnectionStatus] = useState("connecting"); // connecting | live | waiting
  const [referenceDoc, setReferenceDoc] = useState(null);
  const [referenceStrokes, setReferenceStrokes] = useState([]);

  useEffect(() => { strokesRef.current = strokes; }, [strokes]);
  useEffect(() => { textsRef.current = texts; }, [texts]);
  useEffect(() => { imagesRef.current = images; }, [images]);

  function getPaneSize() {
    const el = boardPaneRef.current;
    if (!el) return { width: window.innerWidth, height: window.innerHeight };
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  function screenToWorld(p) {
    return {
      x: (p.x - panRef.current.x) / scaleRef.current,
      y: (p.y - panRef.current.y) / scaleRef.current,
    };
  }

  function repositionImages() {
    const scale = scaleRef.current;
    const pan = panRef.current;
    for (const img of imagesRef.current) {
      const el = imageNodesRef.current[img.id];
      if (!el) continue;
      el.style.left = img.x * scale + pan.x + "px";
      el.style.top = img.y * scale + pan.y + "px";
      el.style.width = img.width * scale + "px";
      el.style.height = img.height * scale + "px";
    }
  }

  function fullRedraw() {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const scale = scaleRef.current;
    const pan = panRef.current;

    ctx.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * pan.x, ratio * pan.y);
    const { width: paneW, height: paneH } = getPaneSize();
    ctx.clearRect(-pan.x / scale, -pan.y / scale, paneW / scale, paneH / scale);

    for (const stroke of strokesRef.current) drawStroke(ctx, stroke);
    for (const key in remoteStrokes.current) drawStroke(ctx, remoteStrokes.current[key]);
    drawTexts(ctx, textsRef.current);
    drawGrid(ctx, gridConfigRef.current, scale);
    applyBackground(pageBgRef.current, backgroundRef.current, scale, pan, backgroundCssKeyRef);
    repositionImages();
  }

  // Realtime: connects to the board's own existing channel (the exact
  // same one the teacher's normal whiteboard already broadcasts on), and
  // asks for a state snapshot since this viewer has no database access —
  // students never logged in, by design.
  useEffect(() => {
    if (!boardId) return;
    const channel = supabase.channel(`board-${boardId}`, {
      config: { broadcast: { self: false } },
    });

    function requestSnapshot() {
      if (hasReceivedSnapshot.current) return;
      channel.send({ type: "broadcast", event: "classroom-state-request", payload: {} });
    }

    channel.on("broadcast", { event: "classroom-state-snapshot" }, ({ payload }) => {
      hasReceivedSnapshot.current = true;
      setStrokes(payload.strokes || []);
      setTexts(payload.texts || []);
      gridConfigRef.current = payload.grid || null;
      backgroundRef.current = normalizeBackground(payload.background);
      setImages(payload.images || []);
      setReferenceDoc(payload.referenceDoc || null);
      setReferenceStrokes(payload.referenceStrokes || []);
      setConnectionStatus("live");
      fullRedraw();
    });

    channel.on("broadcast", { event: "stroke-start" }, ({ payload }) => {
      remoteStrokes.current[payload.strokeKey] = {
        id: payload.strokeId,
        tool: payload.tool,
        color: payload.color,
        width: payload.width,
        opacity: payload.opacity,
        points: [payload.point],
      };
    });

    channel.on("broadcast", { event: "stroke-points" }, ({ payload }) => {
      const s = remoteStrokes.current[payload.strokeKey];
      if (!s) return;
      s.points.push(...payload.points);
      fullRedraw();
    });

    channel.on("broadcast", { event: "stroke-straight" }, ({ payload }) => {
      const s = remoteStrokes.current[payload.strokeKey];
      if (!s) return;
      s.points = [payload.start, payload.end];
      fullRedraw();
    });

    channel.on("broadcast", { event: "stroke-shape" }, ({ payload }) => {
      const s = remoteStrokes.current[payload.strokeKey];
      if (!s) return;
      s.points = payload.points;
      fullRedraw();
    });

    channel.on("broadcast", { event: "stroke-end" }, ({ payload }) => {
      const s = remoteStrokes.current[payload.strokeKey];
      if (!s) return;
      delete remoteStrokes.current[payload.strokeKey];
      if (s.points.length > 1) setStrokes((prev) => [...prev, s]);
    });

    channel.on("broadcast", { event: "stroke-remove" }, ({ payload }) => {
      setStrokes((prev) => prev.filter((s) => s.id !== payload.strokeId));
    });

    channel.on("broadcast", { event: "stroke-restore" }, ({ payload }) => {
      setStrokes((prev) => [...prev, payload.stroke]);
    });

    channel.on("broadcast", { event: "text-add" }, ({ payload }) => {
      setTexts((prev) => {
        const exists = prev.some((t) => t.id === payload.text.id);
        return exists ? prev.map((t) => (t.id === payload.text.id ? payload.text : t)) : [...prev, payload.text];
      });
    });

    channel.on("broadcast", { event: "text-remove" }, ({ payload }) => {
      setTexts((prev) => prev.filter((t) => t.id !== payload.textId));
    });

    channel.on("broadcast", { event: "text-move" }, ({ payload }) => {
      setTexts((prev) => prev.map((t) => (t.id === payload.textId ? { ...t, x: payload.x, y: payload.y } : t)));
    });

    channel.on("broadcast", { event: "text-transform" }, ({ payload }) => {
      const { textId, ...partial } = payload;
      setTexts((prev) => prev.map((t) => (t.id === textId ? { ...t, ...partial } : t)));
    });

    channel.on("broadcast", { event: "grid-set" }, ({ payload }) => {
      gridConfigRef.current = payload.grid;
      fullRedraw();
    });

    // Selection / copy-paste / image events from the teacher's board.
    const mergeById = (prev, added) => {
      const ids = new Set(added.map((o) => o.id));
      return [...prev.filter((o) => !ids.has(o.id)), ...added];
    };
    channel.on("broadcast", { event: "objects-add" }, ({ payload }) => {
      if (payload.strokes?.length) setStrokes((prev) => mergeById(prev, payload.strokes));
      if (payload.texts?.length) setTexts((prev) => mergeById(prev, payload.texts));
      if (payload.images?.length) setImages((prev) => mergeById(prev, payload.images));
    });
    channel.on("broadcast", { event: "objects-remove" }, ({ payload }) => {
      const s = new Set(payload.strokes || []), t = new Set(payload.texts || []), i = new Set(payload.images || []);
      if (s.size) setStrokes((prev) => prev.filter((x) => !s.has(x.id)));
      if (t.size) setTexts((prev) => prev.filter((x) => !t.has(x.id)));
      if (i.size) setImages((prev) => prev.filter((x) => !i.has(x.id)));
    });
    channel.on("broadcast", { event: "objects-move" }, ({ payload }) => {
      const { dx, dy } = payload;
      const s = new Set(payload.strokes || []), t = new Set(payload.texts || []), i = new Set(payload.images || []);
      if (s.size) setStrokes((prev) => prev.map((x) => (s.has(x.id) ? translateStroke(x, dx, dy) : x)));
      if (t.size) setTexts((prev) => prev.map((x) => (t.has(x.id) ? translateText(x, dx, dy) : x)));
      if (i.size) setImages((prev) => prev.map((x) => (i.has(x.id) ? translateImage(x, dx, dy) : x)));
    });
    channel.on("broadcast", { event: "image-update" }, ({ payload }) => {
      if (payload.image) setImages((prev) => prev.map((x) => (x.id === payload.image.id ? payload.image : x)));
    });

    channel.on("broadcast", { event: "background-set" }, ({ payload }) => {
      backgroundRef.current = normalizeBackground(payload.background);
      fullRedraw();
    });

    channel.on("broadcast", { event: "clear" }, () => {
      setStrokes([]);
      setTexts([]);
      setImages([]);
    });

    channel.on("broadcast", { event: "reference-set" }, ({ payload }) => {
      setReferenceDoc(payload.doc);
      setReferenceStrokes([]);
    });

    channel.on("broadcast", { event: "reference-remove" }, () => {
      setReferenceDoc(null);
      setReferenceStrokes([]);
    });

    channel.on("broadcast", { event: "reference-stroke" }, ({ payload }) => {
      setReferenceStrokes((prev) => [...prev, payload.stroke]);
    });

    channel.on("broadcast", { event: "reference-stroke-remove" }, ({ payload }) => {
      setReferenceStrokes((prev) => prev.filter((s) => s.id !== payload.strokeId));
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") requestSnapshot();
    });
    channelRef.current = channel;

    // The teacher's board might not have finished mounting/subscribing
    // yet in the moment right after "Start Class" — keep asking rather
    // than giving up after one try.
    const retryInterval = setInterval(() => {
      if (!hasReceivedSnapshot.current) {
        setConnectionStatus("waiting");
        requestSnapshot();
      }
    }, STATE_REQUEST_RETRY_MS);

    return () => {
      clearInterval(retryInterval);
      supabase.removeChannel(channel);
    };
  }, [boardId]);

  // Canvas setup, resize, pan/zoom — no drawing tools, view navigation only.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctxRef.current = ctx;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    function resizeCanvas() {
      const ratio = window.devicePixelRatio || 1;
      const { width, height } = getPaneSize();
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      fullRedraw();
    }
    resizeCanvas();
    const resizeObserver = new ResizeObserver(() => resizeCanvas());
    if (boardPaneRef.current) resizeObserver.observe(boardPaneRef.current);

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function isLikelyMouseWheel(e) {
      if (e.deltaMode !== 0) return true;
      return e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50;
    }

    function handleWheel(e) {
      e.preventDefault();
      const screenPos = getPos(e);
      const worldPos = screenToWorld(screenPos);
      let newScale = null;

      if (e.ctrlKey) {
        newScale = scaleRef.current * Math.exp(-e.deltaY * 0.01);
      } else if (isLikelyMouseWheel(e)) {
        const step = 0.1;
        newScale = scaleRef.current * (e.deltaY < 0 ? 1 + step : 1 - step);
      }

      if (newScale !== null) {
        newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
        panRef.current = { x: screenPos.x - worldPos.x * newScale, y: screenPos.y - worldPos.y * newScale };
        scaleRef.current = newScale;
      } else {
        panRef.current = { x: panRef.current.x - e.deltaX, y: panRef.current.y - e.deltaY };
      }
      fullRedraw();
    }

    function centroid(p1, p2) {
      return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    }

    function beginPanZoom() {
      const pts = Array.from(touchPoints.current.values());
      if (pts.length < 2) return;
      const [p1, p2] = pts;
      panZoomState.current = {
        initialDistance: distance(p1, p2),
        initialScale: scaleRef.current,
        worldAnchor: screenToWorld(centroid(p1, p2)),
      };
    }

    function updatePanZoom() {
      const pz = panZoomState.current;
      if (!pz) return;
      const pts = Array.from(touchPoints.current.values());
      if (pts.length < 2) return;
      const [p1, p2] = pts;
      const c = centroid(p1, p2);
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pz.initialScale * (distance(p1, p2) / pz.initialDistance)));
      panRef.current = { x: c.x - pz.worldAnchor.x * newScale, y: c.y - pz.worldAnchor.y * newScale };
      scaleRef.current = newScale;
      fullRedraw();
    }

    function handlePointerDown(e) {
      const pos = getPos(e);
      if (e.pointerType === "touch") touchPoints.current.set(e.pointerId, pos);

      if (touchPoints.current.size >= 2) {
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
        beginPanZoom();
        return;
      }

      panDragActive.current = true;
      panDragStart.current = { pos, origPan: { ...panRef.current } };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    }

    function handlePointerMove(e) {
      if (e.pointerType === "touch" && touchPoints.current.has(e.pointerId)) {
        touchPoints.current.set(e.pointerId, getPos(e));
      }
      if (panZoomState.current && touchPoints.current.size >= 2) {
        updatePanZoom();
        return;
      }
      if (panDragActive.current) {
        const pos = getPos(e);
        const dx = pos.x - panDragStart.current.pos.x;
        const dy = pos.y - panDragStart.current.pos.y;
        panRef.current = { x: panDragStart.current.origPan.x + dx, y: panDragStart.current.origPan.y + dy };
        fullRedraw();
      }
    }

    function handlePointerUp(e) {
      if (e.pointerType === "touch") {
        touchPoints.current.delete(e.pointerId);
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
      }
      if (panZoomState.current) {
        if (touchPoints.current.size < 2) panZoomState.current = null;
        return;
      }
      panDragActive.current = false;
      panDragStart.current = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
    }

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, []);

  useEffect(() => {
    fullRedraw();
  }, [strokes, texts, images]);

  const showReferencePane = !!referenceDoc;

  return (
    <div style={{ width: "100dvw", height: "100dvh", overflow: "hidden", display: "flex" }}>
      {showReferencePane && (
        <div
          className={cls.refColumn}
        >
          <div className={cls.refHeader}>
            {referenceDoc.fileName}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ReferencePane doc={referenceDoc} strokes={referenceStrokes} readOnly />
          </div>
        </div>
      )}

      <div ref={boardPaneRef} style={{ position: "relative", flex: 1, height: "100%", overflow: "hidden", isolation: "isolate" }}>
        {/* Page pattern layer behind the transparent ink canvas. */}
        <div
          ref={pageBgRef}
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, zIndex: -1, backgroundColor: "#ffffff", pointerEvents: "none" }}
        />
        {images.map((img) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={img.id}
            ref={(el) => {
              if (el) imageNodesRef.current[img.id] = el;
              else delete imageNodesRef.current[img.id];
            }}
            src={img.src}
            alt=""
            draggable={false}
            onLoad={repositionImages}
            style={{ position: "absolute", left: 0, top: 0, zIndex: -1, maxWidth: "none", pointerEvents: "none", userSelect: "none" }}
          />
        ))}
        <button
          onClick={() => router.push("/join")}
          className={cls.floatBtn}
        >
          Leave
        </button>

        {connectionStatus !== "live" && (
          <div
            className={cls.statusPill}
          >
            {connectionStatus === "connecting" ? "Connecting…" : "Waiting for your teacher's board…"}
          </div>
        )}

        <canvas
          ref={canvasRef}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            display: "block",
            touchAction: "none",
            WebkitUserSelect: "none",
            userSelect: "none",
            WebkitTouchCallout: "none",
            WebkitTapHighlightColor: "transparent",
          }}
        />
      </div>
    </div>
  );
}