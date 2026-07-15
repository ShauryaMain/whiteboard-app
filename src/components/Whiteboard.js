"use client";

import { useEffect, useRef, useState } from "react";
import Toolbar from "./Toolbar";

const COLORS = ["#000000", "#E53935", "#FB8C00", "#43A047", "#1E88E5", "#8E24AA"];
const WIDTHS = { thin: 2, medium: 5, thick: 10 };

export default function Whiteboard({ boardId }) {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const isDrawing = useRef(false);
  const currentStroke = useRef(null);

  // Keep refs in sync with state so our event listeners (set up once)
  // always see the latest tool/color/width without re-attaching.
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
      currentStroke.current = {
        tool: toolRef.current,
        color: colorRef.current,
        width: toolRef.current === "eraser" ? widthRef.current * 3 : widthRef.current,
        points: [pos],
      };
      canvas.setPointerCapture(e.pointerId);
    }

    function handlePointerMove(e) {
      if (!isDrawing.current || !currentStroke.current) return;
      const pos = getPos(e);
      currentStroke.current.points.push(pos);

      // Draw just the newest segment live, for responsiveness
      const pts = currentStroke.current.points;
      const ctx2 = ctxRef.current;
      ctx2.strokeStyle = currentStroke.current.tool === "eraser" ? "#ffffff" : currentStroke.current.color;
      ctx2.lineWidth = currentStroke.current.width;
      ctx2.beginPath();
      ctx2.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
      ctx2.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx2.stroke();
    }

    function handlePointerUp(e) {
      if (!isDrawing.current) return;
      isDrawing.current = false;

      const finished = currentStroke.current;
      currentStroke.current = null;

      if (finished && finished.points.length > 1) {
        setStrokes((prev) => [...prev, finished]);
        setRedoStack([]); // new stroke clears redo history
      }

      if (e && e.pointerId !== undefined) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch (err) {
          // capture may already be released — safe to ignore
        }
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

  // Redraw whenever strokes change (covers undo/redo/clear too)
  useEffect(() => {
    if (ctxRef.current) redrawAll();
  }, [strokes]);

  function handleUndo() {
    if (strokes.length === 0) return;
    const last = strokes[strokes.length - 1];
    setStrokes(strokes.slice(0, -1));
    setRedoStack((prev) => [...prev, last]);
  }

  function handleRedo() {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack(redoStack.slice(0, -1));
    setStrokes((prev) => [...prev, next]);
  }

  function handleClear() {
    if (strokes.length === 0) return;
    if (window.confirm("Clear the whole board? This can't be undone.")) {
      setStrokes([]);
      setRedoStack([]);
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