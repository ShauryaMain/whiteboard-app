"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import Toolbar from "./Toolbar";
import RulerOverlay from "./RulerOverlay";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;

function opacityForTool(t) {
  return t === "highlighter" ? 0.35 : 1;
}

function widthForTool(t, baseWidth) {
  if (t === "eraser") return baseWidth * 3;
  if (t === "highlighter") return baseWidth * 2.5;
  return baseWidth;
}

function projectOntoAngle(start, pos, angle) {
  const dx = pos.x - start.x;
  const dy = pos.y - start.y;
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const t = dx * dirX + dy * dirY;
  return { x: start.x + t * dirX, y: start.y + t * dirY };
}

function distance(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function centroid(p1, p2) {
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

export default function Whiteboard({ boardId }) {
  const { user } = useAuth();
  const [isOwner, setIsOwner] = useState(false);

  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const isDrawing = useRef(false);
  const currentStroke = useRef(null);
  const currentStrokeId = useRef(null);
  const activePointerId = useRef(null);
  const activePointerType = useRef(null);
  const strokeScreenStart = useRef(null);

  const panRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);

  // Only ever populated by pointerType === "touch" — a mouse or pencil,
  // however many stray/duplicate events it produces, never counts toward
  // "two fingers," so it can never spuriously trigger or interrupt a pinch.
  const touchPoints = useRef(new Map());
  const panZoomState = useRef(null);

  const pendingBroadcastPoints = useRef([]);
  const pendingStraightUpdate = useRef(null);
  const rafId = useRef(null);

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
  const rulerActiveRef = useRef(false);
  const rulerAngleRef = useRef(0);

  const [strokes, setStrokes] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState("#1a1a1a");
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [saveStatus, setSaveStatus] = useState("");
  const [rulerActive, setRulerActive] = useState(false);
  const [rulerAngle, setRulerAngle] = useState(0);
  const [rulerPos, setRulerPos] = useState({ x: 300, y: 300 });

  useEffect(() => { strokesRef.current = strokes; }, [strokes]);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { widthRef.current = strokeWidth; }, [strokeWidth]);
  useEffect(() => { rulerActiveRef.current = rulerActive; }, [rulerActive]);
  useEffect(() => { rulerAngleRef.current = rulerAngle; }, [rulerAngle]);

  function screenToWorld(p) {
    return {
      x: (p.x - panRef.current.x) / scaleRef.current,
      y: (p.y - panRef.current.y) / scaleRef.current,
    };
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

  function fullRedraw() {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const scale = scaleRef.current;
    const pan = panRef.current;

    ctx.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * pan.x, ratio * pan.y);
    ctx.clearRect(-pan.x / scale, -pan.y / scale, window.innerWidth / scale, window.innerHeight / scale);

    for (const stroke of strokesRef.current) drawStroke(ctx, stroke);
    for (const key in remoteStrokes.current) drawStroke(ctx, remoteStrokes.current[key]);
    if (currentStroke.current) drawStroke(ctx, currentStroke.current);
    ctx.globalAlpha = 1;
  }

  function drawNewSegment(ctx, styleStroke, newPointsCount) {
    const pts = styleStroke.points;
    if (pts.length < 2 || newPointsCount < 1) return;
    const startIdx = Math.max(0, pts.length - newPointsCount - 1);
    ctx.globalAlpha = styleStroke.opacity ?? 1;
    ctx.strokeStyle = styleStroke.tool === "eraser" ? "#ffffff" : styleStroke.color;
    ctx.lineWidth = styleStroke.width;
    ctx.beginPath();
    ctx.moveTo(pts[startIdx].x, pts[startIdx].y);
    for (let i = startIdx + 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
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

  function handleResetView() {
    panRef.current = { x: 0, y: 0 };
    scaleRef.current = 1;
    fullRedraw();
  }

  useEffect(() => {
    if (!boardId || !user) return;
    async function loadBoard() {
      const { error: joinError } = await supabase.rpc("join_board_via_link", { board_id: boardId });
      if (joinError) console.error("Error joining board:", joinError);

      const { data, error } = await supabase
        .from("boards")
        .select("stroke_data, owner_id")
        .eq("id", boardId)
        .single();
      if (!error && data) {
        if (Array.isArray(data.stroke_data)) setStrokes(data.stroke_data);
        setIsOwner(user.id === data.owner_id);
      } else if (error) {
        console.error("Error loading board:", error);
      }
    }
    loadBoard();
  }, [boardId, user]);

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
    navigator.clipboard.writeText(window.location.href);
    setSaveStatus("Link copied");
    setTimeout(() => setSaveStatus(""), 2000);
  }

  function handleToggleRuler() {
    setRulerActive((prev) => {
      const next = !prev;
      if (next) {
        setRulerPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      }
      return next;
    });
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

    channel.on("broadcast", { event: "stroke-points" }, ({ payload }) => {
      const s = remoteStrokes.current[payload.strokeKey];
      if (!s) return;
      const newCount = payload.points.length;
      s.points.push(...payload.points);
      if (ctxRef.current) drawNewSegment(ctxRef.current, s, newCount);
    });

    channel.on("broadcast", { event: "stroke-straight" }, ({ payload }) => {
      const s = remoteStrokes.current[payload.strokeKey];
      if (!s) return;
      s.points = [payload.start, payload.end];
      fullRedraw();
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
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    function resizeCanvas() {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * ratio;
      canvas.height = window.innerHeight * ratio;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      fullRedraw();
    }

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function scheduleBroadcastFlush() {
      if (rafId.current) return;
      rafId.current = requestAnimationFrame(() => {
        rafId.current = null;
        if (pendingBroadcastPoints.current.length === 0) return;
        const pointsToSend = pendingBroadcastPoints.current;
        pendingBroadcastPoints.current = [];
        channelRef.current?.send({
          type: "broadcast",
          event: "stroke-points",
          payload: {
            strokeKey: `${clientId.current}-${currentStrokeId.current}`,
            points: pointsToSend,
          },
        });
      });
    }

    function scheduleStraightBroadcast(worldStart, worldEnd) {
      pendingStraightUpdate.current = { start: worldStart, end: worldEnd };
      if (rafId.current) return;
      rafId.current = requestAnimationFrame(() => {
        rafId.current = null;
        if (!pendingStraightUpdate.current) return;
        const { start, end } = pendingStraightUpdate.current;
        pendingStraightUpdate.current = null;
        channelRef.current?.send({
          type: "broadcast",
          event: "stroke-straight",
          payload: {
            strokeKey: `${clientId.current}-${currentStrokeId.current}`,
            start,
            end,
          },
        });
      });
    }

    function finalizeStroke(strokeId) {
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      if (pendingBroadcastPoints.current.length > 0 && strokeId) {
        const pointsToSend = pendingBroadcastPoints.current;
        pendingBroadcastPoints.current = [];
        channelRef.current?.send({
          type: "broadcast",
          event: "stroke-points",
          payload: { strokeKey: `${clientId.current}-${strokeId}`, points: pointsToSend },
        });
      }
      if (pendingStraightUpdate.current && strokeId) {
        const { start, end } = pendingStraightUpdate.current;
        pendingStraightUpdate.current = null;
        channelRef.current?.send({
          type: "broadcast",
          event: "stroke-straight",
          payload: { strokeKey: `${clientId.current}-${strokeId}`, start, end },
        });
      }
      if (strokeId) {
        channelRef.current?.send({
          type: "broadcast",
          event: "stroke-end",
          payload: { strokeKey: `${clientId.current}-${strokeId}` },
        });
      }
    }

    function cancelActiveDrawing() {
      if (!isDrawing.current) return;
      isDrawing.current = false;
      const finished = currentStroke.current;
      const strokeId = currentStrokeId.current;
      currentStroke.current = null;
      currentStrokeId.current = null;
      activePointerId.current = null;
      activePointerType.current = null;

      finalizeStroke(strokeId);

      if (finished && finished.points.length > 1) {
        setStrokes((prev) => [...prev, finished]);
        setRedoStack([]);
      }
    }

    function beginPanZoom() {
      const pts = Array.from(touchPoints.current.values());
      if (pts.length < 2) return;
      const [p1, p2] = pts;
      const c = centroid(p1, p2);
      panZoomState.current = {
        initialDistance: distance(p1, p2),
        initialScale: scaleRef.current,
        worldAnchor: screenToWorld(c),
      };
    }

    function updatePanZoom() {
      const pz = panZoomState.current;
      if (!pz) return;
      const pts = Array.from(touchPoints.current.values());
      if (pts.length < 2) return;
      const [p1, p2] = pts;
      const c = centroid(p1, p2);
      const dist = distance(p1, p2);
      const rawScale = pz.initialScale * (dist / pz.initialDistance);
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, rawScale));
      panRef.current = {
        x: c.x - pz.worldAnchor.x * newScale,
        y: c.y - pz.worldAnchor.y * newScale,
      };
      scaleRef.current = newScale;
      fullRedraw();
    }

    function handleWheel(e) {
      e.preventDefault();
      const screenPos = getPos(e);

      if (e.ctrlKey) {
        const zoomFactor = Math.exp(-e.deltaY * 0.01);
        const worldPos = screenToWorld(screenPos);
        const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scaleRef.current * zoomFactor));
        panRef.current = {
          x: screenPos.x - worldPos.x * newScale,
          y: screenPos.y - worldPos.y * newScale,
        };
        scaleRef.current = newScale;
      } else {
        panRef.current = {
          x: panRef.current.x - e.deltaX,
          y: panRef.current.y - e.deltaY,
        };
      }
      fullRedraw();
    }

    function handlePointerDown(e) {
      const pos = getPos(e);

      if (e.pointerType === "touch") {
        touchPoints.current.set(e.pointerId, pos);
      }

      // Two simultaneous touches is always a pinch/pan gesture, no matter
      // what a pen or mouse happens to be doing at the same moment.
      if (touchPoints.current.size >= 2) {
        cancelActiveDrawing();
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
        beginPanZoom();
        return;
      }

      // Anything else arriving while a stroke is already in progress —
      // most commonly a resting palm during an active pencil stroke —
      // is simply ignored. It doesn't start its own stroke, and since
      // it's not (yet) a second touch, it isn't a pinch either.
      if (isDrawing.current) {
        if (e.pointerType === "touch") touchPoints.current.delete(e.pointerId);
        return;
      }

      isDrawing.current = true;
      activePointerId.current = e.pointerId;
      activePointerType.current = e.pointerType;
      strokeScreenStart.current = pos;
      const worldPos = screenToWorld(pos);

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
        points: [worldPos],
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
          point: worldPos,
        },
      });
    }

    function handlePointerMove(e) {
      if (e.pointerType === "touch" && touchPoints.current.has(e.pointerId)) {
        touchPoints.current.set(e.pointerId, getPos(e));
      }

      if (panZoomState.current && touchPoints.current.size >= 2) {
        updatePanZoom();
        return;
      }

      if (e.pointerId !== activePointerId.current) return;
      if (!isDrawing.current || !currentStroke.current) return;

      const screenPos = getPos(e);

      if (rulerActiveRef.current) {
        const projectedScreen = projectOntoAngle(strokeScreenStart.current, screenPos, rulerAngleRef.current);
        const worldStart = screenToWorld(strokeScreenStart.current);
        const worldEnd = screenToWorld(projectedScreen);
        currentStroke.current.points = [worldStart, worldEnd];
        fullRedraw();
        scheduleStraightBroadcast(worldStart, worldEnd);
        return;
      }

      if (e.shiftKey) {
        const worldStart = screenToWorld(strokeScreenStart.current);
        const worldEnd = screenToWorld(screenPos);
        currentStroke.current.points = [worldStart, worldEnd];
        fullRedraw();
        scheduleStraightBroadcast(worldStart, worldEnd);
        return;
      }

      const coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      const eventsToProcess = coalesced.length > 0 ? coalesced : [e];

      const before = currentStroke.current.points.length;
      for (const ev of eventsToProcess) {
        const sp = getPos(ev);
        const wp = screenToWorld(sp);
        currentStroke.current.points.push(wp);
        pendingBroadcastPoints.current.push(wp);
      }
      const newCount = currentStroke.current.points.length - before;

      drawNewSegment(ctxRef.current, currentStroke.current, newCount);
      scheduleBroadcastFlush();
    }

    function handlePointerUp(e) {
      if (e.pointerType === "touch") {
        touchPoints.current.delete(e.pointerId);
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
      }

      if (panZoomState.current) {
        if (touchPoints.current.size < 2) {
          panZoomState.current = null;
        }
        return;
      }

      if (e.pointerId !== activePointerId.current) return;
      if (!isDrawing.current) return;
      isDrawing.current = false;
      activePointerId.current = null;
      activePointerType.current = null;

      const finished = currentStroke.current;
      const strokeId = currentStrokeId.current;
      currentStroke.current = null;
      currentStrokeId.current = null;

      finalizeStroke(strokeId);

      if (finished && finished.points.length > 1) {
        setStrokes((prev) => [...prev, finished]);
        setRedoStack([]);
      }
    }

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, []);

  useEffect(() => {
    if (ctxRef.current) fullRedraw();
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
      
      <a
        href="/"
        style={{
          position: "fixed",
          top: "max(16px, env(safe-area-inset-top))",
          left: 16,
          zIndex: 10,
          width: 40,
          height: 40,
          borderRadius: "50%",
          background: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 1px 6px rgba(0,0,0,0.15)",
          color: "#333",
        }}
      >
        <ArrowLeft size={18} />
      </a>
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
      {rulerActive && (
        <RulerOverlay
          angle={rulerAngle}
          setAngle={setRulerAngle}
          position={rulerPos}
          setPosition={setRulerPos}
        />
      )}
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
        rulerActive={rulerActive}
        onToggleRuler={handleToggleRuler}
        onResetView={handleResetView}
      />
    </div>
  );
}