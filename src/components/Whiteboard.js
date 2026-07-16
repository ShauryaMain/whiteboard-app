"use client";

import { useEffect, useRef, useState } from "react";
import Toolbar from "./Toolbar";
import { supabase } from "@/lib/supabaseClient";

const COLORS = ["#000000", "#E53935", "#FB8C00", "#43A047", "#1E88E5", "#8E24AA"];
const WIDTHS = { thin: 2, medium: 5, thick: 10 };

export default function Whiteboard({ boardId }) {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const isDrawing = useRef(false);
  const currentStroke = useRef(null);
  const currentStrokeId = useRef(null);

  const clientId = useRef(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  );

  const channelRef = useRef(null);
  const remoteStrokes = useRef({});

  const strokesRef = useRef([]);
  const toolRef = useRef("pen");
  const colorRef = useRef(COLORS[0]);
  const widthRef = useRef(WIDTHS.medium);

  const [strokes, setStrokes] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(WIDTHS.medium);

  useEffect(() => { strokesRef.current = strokes; }, [strokes]);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { widthRef.current = strokeWidth; }, [strokeWidth]);

  function redrawAll() {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    const ratio = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
    for (const stroke of strokesRef.current) {
      drawStroke(ctx, stroke);
    }
  }

  function drawStroke(ctx, stroke) {
    if (!stroke || !stroke.points || stroke.points.length < 2) return;
    ctx.strokeStyle = stroke.tool === "eraser" ? "#ffffff" : stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
  }

  function drawSegmentLive(ctx, styleStroke) {
    const pts = styleStroke.points;
    if (pts.length < 2) return;
    ctx.strokeStyle = styleStroke.tool === "eraser" ? "#ffffff" : styleStroke.color;
    ctx.lineWidth = styleStroke.width;
    ctx.beginPath();
    ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
  }

  // ---- Board-wide actions (undo/redo/clear) ----
  // Written with updater functions so they're always safe to call from
  // anywhere — a button click OR an incoming broadcast — without relying
  // on a possibly-stale snapshot of state.
  function performUndo() {
    setStrokes((prevStrokes) => {
      if (prevStrokes.length === 0) return prevStrokes;
      const last = prevStrokes[prevStrokes.length - 1];
      setRedoStack((prevRedo) => [...prevRedo, last]);
      return prevStrokes.slice(0, -1);
    });
  }

  function performRedo() {
    setRedoStack((prevRedo) => {
      if (prevRedo.length === 0) return prevRedo;
      const next = prevRedo[prevRedo.length - 1];
      setStrokes((prevStrokes) => [...prevStrokes, next]);
      return prevRedo.slice(0, -1);
    });
  }

  function performClear() {
    setStrokes([]);
    setRedoStack([]);
  }

  // ---- Realtime channel ----
  useEffect(() => {
    if (!boardId) return;

    const channel = supabase.channel(`board-${boardId}`, {
      config: { broadcast: { self: false } },
    });

    channel.on("broadcast", { event: "stroke-start" }, ({ payload }) => {
      remoteStrokes.current[payload.strokeKey] = {
        tool: payload.tool,
        color: payload.color,
        width: payload.width,
        points: [payload.point],
      };
    });

    channel.on("broadcast", { event: "stroke-point" }, ({ payload }) => {
      const s = remoteStrokes.current[payload.strokeKey];
      if (!s) return;
      s.points.push(payload.point);
      if (ctxRef.current) drawSegmentLive(ctxRef.current, s);
    });

    channel.on("broadcast", { event: "stroke-end" }, ({ payload }) => {
      const s = remoteStrokes.current[payload.strokeKey];
      if (!s) return;
      delete remoteStrokes.current[payload.strokeKey];
      if (s.points.length > 1) {
        setStrokes((prev) => [...prev, s]);
      }
    });

    // New: board-wide action sync
    channel.on("broadcast", { event: "undo" }, () => performUndo());
    channel.on("broadcast", { event: "redo" }, () => performRedo());
    channel.on("broadcast", { event: "clear" }, () => performClear());

    channel.subscribe();
    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [boardId]);

  // ---- Canvas + pointer input ----
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctxRef.current = ctx;

    function resizeCanvas() {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * ratio;
      canvas.height = window.innerHeight * ratio;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(ratio, ratio);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      redrawAll();
    }

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function handlePointerDown(e) {
      isDrawing.current = true;
      const pos = getPos(e);
      const strokeId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2);
      currentStrokeId.current = strokeId;

      currentStroke.current = {
        tool: toolRef.current,
        color: colorRef.current,
        width: toolRef.current === "eraser" ? widthRef.current * 3 : widthRef.current,
        points: [pos],
      };
      canvas.setPointerCapture(e.pointerId);

      channelRef.current?.send({
        type: "broadcast",
        event: "stroke-start",
        payload: {
          strokeKey: `${clientId.current}-${strokeId}`,
          tool: currentStroke.current.tool,
          color: currentStroke.current.color,
          width: currentStroke.current.width,
          point: pos,
        },
      });
    }

    function handlePointerMove(e) {
      if (!isDrawing.current || !currentStroke.current) return;
      const pos = getPos(e);
      currentStroke.current.points.push(pos);
      drawSegmentLive(ctxRef.current, currentStroke.current);

      channelRef.current?.send({
        type: "broadcast",
        event: "stroke-point",
        payload: {
          strokeKey: `${clientId.current}-${currentStrokeId.current}`,
          point: pos,
        },
      });
    }

    function handlePointerUp(e) {
      if (!isDrawing.current) return;
      isDrawing.current = false;

      const finished = currentStroke.current;
      const strokeId = currentStrokeId.current;
      currentStroke.current = null;
      currentStrokeId.current = null;

      if (finished && finished.points.length > 1) {
        setStrokes((prev) => [...prev, finished]);
        setRedoStack([]);
      }

      if (strokeId) {
        channelRef.current?.send({
          type: "broadcast",
          event: "stroke-end",
          payload: { strokeKey: `${clientId.current}-${strokeId}` },
        });
      }

      if (e && e.pointerId !== undefined) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch (err) {}
      }
    }

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
    };
  }, []);

  useEffect(() => {
    if (ctxRef.current) redrawAll();
  }, [strokes]);

  // ---- Button handlers: perform locally, then tell everyone else ----
  function handleUndo() {
    performUndo();
    channelRef.current?.send({ type: "broadcast", event: "undo", payload: {} });
  }

  function handleRedo() {
    performRedo();
    channelRef.current?.send({ type: "broadcast", event: "redo", payload: {} });
  }

  function handleClear() {
    if (strokes.length === 0) return;
    if (window.confirm("Clear the whole board for everyone? This can't be undone.")) {
      performClear();
      channelRef.current?.send({ type: "broadcast", event: "clear", payload: {} });
    }
  }

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden" }}>
      <canvas
        ref={canvasRef}
        style={{ display: "block", touchAction: "none", background: "#ffffff" }}
      />
      <Toolbar
        colors={COLORS}
        widths={WIDTHS}
        tool={tool}
        setTool={setTool}
        color={color}
        setColor={setColor}
        strokeWidth={strokeWidth}
        setStrokeWidth={setStrokeWidth}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onClear={handleClear}
        canUndo={strokes.length > 0}
        canRedo={redoStack.length > 0}
      />
    </div>
  );
}