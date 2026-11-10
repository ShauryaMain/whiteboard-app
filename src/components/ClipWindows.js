"use client";

import { useRef } from "react";
import StoredImg from "./StoredImg";
import { LocateFixed, X } from "lucide-react";
import s from "./RefPane.module.css";

// Clips "kept in view": small windows floating over the board that stay
// put while the board moves underneath (only on this screen). Drag the top
// bar to move one, the corner to resize it.
export default function ClipWindows({ windows, images, onChange, onClose, onShowInPdf }) {
  const dragRef = useRef(null);

  function start(e, win, mode) {
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {
      // (old browsers) still moves while over the bar
    }
    const host = e.currentTarget.closest("[data-board-pane]");
    const rect = host ? host.getBoundingClientRect() : { width: 800, height: 600 };
    dragRef.current = { id: win.id, mode, x0: e.clientX, y0: e.clientY, win, bounds: { width: rect.width, height: rect.height } };
  }

  function move(e) {
    const dr = dragRef.current;
    if (!dr) return;
    const dx = e.clientX - dr.x0, dy = e.clientY - dr.y0;
    const maxW = Math.max(160, dr.bounds.width);
    const maxH = Math.max(120, dr.bounds.height);
    if (dr.mode === "move") {
      onChange(dr.id, {
        x: Math.min(maxW - 60, Math.max(-dr.win.w + 60, dr.win.x + dx)),
        y: Math.min(maxH - 40, Math.max(0, dr.win.y + dy)),
        w: dr.win.w,
      });
    } else {
      onChange(dr.id, { x: dr.win.x, y: dr.win.y, w: Math.min(maxW, Math.max(140, dr.win.w + dx)) });
    }
  }

  function end() {
    dragRef.current = null;
  }

  return (
    <>
      {windows.map((win) => {
        const img = images.find((i) => i.id === win.id);
        if (!img) return null;
        const src = img.source || {};
        const label = src.page ? `p. ${src.page}${src.fileName ? ` · ${src.fileName}` : ""}` : "Clip";
        return (
          <div key={win.id} className={s.floatWin} style={{ left: win.x, top: win.y, width: win.w }} data-clip-window={win.id}>
            <div className={s.floatHead} onPointerDown={(e) => start(e, win, "move")} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
              <span>{label}</span>
              {onShowInPdf && src.pageId && (
                <button
                  type="button"
                  className={s.floatHeadBtn}
                  aria-label="Show in the document"
                  title="Show in the document"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onShowInPdf(img)}
                >
                  <LocateFixed size={16} strokeWidth={2} />
                </button>
              )}
              <button
                type="button"
                className={s.floatHeadBtn}
                aria-label="Stop keeping this in view"
                title="Stop keeping this in view"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onClose(win.id)}
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>
            <StoredImg className={s.floatImg} src={img.src} alt={label} draggable={false} />
            <span className={s.floatResize} onPointerDown={(e) => start(e, win, "resize")} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
          </div>
        );
      })}
    </>
  );
}
