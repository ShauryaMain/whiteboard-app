"use client";

import { useEffect, useRef, useState } from "react";
import Toolbar from "./Toolbar";
import { supabase } from "@/lib/supabaseClient";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function opacityForTool(t) {
  return t === "highlighter" ? 0.35 : 1;
}

function widthForTool(t, baseWidth) {
  if (t === "eraser") return baseWidth * 3;
  if (t === "highlighter") return baseWidth * 2.5;
  return baseWidth;
}

export default function Whiteboard({ boardId, isOwner }) {
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
  const colorRef = useRef("#1a1a1a");
  const widthRef = useRef(4);

  const [strokes, setStrokes] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState("#1a1a1a");
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [saveStatus, setSaveStatus] = useState("");

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
    ctx.globalAlpha = 1;
  }

  function drawStroke(ctx, stroke) {
    if (!stroke || !stroke.points || stroke.points.length < 2) return;
    ctx.globalAlpha = stroke.opacity ?? 1;
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
    ctx.globalAlpha = styleStroke.opacity ?? 1;
    ctx.strokeStyle = styleStroke.tool === "eraser" ? "#ffffff" : styleStroke.color;
    ctx.lineWidth = styleStroke.width;
    ctx.beginPath();
    ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

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

  useEffect(() => {
    if (!boardId) return;
    async function loadBoard() {
      const { data, error } = await supabase
        .from("boards")
        .select("stroke_data")
        .eq("id", boardId)
        .single();
      if (!error && data && Array.isArray(data.stroke_data)) {
        setStrokes(data.stroke_data);
      }
    }
    loadBoard();
  }, [boardId]);

  async function saveBoard() {
    if (!boardId) return;
    const { error } = await supabase
      .from("boards")
      .update({ stroke_data: strokesRef.current })
      .eq("id", boardId);
    return !error;
  }

  useEffect(() => {
    if (!isOwner || !boardId) return;
    const interval = setInterval(async () => {
      const ok = await saveBoard();
      setSaveStatus(ok ? "Autosaved" : "Save failed");
      setTimeout(() => setSaveStatus(""), 2000);
    }, 30000);
    return () => clearInterval(interval);
  }, [isOwner, boardId]);

  useEffect(() => {
    if (!isOwner || !boardId) return;
    function saveOnClose() {
      try {
        fetch(`${SUPABASE_URL}/rest/v1/boards?id=eq.${boardId}`, {
          method: "PATCH",
          keepalive: true,
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ stroke_data: strokesRef.current }),
        });
      } catch (err) {}
    }
    window.addEventListener("pagehide", saveOnClose);
    window.addEventListener("beforeunload", saveOnClose);
    return () => {
      window.removeEventListener("pagehide", saveOnClose);
      window.removeEventListener("beforeunload", saveOnClose);
    };
  }, [isOwner, boardId]);

  async function handleEndSession() {
    setSaveStatus("Saving…");
    const ok = await saveBoard();
    setSaveStatus(ok ? "Saved" : "Save failed");
    setTimeout(() => setSaveStatus(""), 3000);
  }

  function handleCopyLink() {
    const cleanUrl = window.location.href.replace(/[?&]owner=true/, "");
    navigator.clipboard.writeText(cleanUrl);
    setSaveStatus("Link copied");
    setTimeout(() => setSaveStatus(""), 2000);
  }

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
        opacity: payload.opacity,
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

      const t = toolRef.current;
      currentStroke.current = {
        tool: t,
        color: colorRef.current,
        width: widthForTool(t, widthRef.current),
        opacity: opacityForTool(t),
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
          opacity: currentStroke.current.opacity,
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
        isOwner={isOwner}
        onCopyLink={handleCopyLink}
        onEndSession={handleEndSession}
        saveStatus={saveStatus}
      />
    </div>
  );
}