"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import ReferencePane from "./ReferencePane";

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
  ctx.globalAlpha = stroke.opacity ?? 1;
  ctx.strokeStyle = stroke.tool === "eraser" ? "#ffffff" : stroke.color;
  if (stroke.tool === "eraser") {
    drawVariableWidthPath(ctx, stroke.points, 0, stroke.points.length - 1, stroke.width);
  } else {
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

function drawGrid(ctx, grid, scale) {
  if (!grid) return;
  const { x, y, size, cols } = grid;
  const cell = size / cols;

  ctx.save();
  ctx.strokeStyle = "#cfd8e3";
  ctx.lineWidth = 1 / scale;
  for (let i = 0; i <= cols; i++) {
    const gx = x + i * cell;
    ctx.beginPath();
    ctx.moveTo(gx, y);
    ctx.lineTo(gx, y + size);
    ctx.stroke();
  }
  for (let j = 0; j <= cols; j++) {
    const gy = y + j * cell;
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.lineTo(x + size, gy);
    ctx.stroke();
  }

  const mid = cols / 2;
  ctx.strokeStyle = "#9aa7b8";
  ctx.lineWidth = 1.5 / scale;
  const midX = x + mid * cell;
  const midY = y + mid * cell;
  ctx.beginPath();
  ctx.moveTo(midX, y);
  ctx.lineTo(midX, y + size);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, midY);
  ctx.lineTo(x + size, midY);
  ctx.stroke();
  ctx.restore();
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
  const touchPoints = useRef(new Map());
  const panZoomState = useRef(null);
  const panDragActive = useRef(false);
  const panDragStart = useRef(null);
  const hasReceivedSnapshot = useRef(false);

  const [strokes, setStrokes] = useState([]);
  const [texts, setTexts] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState("connecting"); // connecting | live | waiting
  const [referenceDoc, setReferenceDoc] = useState(null);
  const [referenceStrokes, setReferenceStrokes] = useState([]);

  useEffect(() => { strokesRef.current = strokes; }, [strokes]);
  useEffect(() => { textsRef.current = texts; }, [texts]);

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

    channel.on("broadcast", { event: "clear" }, () => {
      setStrokes([]);
      setTexts([]);
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
  }, [strokes, texts]);

  const showReferencePane = !!referenceDoc;

  return (
    <div style={{ width: "100dvw", height: "100dvh", overflow: "hidden", display: "flex" }}>
      {showReferencePane && (
        <div
          style={{
            width: "clamp(340px, 42%, 600px)",
            height: "100%",
            flexShrink: 0,
            borderRight: "1px solid #ddd",
            background: "#e8eaed",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ padding: "10px 14px", background: "#fff", borderBottom: "1px solid #eee", fontSize: 13, color: "#333" }}>
            {referenceDoc.fileName}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ReferencePane doc={referenceDoc} strokes={referenceStrokes} readOnly />
          </div>
        </div>
      )}

      <div ref={boardPaneRef} style={{ position: "relative", flex: 1, height: "100%", overflow: "hidden" }}>
        <button
          onClick={() => router.push("/join")}
          style={{
            position: "absolute",
            top: "max(16px, env(safe-area-inset-top))",
            left: 16,
            zIndex: 10,
            border: "none",
            background: "#fff",
            borderRadius: 10,
            padding: "8px 14px",
            fontSize: 13,
            cursor: "pointer",
            boxShadow: "0 1px 6px rgba(0,0,0,0.15)",
          }}
        >
          Leave
        </button>

        {connectionStatus !== "live" && (
          <div
            style={{
              position: "absolute",
              top: "max(16px, env(safe-area-inset-top))",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 10,
              background: "#1a1a1a",
              color: "#fff",
              borderRadius: 999,
              padding: "6px 16px",
              fontSize: 13,
            }}
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
            background: "#ffffff",
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