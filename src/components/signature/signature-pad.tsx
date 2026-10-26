'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The signature box.
 *
 * Drawn with pointer events rather than mouse or touch events, so a finger, a
 * stylus and a mouse all take the same code path — this is used on a tablet
 * handed across a desk to an applicant as often as on a laptop.
 *
 * Three details that matter on a real device:
 *
 *   * The canvas is sized to its own CSS box multiplied by the device pixel
 *     ratio, so the stroke is not a blurry upscale on a phone. Without it a
 *     signature looks like a smudge in the printed PDF.
 *   * `touch-action: none` on the surface, or the browser scrolls the page
 *     instead of drawing.
 *   * Pointer capture, so a stroke that leaves the box mid-flick still ends
 *     cleanly instead of leaving the pad stuck in a drawing state.
 *
 * It reports "has a stroke" upwards so the parent can keep the submit button
 * disabled; the server checks the image too, since this check is a convenience
 * and not a guarantee.
 */

export type SignaturePadHandle = {
  /** PNG data URL, or null when nothing has been drawn. */
  toDataUrl: () => string | null;
  clear: () => void;
};

export function SignaturePad({
  onChange,
  disabled = false,
  label,
  padRef,
}: {
  /** Called with whether anything has been drawn. */
  onChange: (hasStroke: boolean) => void;
  disabled?: boolean;
  label: string;
  padRef: React.RefObject<SignaturePadHandle | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasStroke = useRef(false);
  const [ready, setReady] = useState(false);

  /** Re-sizes the backing store to the CSS box, preserving what was drawn. */
  const fitToBox = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.round(rect.width * ratio);
    const height = Math.round(rect.height * ratio);
    if (canvas.width === width && canvas.height === height) return;

    // Keep any existing strokes across a resize (an orientation change on a
    // tablet should not wipe a half-drawn signature).
    const previous = hasStroke.current ? canvas.toDataURL('image/png') : null;

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#111827';

    if (previous) {
      const image = new Image();
      image.onload = () => context.drawImage(image, 0, 0, rect.width, rect.height);
      image.src = previous;
    }

    setReady(true);
  }, []);

  useEffect(() => {
    fitToBox();
    window.addEventListener('resize', fitToBox);
    return () => window.removeEventListener('resize', fitToBox);
  }, [fitToBox]);

  useEffect(() => {
    padRef.current = {
      toDataUrl: () => {
        const canvas = canvasRef.current;
        if (!canvas || !hasStroke.current) return null;
        return canvas.toDataURL('image/png');
      },
      clear: () => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) return;
        context.clearRect(0, 0, canvas.width, canvas.height);
        hasStroke.current = false;
        onChange(false);
      },
    };
  }, [onChange, padRef]);

  function positionOf(event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>): void {
    if (disabled) return;
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;

    // So a stroke that leaves the box still ends cleanly.
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;

    const { x, y } = positionOf(event);
    context.beginPath();
    context.moveTo(x, y);
    // A single tap should leave a visible dot, not nothing.
    context.lineTo(x + 0.1, y + 0.1);
    context.stroke();

    if (!hasStroke.current) {
      hasStroke.current = true;
      onChange(true);
    }
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>): void {
    if (!drawing.current || disabled) return;
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;

    const { x, y } = positionOf(event);
    context.lineTo(x, y);
    context.stroke();
  }

  function end(event: React.PointerEvent<HTMLCanvasElement>): void {
    if (!drawing.current) return;
    drawing.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        aria-label={label}
        role="img"
        className={`h-40 w-full rounded-md border-2 border-dashed bg-white ${
          disabled ? 'cursor-not-allowed border-gray-200 opacity-60' : 'cursor-crosshair border-gray-400'
        }`}
        style={{ touchAction: 'none' }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      {!ready ? (
        <p className="mt-1 text-xs text-gray-400">Preparing the signature box…</p>
      ) : null}
    </div>
  );
}
