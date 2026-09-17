"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// A student's own personal scratch board during a live class. Unlike the
// teacher's board, this is intentionally NOT persisted to the database —
// it's a session-based scratchpad tied to this one classroom session, in
// keeping with "students never logged in, no DB access" (see
// ClassroomBoardViewer.js). It exists purely as realtime broadcast state
// on `student-board-${code}-${studentId}`, with the student as the sole
// stroke-writer — the teacher's per-student viewer (TeacherStudentBoardView)
// only ever reads strokes and writes lightweight text comments, so there's
// never more than one person drawing ink on this channel at once.
//
// Points are stored/broadcast as FRACTIONS of the board pane (0..1 on each
// axis), not raw pixels — the teacher's screen and a student's screen are
// often very different sizes, and there's no pan/zoom here to paper over
// that mismatch, so normalizing keeps a drawing lining up proportionally
// on both sides regardless of device.

const BROADCAST_THROTTLE_MS = 60;
const PRESET_COLORS = ["#1a1a1a", "#E53935", "#FB8C00", "#43A047", "#1E88E5", "#8E24AA"];

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
    ctx.lineJoin = "round";
    smoothPath(ctx, stroke.points, 0, stroke.points.length - 1);
  }
  ctx.globalAlpha = 1;
}

// Comments come from the teacher — drawn as small numbered pins so their
// location on the board is visible in context, but the actual text lives
// in the DOM comments panel (canvas hit-testing a tooltip is a lot of
// complexity for what's meant to be a lightweight feedback channel).
function drawCommentPins(ctx, pins) {
  pins.forEach(({ x, y, index }) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fillStyle = "#FFB300";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.fillStyle = "#1a1a1a";
    ctx.font = "bold 12px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(index + 1), x, y + 1);
    ctx.restore();
  });
}

// Fractional (0..1) points -> pixel points for the pane's current size.
function toPixelStroke(stroke, size) {
  return {
    ...stroke,
    width: stroke.width * size.width,
    points: stroke.points.map((p) => ({ x: p.x * size.width, y: p.y * size.height, w: p.w != null ? p.w * size.width : undefined })),
  };
}

