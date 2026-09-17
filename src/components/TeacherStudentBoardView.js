"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { ArrowLeft } from "lucide-react";

// The teacher's read-only window into one student's mini-board
// (StudentMiniBoard.js), opened by clicking a name in the live roster.
// The teacher never draws ink here — only the student writes strokes to
// this channel — the teacher's only write is a lightweight text comment,
// so the two never contend over the same kind of content. See
// StudentMiniBoard.js for the fuller rationale and the channel contract.

const STATE_REQUEST_RETRY_MS = 3000;

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

function toPixelStroke(stroke, size) {
  return {
    ...stroke,
    width: stroke.width * size.width,
    points: stroke.points.map((p) => ({ x: p.x * size.width, y: p.y * size.height, w: p.w != null ? p.w * size.width : undefined })),
  };
}

export default function TeacherStudentBoardView({ code, student, onBack }) {
  const canvasRef = useRef(null);
  const paneRef = useRef(null);
  const ctxRef = useRef(null);
  const channelRef = useRef(null);
  const remoteStrokes = useRef({});
  const strokesRef = useRef([]);
  const commentsRef = useRef([]);
  const hasReceivedSnapshot = useRef(false);

  const [strokes, setStrokes] = useState([]);
  const [comments, setComments] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState("connecting"); // connecting | live
  const [showComments, setShowComments] = useState(true);
  const [composer, setComposer] = useState(null); // { x, y, text } in fractional coords

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
    for (const key in remoteStrokes.current) drawStroke(ctx, toPixelStroke(remoteStrokes.current[key], size));
    drawCommentPins(
      ctx,
      commentsRef.current.map((c, i) => ({ x: c.x * size.width, y: c.y * size.height, index: i }))
    );
  }

  useEffect(() => {
    if (!code || !student?.studentId) return;
    hasReceivedSnapshot.current = false;
    remoteStrokes.current = {};

    const channel = supabase.channel(`student-board-${code}-${student.studentId}`, {
      config: { broadcast: { self: false } },
    });

    function requestSnapshot() {
      if (hasReceivedSnapshot.current) return;
      channel.send({ type: "broadcast", event: "state-request", payload: {} });
    }

    // Small ack from the student, always tiny (just comments) — the
    // student's actual stroke history now arrives separately as a
    // chunked replay over stroke-start/stroke-points/stroke-end (the
    // same events used for live drawing), so this handler no longer
    // touches `strokes` at all. See StudentMiniBoard.js's state-request
    // handler for why: a single big snapshot message could exceed
    // Supabase Realtime's broadcast payload cap and get silently
    // dropped, which is why the teacher used to see a blank board.
    channel.on("broadcast", { event: "state-snapshot" }, ({ payload }) => {
      hasReceivedSnapshot.current = true;
      setComments(payload.comments || []);
      setConnectionStatus("live");
      fullRedraw();
    });

    channel.on("broadcast", { event: "stroke-start" }, ({ payload }) => {
      remoteStrokes.current[payload.strokeId] = {
        id: payload.strokeId,
        tool: payload.tool,
        color: payload.color,
        width: payload.width,
        opacity: payload.opacity,
        points: [payload.point],
      };
    });

    channel.on("broadcast", { event: "stroke-points" }, ({ payload }) => {
      const s = remoteStrokes.current[payload.strokeId];
      if (!s) return;
      s.points.push(...payload.points);
      fullRedraw();
    });

    channel.on("broadcast", { event: "stroke-end" }, ({ payload }) => {
      const s = remoteStrokes.current[payload.strokeId];
      if (!s) return;
      delete remoteStrokes.current[payload.strokeId];
      // Guard against a stroke being appended twice — e.g. the retry
      // timer re-requesting a replay that had actually already landed —
      // since the same strokeId could otherwise show up in `strokes`
      // more than once.
      if (s.points.length > 1) {
        setStrokes((prev) => (prev.some((existing) => existing.id === s.id) ? prev : [...prev, s]));
      }
    });

    channel.on("broadcast", { event: "stroke-remove" }, ({ payload }) => {
      setStrokes((prev) => prev.filter((s) => s.id !== payload.strokeId));
    });

    channel.on("broadcast", { event: "clear" }, () => {
      setStrokes([]);
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") requestSnapshot();
    });
    channelRef.current = channel;

    const retryInterval = setInterval(() => {
      if (!hasReceivedSnapshot.current) requestSnapshot();
    }, STATE_REQUEST_RETRY_MS);

    return () => {
      clearInterval(retryInterval);
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [code, student?.studentId]);

  useEffect(() => {
    fullRedraw();
  }, [strokes, comments]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctxRef.current = ctx;

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
    return () => resizeObserver.disconnect();
  }, []);

  function handleCanvasClick(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const w = rect.width || 1;
    const h = rect.height || 1;
    const x = (e.clientX - rect.left) / w;
    const y = (e.clientY - rect.top) / h;
    setComposer({ x, y, text: "" });
  }

  function submitComment() {
    if (!composer || !composer.text.trim()) {
      setComposer(null);
      return;
    }
    const comment = {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
      x: composer.x,
      y: composer.y,
      text: composer.text.trim(),
      createdAt: Date.now(),
    };
    setComments((prev) => [...prev, comment]);
    channelRef.current?.send({ type: "broadcast", event: "teacher-comment-add", payload: comment });
    setComposer(null);
  }

  function removeComment(id) {
    setComments((prev) => prev.filter((c) => c.id !== id));
    channelRef.current?.send({ type: "broadcast", event: "teacher-comment-remove", payload: { id } });
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "#f5f6f8", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          background: "#fff",
          borderBottom: "1px solid #eee",
        }}
      >
        <button
          onClick={onBack}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            border: "none",
            background: "#f0f0f0",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 13,
            cursor: "pointer",
            color: "#333",
          }}
        >
          <ArrowLeft size={15} /> Roster
        </button>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a" }}>{`${student?.name || "Student"}'s board`}</div>
        {connectionStatus !== "live" && (
          <span style={{ fontSize: 12, color: "#999" }}>Connecting…</span>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setShowComments((v) => !v)}
          style={{
            border: "none",
            background: showComments ? "#FFB300" : "#f0f0f0",
            color: "#1a1a1a",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Comments{comments.length > 0 ? ` (${comments.length})` : ""}
        </button>
      </div>

      <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex" }}>
        <div ref={paneRef} style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden", background: "#fff" }}>
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            style={{ display: "block", cursor: "crosshair" }}
          />

          <div
            style={{
              position: "absolute",
              bottom: 12,
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(26,26,26,0.85)",
              color: "#fff",
              borderRadius: 999,
              padding: "6px 14px",
              fontSize: 12,
            }}
          >
            Click anywhere on the board to leave a comment
          </div>

          {composer && (
            <div
              style={{
                position: "absolute",
                left: `calc(${composer.x * 100}% - 130px)`,
                top: `calc(${composer.y * 100}% + 16px)`,
                width: 260,
                background: "#fff",
                borderRadius: 10,
                boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
                padding: 10,
                zIndex: 5,
              }}
            >
              <textarea
                autoFocus
                value={composer.text}
                onChange={(e) => setComposer({ ...composer, text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitComment();
                  } else if (e.key === "Escape") {
                    setComposer(null);
                  }
                }}
                placeholder="What should they change?"
                rows={2}
                style={{
                  width: "100%",
                  border: "1px solid #ddd",
                  borderRadius: 6,
                  padding: 8,
                  fontSize: 13,
                  fontFamily: "inherit",
                  resize: "none",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                <button
                  onClick={() => setComposer(null)}
                  style={{ border: "none", background: "#f0f0f0", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button
                  onClick={submitComment}
                  style={{ border: "none", background: "#1E88E5", color: "#fff", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}
                >
                  Send
                </button>
              </div>
            </div>
          )}
        </div>

        {showComments && (
          <div
            style={{
              width: 280,
              flexShrink: 0,
              background: "#fff",
              borderLeft: "1px solid #eee",
              overflowY: "auto",
              padding: 14,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: "#333", marginBottom: 10 }}>
              Comments for {student?.name || "this student"}
            </div>
            {comments.length === 0 && (
              <div style={{ fontSize: 13, color: "#999" }}>No comments yet — click the board to add one.</div>
            )}
            {comments.map((c, i) => (
              <div key={c.id} style={{ display: "flex", gap: 8, padding: "8px 0", borderBottom: "1px solid #f5f5f5" }}>
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
                <span style={{ fontSize: 13, color: "#333", flex: 1 }}>{c.text}</span>
                <button
                  onClick={() => removeComment(c.id)}
                  style={{ border: "none", background: "none", color: "#bbb", cursor: "pointer", fontSize: 14, padding: 0 }}
                  title="Delete comment"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
