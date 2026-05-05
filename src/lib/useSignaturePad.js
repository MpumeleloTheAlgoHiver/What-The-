/**
 * useSignaturePad — shared signature-pad lifecycle hook.
 *
 * Fixes the common cross-device problems we had:
 *  • DPR scaling so strokes are crisp on retina/mobile.
 *  • Resize handler that PRESERVES the user's drawing
 *    (iOS Safari fires resize when the URL bar shows/hides
 *     and on orientation change — previously this wiped the canvas).
 *  • Handles late canvas mounts (e.g. canvas appears after a modal
 *    step transition) via ResizeObserver.
 *  • CSS touch-action:none (caller must still set it on the canvas
 *    element too — the hook just sets it defensively).
 *
 * Usage:
 *   const canvasRef = useRef(null);
 *   const { padRef, clear, isEmpty, toDataURL, isReady } =
 *     useSignaturePad(canvasRef, { enabled: phase === "sign" });
 *
 *   <canvas ref={canvasRef} style={{ touchAction: "none", width: "100%", height: "100%" }} />
 */

import { useEffect, useRef, useCallback, useState } from "react";
import SignaturePad from "signature_pad";

const DEFAULT_OPTIONS = {
  backgroundColor: "rgb(255,255,255)",
  penColor: "rgb(30,27,75)",
  minWidth: 1.2,
  maxWidth: 2.6,
};

export function useSignaturePad(canvasRef, options = {}) {
  const { enabled = true, onEndStroke, ...padOptions } = options;
  const padRef = useRef(null);
  const [isReady, setIsReady] = useState(false);

  // force re-render hook consumers when emptiness changes
  const [, forceTick] = useState(0);
  const notify = useCallback(() => forceTick((t) => t + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Defensive: ensure scrolling is disabled during sign strokes.
    try { canvas.style.touchAction = "none"; } catch {}

    const scaleCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      // Skip when not laid out yet (modal still opening, display:none, etc).
      if (rect.width === 0 || rect.height === 0) return false;

      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const desiredW = Math.round(rect.width * ratio);
      const desiredH = Math.round(rect.height * ratio);

      // Only rebuild if size actually changed.
      if (canvas.width === desiredW && canvas.height === desiredH) return true;

      // Preserve existing drawing (signature_pad stores strokes as JSON).
      const preserved = padRef.current && !padRef.current.isEmpty()
        ? padRef.current.toData()
        : null;

      canvas.width = desiredW;
      canvas.height = desiredH;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(ratio, ratio);

      if (padRef.current) {
        padRef.current.clear();
        if (preserved && preserved.length > 0) {
          try { padRef.current.fromData(preserved); } catch { /* ignore */ }
        }
      }
      return true;
    };

    // Create pad first so scaleCanvas can use it for preservation.
    padRef.current = new SignaturePad(canvas, { ...DEFAULT_OPTIONS, ...padOptions });
    padRef.current.addEventListener("endStroke", () => {
      notify();
      if (typeof onEndStroke === "function") {
        try { onEndStroke(padRef.current); } catch { /* ignore */ }
      }
    });

    const ok = scaleCanvas();
    if (ok) setIsReady(true);

    // Watch the canvas box — handles late layout (modal open, flex reflow).
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        if (scaleCanvas()) setIsReady(true);
      });
      ro.observe(canvas);
    }

    const onWinResize = () => scaleCanvas();
    window.addEventListener("resize", onWinResize);
    window.addEventListener("orientationchange", onWinResize);

    return () => {
      window.removeEventListener("resize", onWinResize);
      window.removeEventListener("orientationchange", onWinResize);
      if (ro) ro.disconnect();
      if (padRef.current) {
        try { padRef.current.off(); } catch { /* ignore */ }
        padRef.current = null;
      }
      setIsReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const clear = useCallback(() => {
    padRef.current?.clear();
    notify();
  }, [notify]);

  const isEmpty = useCallback(() => {
    return !padRef.current || padRef.current.isEmpty();
  }, []);

  const toDataURL = useCallback((type = "image/png") => {
    if (!padRef.current) return null;
    return padRef.current.toDataURL(type);
  }, []);

  return { padRef, clear, isEmpty, toDataURL, isReady };
}

export default useSignaturePad;
