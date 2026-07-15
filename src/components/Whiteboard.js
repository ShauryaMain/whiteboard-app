"use client";

import { useEffect, useRef } from "react";

export default function Whiteboard() {
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const lastPoint = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    function resizeCanvas() {
      // Save current drawing before resizing (resizing clears the canvas)
      const imageData = canvas.width && canvas.height
        ? ctx.getImageData(0, 0, canvas.width, canvas.height)
        : null;

      const ratio = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * ratio;
      canvas.height = window.innerHeight * ratio;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      ctx.scale(ratio, ratio);

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 3;

      if (imageData) ctx.putImageData(imageData, 0, 0);
    }

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function handlePointerDown(e) {
      isDrawing.current = true;
      lastPoint.current = getPos(e);
      canvas.setPointerCapture(e.pointerId);
    }

    function handlePointerMove(e) {
      if (!isDrawing.current) return;
      const pos = getPos(e);

      // Support pressure-sensitive pens (Apple Pencil, drawing tablets)
      const pressure = e.pressure && e.pressure > 0 ? e.pressure : 0.5;
      ctx.lineWidth = 1 + pressure * 5;

      ctx.beginPath();
      ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();

      lastPoint.current = pos;
    }

    function handlePointerUp(e) {
      isDrawing.current = false;
      canvas.releasePointerCapture(e.pointerId);
    }

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointerleave", handlePointerUp);

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointerleave", handlePointerUp);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: "block",
        touchAction: "none", // stops mobile scrolling/zooming while drawing
        background: "#ffffff",
      }}
    />
  );
}