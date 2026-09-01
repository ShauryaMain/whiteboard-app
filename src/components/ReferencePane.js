"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, Highlighter, Eraser, Undo2 } from "lucide-react";

const PRESET_COLORS = ["#E53935", "#1a1a1a", "#1E88E5", "#43A047", "#FB8C00"];

function opacityForTool(t) {
  return t === "highlighter" ? 0.35 : 1;
}

function widthForTool(t, base) {
  if (t === "eraser") return base * 5;
  if (t === "highlighter") return base * 2.5;
  return base;
}

export default function ReferencePane({
  doc,
  strokes,
  onStrokeComplete,
  tool,
  setTool,
  color,
  setColor,
  canUndo,
  onUndo,
}) {
  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const annotationCanvasRef = useRef(null);
  const ctxRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 });
  const contentSizeRef = useRef({ width: 0, height: 0 });

  const isDrawing = useRef(false);
  const currentStroke = useRef(null);
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);
  useEffect(() => {
    colorRef.current = color;
  }, [color]);
  useEffect(() => {
    contentSizeRef.current = contentSize;
  }, [contentSize]);

  // Renders the PDF's pages (or a single image) into contentRef, then
  // measures the resulting total size so the annotation canvas — a
  // separate element layered on top — can be sized to match exactly.
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;

    async function renderContent() {
      setStatus("loading");
      const content = contentRef.current;
      if (!content) return;
      content.innerHTML = "";

      if (doc.fileType !== "application/pdf") {
        const img = document.createElement("img");
        img.src = doc.url;
        img.style.width = "100%";
        img.style.display = "block";
        await new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve;
        });
        if (cancelled) return;
        content.appendChild(img);
        setContentSize({
          width: content.clientWidth,
          height: img.naturalHeight
            ? (content.clientWidth / img.naturalWidth) * img.naturalHeight
            : content.scrollHeight,
        });
        setStatus("ready");
        return;
      }

      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
        const pdfDoc = await pdfjsLib.getDocument({ url: doc.url }).promise;

        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
          if (cancelled) return;
          const page = await pdfDoc.getPage(pageNum);
          const containerWidth = content.clientWidth || 600;
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = containerWidth / baseViewport.width;
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          const ratio = window.devicePixelRatio || 1;
          canvas.width = viewport.width * ratio;
          canvas.height = viewport.height * ratio;
          canvas.style.width = viewport.width + "px";
          canvas.style.height = viewport.height + "px";
          canvas.style.display = "block";
          // Proportional to page width, not a fixed pixel value — this
          // keeps total content height exactly proportional to width for
          // every viewer, regardless of how wide their own pane happens
          // to be. That proportionality is what lets us store annotation
          // coordinates as simple fractions (below) and have them land
          // in the same place for everyone.
          canvas.style.marginBottom = Math.round(viewport.width * 0.02) + "px";
          canvas.style.boxShadow = "0 1px 6px rgba(0,0,0,0.15)";
          canvas.style.background = "#fff";

          const ctx = canvas.getContext("2d");
          ctx.scale(ratio, ratio);
          await page.render({ canvasContext: ctx, viewport }).promise;

          if (cancelled) return;
          content.appendChild(canvas);
        }

        if (!cancelled) {
          setContentSize({ width: content.clientWidth, height: content.scrollHeight });
          setStatus("ready");
        }
      } catch (err) {
        console.error("Error rendering reference document:", err);
        if (!cancelled) setStatus("error");
      }
    }

    renderContent();
    return () => {
      cancelled = true;
    };
  }, [doc]);

  // Size the annotation canvas to match the rendered content exactly.
  useEffect(() => {
    const canvas = annotationCanvasRef.current;
    if (!canvas || contentSize.width === 0 || contentSize.height === 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = contentSize.width * ratio;
    canvas.height = contentSize.height * ratio;
    canvas.style.width = contentSize.width + "px";
    canvas.style.height = contentSize.height + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineJoin = "round";
    ctxRef.current = ctx;
    redrawAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentSize]);

  useEffect(() => {
    redrawAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes]);

  // Strokes are stored/synced as fractions of content width (0-1), not
  // raw pixels — converting to THIS viewer's own local pixels only here,
  // at render time. This is what makes an annotation land in the right
  // spot for everyone regardless of how wide any two people's panes are.
  function toLocalStroke(s) {
    const w = contentSizeRef.current.width || 1;
    return {
      ...s,
      width: s.widthFrac * w,
      points: s.points.map((p) => ({ x: p.x * w, y: p.y * w })),
    };
  }

  function drawStrokeFull(ctx, s) {
    const local = toLocalStroke(s);
    if (!local.points || local.points.length < 2) return;
    ctx.lineCap = "round";
    ctx.globalAlpha = local.opacity ?? 1;
    ctx.strokeStyle = local.tool === "eraser" ? "#ffffff" : local.color;
    ctx.lineWidth = local.width;
    ctx.beginPath();
    ctx.moveTo(local.points[0].x, local.points[0].y);
    for (let i = 1; i < local.points.length; i++) ctx.lineTo(local.points[i].x, local.points[i].y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function redrawAll() {
    const ctx = ctxRef.current;
    const canvas = annotationCanvasRef.current;
    if (!ctx || !canvas) return;
    const ratio = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
    for (const s of strokes) drawStrokeFull(ctx, s);

    // If someone else's stroke arrives while we're mid-draw ourselves,
    // this full redraw would otherwise wipe our own in-progress mark —
    // repaint it on top, same as the main whiteboard does.
    const cur = currentStroke.current;
    if (cur && cur.localPoints.length > 1) {
      ctx.lineCap = "round";
      ctx.globalAlpha = cur.opacity;
      ctx.strokeStyle = cur.tool === "eraser" ? "#ffffff" : cur.color;
      ctx.lineWidth = cur.rawWidth;
      ctx.beginPath();
      ctx.moveTo(cur.localPoints[0].x, cur.localPoints[0].y);
      for (let i = 1; i < cur.localPoints.length; i++) ctx.lineTo(cur.localPoints[i].x, cur.localPoints[i].y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // Fast path used while actively drawing: paints only the newest bit of
  // the stroke (kept in local pixels while in progress, only normalized
  // to fractions once finished) instead of redrawing everything every
  // frame — this is the fix for the slowness.
  function drawLiveSegment(ctx, localPoints, width, strokeColor, opacity, strokeTool, fromIndex) {
    if (localPoints.length < 2 || fromIndex >= localPoints.length - 1) return;
    ctx.lineCap = "butt";
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = strokeTool === "eraser" ? "#ffffff" : strokeColor;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(localPoints[fromIndex].x, localPoints[fromIndex].y);
    for (let i = fromIndex + 1; i < localPoints.length; i++) ctx.lineTo(localPoints[i].x, localPoints[i].y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function getPos(e) {
    const rect = annotationCanvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointerDown(e) {
    isDrawing.current = true;
    const pos = getPos(e);
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    currentStroke.current = {
      id,
      tool: toolRef.current,
      color: colorRef.current,
      opacity: opacityForTool(toolRef.current),
      rawWidth: widthForTool(toolRef.current, 3),
      localPoints: [pos],
    };
    try {
      annotationCanvasRef.current.setPointerCapture(e.pointerId);
    } catch (err) {}
  }

  function handlePointerMove(e) {
    if (!isDrawing.current || !currentStroke.current) return;
    const coalesced = e.nativeEvent.getCoalescedEvents ? e.nativeEvent.getCoalescedEvents() : [];
    const events = coalesced.length > 0 ? coalesced : [e.nativeEvent];
    const before = currentStroke.current.localPoints.length;
    for (const ev of events) {
      currentStroke.current.localPoints.push(getPos(ev));
    }
    drawLiveSegment(
      ctxRef.current,
      currentStroke.current.localPoints,
      currentStroke.current.rawWidth,
      currentStroke.current.color,
      currentStroke.current.opacity,
      currentStroke.current.tool,
      Math.max(0, before - 1)
    );
  }

  function handlePointerUp(e) {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    const finished = currentStroke.current;
    currentStroke.current = null;
    try {
      annotationCanvasRef.current.releasePointerCapture(e.pointerId);
    } catch (err) {}

    if (finished && finished.localPoints.length > 1) {
      const w = contentSizeRef.current.width || 1;
      onStrokeComplete({
        id: finished.id,
        tool: finished.tool,
        color: finished.color,
        opacity: finished.opacity,
        widthFrac: finished.rawWidth / w,
        points: finished.localPoints.map((p) => ({ x: p.x / w, y: p.y / w })),
      });
    } else {
      redrawAll();
    }
  }

  if (!doc) return null;

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      <div
        ref={scrollRef}
        style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 16, boxSizing: "border-box" }}
      >
        {status === "loading" && (
          <div style={{ textAlign: "center", color: "#888", fontSize: 14, marginTop: 40 }}>
            Loading document…
          </div>
        )}
        {status === "error" && (
          <div style={{ textAlign: "center", color: "#c62828", fontSize: 14, marginTop: 40 }}>
            Couldn't load this document.
          </div>
        )}
        <div style={{ position: "relative" }}>
          <div ref={contentRef} />
          {status === "ready" && contentSize.width > 0 && (
            <canvas
              ref={annotationCanvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onContextMenu={(e) => e.preventDefault()}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                touchAction: "none",
                WebkitUserSelect: "none",
                userSelect: "none",
                WebkitTouchCallout: "none",
              }}
            />
          )}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: "#fff",
          borderTop: "1px solid #eee",
          flexWrap: "wrap",
        }}
      >
        <ToolBtn active={tool === "pen"} onClick={() => setTool("pen")} label="Pen">
          <Pencil size={16} />
        </ToolBtn>
        <ToolBtn active={tool === "highlighter"} onClick={() => setTool("highlighter")} label="Highlighter">
          <Highlighter size={16} />
        </ToolBtn>
        <ToolBtn active={tool === "eraser"} onClick={() => setTool("eraser")} label="Eraser">
          <Eraser size={16} />
        </ToolBtn>
        <div style={{ width: 1, height: 20, background: "#e5e5e5" }} />
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => {
              setColor(c);
              if (tool === "eraser") setTool("pen");
            }}
            aria-label={`Color ${c}`}
            style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: c,
              border: color === c ? "2px solid #1a1a1a" : "2px solid transparent",
              boxShadow: "0 0 0 1px #ddd",
              cursor: "pointer",
              padding: 0,
              flexShrink: 0,
            }}
          />
        ))}
        <div style={{ width: 1, height: 20, background: "#e5e5e5" }} />
        <ToolBtn active={false} disabled={!canUndo} onClick={onUndo} label="Undo">
          <Undo2 size={16} />
        </ToolBtn>
      </div>
    </div>
  );
}

function ToolBtn({ children, active, disabled, onClick, label }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 30,
        height: 30,
        border: "none",
        borderRadius: 6,
        background: active ? "#E3F2FD" : "transparent",
        color: disabled ? "#ccc" : "#333",
        cursor: disabled ? "default" : "pointer",
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}
