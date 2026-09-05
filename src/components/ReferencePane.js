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

// Uncapped devicePixelRatio can be 3+ on some phones/tablets — rendering
// every page and the annotation overlay at that resolution multiplies the
// pixel count (and the cost of compositing all those layers together on
// every pen movement) far more than the visual sharpness gained is worth.
const MAX_RENDER_RATIO = 2;
function getRenderRatio() {
  return Math.min(window.devicePixelRatio || 1, MAX_RENDER_RATIO);
}

// How far above/below the visible area a page still gets fully rendered —
// large enough that scrolling feels seamless, small enough that most of a
// long document stays as lightweight placeholders at any given time.
const RENDER_BUFFER_PX = 1000;

// One page: reserves its correct size immediately (so scrolling never
// jumps), only actually rasterizes its PDF content while within
// RENDER_BUFFER_PX of the visible area, and — importantly — owns its OWN
// small annotation canvas sized to just this page, not the whole document.
// A page-sized canvas is a dramatically smaller surface for the browser
// to composite than one spanning every page stacked together, which is
// what was causing real per-stroke latency on long/complex documents.
function PdfPage({
  pdfDoc, pageNum, width, height, margin, scrollRoot,
  strokes, onStrokeComplete, tool, color,
}) {
  const wrapperRef = useRef(null);
  const pageCanvasRef = useRef(null);
  const annotationRef = useRef(null);
  const annotationCtxRef = useRef(null);
  const [isNear, setIsNear] = useState(pageNum <= 3);
  const renderTokenRef = useRef(0);

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
    const el = wrapperRef.current;
    if (!el || !scrollRoot) return;
    const observer = new IntersectionObserver(
      (entries) => setIsNear(entries[0].isIntersecting),
      { root: scrollRoot, rootMargin: `${RENDER_BUFFER_PX}px 0px ${RENDER_BUFFER_PX}px 0px` }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRoot]);

  // Render (or release) the actual PDF page bitmap.
  useEffect(() => {
    const canvas = pageCanvasRef.current;
    if (!canvas) return;
    const myToken = ++renderTokenRef.current;

    if (isNear) {
      let cancelled = false;
      (async () => {
        try {
          const page = await pdfDoc.getPage(pageNum);
          if (cancelled || myToken !== renderTokenRef.current) return;
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = width / baseViewport.width;
          const viewport = page.getViewport({ scale });
          const ratio = getRenderRatio();
          canvas.width = viewport.width * ratio;
          canvas.height = viewport.height * ratio;
          const ctx = canvas.getContext("2d");
          ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
          await page.render({ canvasContext: ctx, viewport }).promise;
        } catch (err) {
          if (!cancelled) console.error("Error rendering page", pageNum, err);
        }
      })();
      return () => {
        cancelled = true;
      };
    } else {
      canvas.width = 0;
      canvas.height = 0;
    }
  }, [isNear, pdfDoc, pageNum, width]);

  // Size this page's own small annotation canvas.
  useEffect(() => {
    const canvas = annotationRef.current;
    if (!canvas || !isNear) return;
    const ratio = getRenderRatio();
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineJoin = "round";
    annotationCtxRef.current = ctx;
    redrawAnnotations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNear, width, height]);

  useEffect(() => {
    redrawAnnotations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes]);

  // This page's strokes are stored/synced as fractions of THIS page's own
  // width/height (0-1) — converted to local pixels only here, at render
  // time, so they land correctly regardless of any viewer's pane width.
  function toLocal(s) {
    return {
      ...s,
      width: s.widthFrac * width,
      points: s.points.map((p) => ({ x: p.x * width, y: p.y * height })),
    };
  }

  function drawFull(ctx, s) {
    const local = toLocal(s);
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

  function redrawAnnotations() {
    const ctx = annotationCtxRef.current;
    const canvas = annotationRef.current;
    if (!ctx || !canvas) return;
    const ratio = getRenderRatio();
    ctx.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
    for (const s of strokes) drawFull(ctx, s);

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

  function drawLive(fromIndex) {
    const ctx = annotationCtxRef.current;
    const cur = currentStroke.current;
    if (!ctx || !cur) return;
    const pts = cur.localPoints;
    if (pts.length < 2 || fromIndex >= pts.length - 1) return;
    ctx.lineCap = "butt";
    ctx.globalAlpha = cur.opacity;
    ctx.strokeStyle = cur.tool === "eraser" ? "#ffffff" : cur.color;
    ctx.lineWidth = cur.rawWidth;
    ctx.beginPath();
    ctx.moveTo(pts[fromIndex].x, pts[fromIndex].y);
    for (let i = fromIndex + 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function getPos(e) {
    const rect = annotationRef.current.getBoundingClientRect();
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
      annotationRef.current.setPointerCapture(e.pointerId);
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
    drawLive(Math.max(0, before - 1));
  }

  function handlePointerUp(e) {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    const finished = currentStroke.current;
    currentStroke.current = null;
    try {
      annotationRef.current.releasePointerCapture(e.pointerId);
    } catch (err) {}

    if (finished && finished.localPoints.length > 1) {
      onStrokeComplete({
        id: finished.id,
        pageNum,
        tool: finished.tool,
        color: finished.color,
        opacity: finished.opacity,
        widthFrac: finished.rawWidth / width,
        points: finished.localPoints.map((p) => ({ x: p.x / width, y: p.y / height })),
      });
    } else {
      redrawAnnotations();
    }
  }

  return (
    <div
      ref={wrapperRef}
      style={{
        width,
        height,
        marginBottom: margin,
        background: "#fff",
        boxShadow: "0 1px 6px rgba(0,0,0,0.15)",
        position: "relative",
      }}
    >
      <canvas ref={pageCanvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      {isNear && (
        <canvas
          ref={annotationRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            touchAction: "none",
            WebkitUserSelect: "none",
            userSelect: "none",
            WebkitTouchCallout: "none",
          }}
        />
      )}
      {!isNear && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ccc",
            fontSize: 13,
            pointerEvents: "none",
          }}
        >
          {pageNum}
        </div>
      )}
    </div>
  );
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
  const [status, setStatus] = useState("loading");
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageLayout, setPageLayout] = useState([]);
  const [scrollRootEl, setScrollRootEl] = useState(null);

  // Everything below this point (annotationCanvasRef, contentSize, the
  // handlePointer* functions) is used ONLY for the single-image case now.
  // PDFs get their annotation drawing from each PdfPage's own canvas above
  // instead — that per-page split is the actual latency fix.
  const annotationCanvasRef = useRef(null);
  const ctxRef = useRef(null);
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

  useEffect(() => {
    setScrollRootEl(scrollRef.current);
  }, []);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    let loadedProxy = null;

    async function loadDoc() {
      setStatus("loading");
      setPdfDoc(null);
      setPageLayout([]);

      if (doc.fileType !== "application/pdf") {
        const content = contentRef.current;
        if (!content) return;
        content.innerHTML = "";
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
        const pdfDocProxy = await pdfjsLib.getDocument({ url: doc.url }).promise;
        if (cancelled) {
          if (typeof pdfDocProxy.destroy === "function") pdfDocProxy.destroy();
          return;
        }
        loadedProxy = pdfDocProxy;

        const containerWidth = contentRef.current?.clientWidth || 600;
        const pages = [];
        for (let pageNum = 1; pageNum <= pdfDocProxy.numPages; pageNum++) {
          if (cancelled) return;
          const page = await pdfDocProxy.getPage(pageNum);
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = containerWidth / baseViewport.width;
          const pageWidth = containerWidth;
          const pageHeight = baseViewport.height * scale;
          const margin = Math.round(pageWidth * 0.02);
          pages.push({ pageNum, width: pageWidth, height: pageHeight, margin });
        }

        if (cancelled) return;
        setPdfDoc(pdfDocProxy);
        setPageLayout(pages);
        setStatus("ready");
      } catch (err) {
        console.error("Error loading reference document:", err);
        if (!cancelled) setStatus("error");
      }
    }

    loadDoc();
    return () => {
      cancelled = true;
      if (loadedProxy && typeof loadedProxy.destroy === "function") loadedProxy.destroy();
    };
  }, [doc]);

  // --- Image-only annotation path below (unchanged) ---

  useEffect(() => {
    const canvas = annotationCanvasRef.current;
    if (!canvas || contentSize.width === 0 || contentSize.height === 0) return;
    const ratio = getRenderRatio();
    canvas.width = contentSize.width * ratio;
    canvas.height = contentSize.height * ratio;
    canvas.style.width = contentSize.width + "px";
    canvas.style.height = contentSize.height + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineJoin = "round";
    ctxRef.current = ctx;
    redrawAllImage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentSize]);

  useEffect(() => {
    if (doc && doc.fileType !== "application/pdf") redrawAllImage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes]);

  function toLocalImage(s) {
    const w = contentSizeRef.current.width || 1;
    return {
      ...s,
      width: s.widthFrac * w,
      points: s.points.map((p) => ({ x: p.x * w, y: p.y * w })),
    };
  }

  function drawFullImage(ctx, s) {
    const local = toLocalImage(s);
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

  function redrawAllImage() {
    const ctx = ctxRef.current;
    const canvas = annotationCanvasRef.current;
    if (!ctx || !canvas) return;
    const ratio = getRenderRatio();
    ctx.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
    for (const s of strokes) drawFullImage(ctx, s);

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

  function drawLiveImage(fromIndex) {
    const ctx = ctxRef.current;
    const cur = currentStroke.current;
    if (!ctx || !cur) return;
    const pts = cur.localPoints;
    if (pts.length < 2 || fromIndex >= pts.length - 1) return;
    ctx.lineCap = "butt";
    ctx.globalAlpha = cur.opacity;
    ctx.strokeStyle = cur.tool === "eraser" ? "#ffffff" : cur.color;
    ctx.lineWidth = cur.rawWidth;
    ctx.beginPath();
    ctx.moveTo(pts[fromIndex].x, pts[fromIndex].y);
    for (let i = fromIndex + 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function getPosImage(e) {
    const rect = annotationCanvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handleImagePointerDown(e) {
    isDrawing.current = true;
    const pos = getPosImage(e);
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

  function handleImagePointerMove(e) {
    if (!isDrawing.current || !currentStroke.current) return;
    const coalesced = e.nativeEvent.getCoalescedEvents ? e.nativeEvent.getCoalescedEvents() : [];
    const events = coalesced.length > 0 ? coalesced : [e.nativeEvent];
    const before = currentStroke.current.localPoints.length;
    for (const ev of events) {
      currentStroke.current.localPoints.push(getPosImage(ev));
    }
    drawLiveImage(Math.max(0, before - 1));
  }

  function handleImagePointerUp(e) {
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
      redrawAllImage();
    }
  }

  if (!doc) return null;

  const isPdf = doc.fileType === "application/pdf";

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

        {isPdf ? (
          <div ref={contentRef}>
            {status === "ready" &&
              pdfDoc &&
              pageLayout.map((p) => (
                <PdfPage
                  key={p.pageNum}
                  pdfDoc={pdfDoc}
                  pageNum={p.pageNum}
                  width={p.width}
                  height={p.height}
                  margin={p.margin}
                  scrollRoot={scrollRootEl}
                  strokes={strokes.filter((s) => s.pageNum === p.pageNum)}
                  onStrokeComplete={onStrokeComplete}
                  tool={tool}
                  color={color}
                />
              ))}
          </div>
        ) : (
          <div style={{ position: "relative" }}>
            <div ref={contentRef} />
            {status === "ready" && contentSize.width > 0 && (
              <canvas
                ref={annotationCanvasRef}
                onPointerDown={handleImagePointerDown}
                onPointerMove={handleImagePointerMove}
                onPointerUp={handleImagePointerUp}
                onPointerCancel={handleImagePointerUp}
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
        )}
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