export default function StudentMiniBoard({ code, studentId }) {
  const canvasRef = useRef(null);
  const paneRef = useRef(null);
  const ctxRef = useRef(null);
  const channelRef = useRef(null);

  const strokesRef = useRef([]);
  const commentsRef = useRef([]);
  const currentStroke = useRef(null);
  const isDrawing = useRef(false);
  const activePointerId = useRef(null);

  const toolRef = useRef("pen");
  const colorRef = useRef(PRESET_COLORS[0]);

  const pendingPoints = useRef([]);
  const flushTimer = useRef(null);

  const [strokes, setStrokes] = useState([]);
  const [comments, setComments] = useState([]);
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [showComments, setShowComments] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("connecting");

  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { strokesRef.current = strokes; }, [strokes]);
  useEffect(() => { commentsRef.current = comments; }, [comments]);

  function getPaneSize() {
    const el = paneRef.current;
    if (!el) return { width: window.innerWidth, height: window.innerHeight };
    const rect = el.getBoundingClientRect();
    return { width: rect.width || 1, height: rect.height || 1 };
  }

  function fullRedraw() {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const size = getPaneSize();
    ctx.clearRect(0, 0, size.width, size.height);
    for (const stroke of strokesRef.current) drawStroke(ctx, toPixelStroke(stroke, size));
    if (currentStroke.current) drawStroke(ctx, toPixelStroke(currentStroke.current, size));
    drawCommentPins(
      ctx,
      commentsRef.current.map((c, i) => ({ x: c.x * size.width, y: c.y * size.height, index: i }))
    );
  }

  // Realtime: this student's own dedicated board channel. Sole
  // stroke-writer is this component; the teacher's viewer only reads
  // strokes and writes comments, so there's exactly one writer per
  // "kind" of content and no risk of the two colliding mid-stroke.
  useEffect(() => {
    if (!code || !studentId) return;
    const channel = supabase.channel(`student-board-${code}-${studentId}`, {
      config: { broadcast: { self: false } },
    });

    channel.on("broadcast", { event: "state-request" }, () => {
      channel.send({
        type: "broadcast",
        event: "state-snapshot",
        payload: { strokes: strokesRef.current, comments: commentsRef.current },
      });
    });

    channel.on("broadcast", { event: "teacher-comment-add" }, ({ payload }) => {
      setComments((prev) => [...prev, payload]);
    });

    channel.on("broadcast", { event: "teacher-comment-remove" }, ({ payload }) => {
      setComments((prev) => prev.filter((c) => c.id !== payload.id));
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") setConnectionStatus("live");
    });
    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [code, studentId]);

  useEffect(() => {
    fullRedraw();
  }, [strokes, comments]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctxRef.current = ctx;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    function resizeCanvas() {
      const ratio = window.devicePixelRatio || 1;
      const size = getPaneSize();
      canvas.width = size.width * ratio;
      canvas.height = size.height * ratio;
      canvas.style.width = size.width + "px";
      canvas.style.height = size.height + "px";
      fullRedraw();
    }
    resizeCanvas();
    const resizeObserver = new ResizeObserver(() => resizeCanvas());
    if (paneRef.current) resizeObserver.observe(paneRef.current);

    // Fractional (0..1) position within the pane, independent of this
    // device's actual pixel size.
    function getFractionalPos(e) {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width || 1;
      const h = rect.height || 1;
      return { x: (e.clientX - rect.left) / w, y: (e.clientY - rect.top) / h };
    }

    function flushPoints(strokeId, force) {
      if (flushTimer.current && !force) return;
      const doFlush = () => {
        flushTimer.current = null;
        if (pendingPoints.current.length === 0) return;
        const pts = pendingPoints.current;
        pendingPoints.current = [];
        channelRef.current?.send({
          type: "broadcast",
          event: "stroke-points",
          payload: { strokeId, points: pts },
        });
      };
      if (force) doFlush();
      else flushTimer.current = setTimeout(doFlush, BROADCAST_THROTTLE_MS);
    }

    function handlePointerDown(e) {
      if (isDrawing.current) return;
      isDrawing.current = true;
      activePointerId.current = e.pointerId;
      canvas.setPointerCapture(e.pointerId);

      const pos = getFractionalPos(e);
      const strokeId =
        typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      const t = toolRef.current;
      const size = getPaneSize();
      const baseWidthPx = t === "eraser" ? 16 : 3;
      const baseWidthFrac = baseWidthPx / size.width;

      currentStroke.current = {
        id: strokeId,
        tool: t,
        color: colorRef.current,
        width: baseWidthFrac,
        opacity: 1,
        points: [t === "eraser" ? { ...pos, w: baseWidthFrac } : pos],
      };

      channelRef.current?.send({
        type: "broadcast",
        event: "stroke-start",
        payload: {
          strokeId,
          tool: t,
          color: colorRef.current,
          width: baseWidthFrac,
          opacity: 1,
          point: pos,
        },
      });
      fullRedraw();
    }

    function handlePointerMove(e) {
      if (!isDrawing.current || e.pointerId !== activePointerId.current) return;
      const pos = getFractionalPos(e);
      const cs = currentStroke.current;
      if (!cs) return;
      const point = cs.tool === "eraser" ? { ...pos, w: cs.width } : pos;
      cs.points.push(point);
      pendingPoints.current.push(point);
      flushPoints(cs.id, false);
      fullRedraw();
    }

    function handlePointerUp(e) {
      if (!isDrawing.current || e.pointerId !== activePointerId.current) return;
      isDrawing.current = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}

      const cs = currentStroke.current;
      currentStroke.current = null;
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
      if (cs) {
        flushPoints(cs.id, true);
        channelRef.current?.send({ type: "broadcast", event: "stroke-end", payload: { strokeId: cs.id } });
        if (cs.points.length > 1) setStrokes((prev) => [...prev, cs]);
      }
      fullRedraw();
    }

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);

    return () => {
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleUndo() {
    setStrokes((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      channelRef.current?.send({ type: "broadcast", event: "stroke-remove", payload: { strokeId: last.id } });
      return prev.slice(0, -1);
    });
  }

  function handleClear() {
    if (strokes.length === 0) return;
    if (!window.confirm("Clear your board? This can't be undone.")) return;
    setStrokes([]);
    channelRef.current?.send({ type: "broadcast", event: "clear", payload: {} });
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      <div ref={paneRef} style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden", background: "#fff" }}>
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

        {connectionStatus !== "live" && (
          <div
            style={{
              position: "absolute",
              top: 12,
              left: "50%",
              transform: "translateX(-50%)",
              background: "#1a1a1a",
              color: "#fff",
              borderRadius: 999,
              padding: "6px 16px",
              fontSize: 13,
            }}
          >
            Connecting…
          </div>
        )}

        {comments.length > 0 && (
          <button
            onClick={() => setShowComments((v) => !v)}
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              border: "none",
              background: "#FFB300",
              color: "#1a1a1a",
              borderRadius: 999,
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 1px 6px rgba(0,0,0,0.15)",
            }}
          >
            {showComments ? "Hide" : `${comments.length} comment${comments.length === 1 ? "" : "s"} from teacher`}
          </button>
        )}

        {showComments && (
          <div
            style={{
              position: "absolute",
              top: 56,
              right: 12,
              width: "min(280px, calc(100% - 24px))",
              maxHeight: "60%",
              overflowY: "auto",
              background: "#fff",
              borderRadius: 12,
              boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
              padding: 12,
            }}
          >
            {comments.map((c, i) => (
              <div key={c.id} style={{ display: "flex", gap: 8, padding: "6px 0", borderBottom: i < comments.length - 1 ? "1px solid #f0f0f0" : "none" }}>
                <span
                  style={{
                    flexShrink: 0,
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: "#FFB300",
                    color: "#1a1a1a",
                    fontSize: 11,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {i + 1}
                </span>
                <span style={{ fontSize: 13, color: "#333" }}>{c.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          background: "#fff",
          borderTop: "1px solid #eee",
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={() => setTool("pen")}
          style={{
            border: "none",
            background: tool === "pen" ? "#1E88E5" : "#f0f0f0",
            color: tool === "pen" ? "#fff" : "#333",
            borderRadius: 8,
            padding: "8px 14px",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Pen
        </button>
        <button
          onClick={() => setTool("eraser")}
          style={{
            border: "none",
            background: tool === "eraser" ? "#1E88E5" : "#f0f0f0",
            color: tool === "eraser" ? "#fff" : "#333",
            borderRadius: 8,
            padding: "8px 14px",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Eraser
        </button>
        <div style={{ display: "flex", gap: 6 }}>
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => { setColor(c); setTool("pen"); }}
              style={{
                width: 24,
                height: 24,
                borderRadius: "50%",
                background: c,
                border: color === c && tool === "pen" ? "2px solid #1a1a1a" : "2px solid transparent",
                cursor: "pointer",
                padding: 0,
              }}
            />
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button
          onClick={handleUndo}
          disabled={strokes.length === 0}
          style={{
            border: "none",
            background: "#f0f0f0",
            color: strokes.length === 0 ? "#bbb" : "#333",
            borderRadius: 8,
            padding: "8px 14px",
            fontSize: 13,
            cursor: strokes.length === 0 ? "default" : "pointer",
          }}
        >
          Undo
        </button>
        <button
          onClick={handleClear}
          disabled={strokes.length === 0}
          style={{
            border: "none",
            background: "#f0f0f0",
            color: strokes.length === 0 ? "#bbb" : "#333",
            borderRadius: 8,
            padding: "8px 14px",
            fontSize: 13,
            cursor: strokes.length === 0 ? "default" : "pointer",
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
