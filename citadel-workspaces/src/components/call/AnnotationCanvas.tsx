import { useEffect, useRef } from 'react';
import {
  authorColour,
  pruneStrokes,
  strokeOpacity,
  type AnnotationStroke,
} from '@/lib/call/annotations';

interface AnnotationCanvasProps {
  strokes: readonly AnnotationStroke[];
  /** Whether this viewer may draw. Read-only viewers still SEE every stroke. */
  interactive: boolean;
  onPoint?: (point: { x: number; y: number }) => void;
  onStrokeStart?: () => void;
  onStrokeEnd?: () => void;
}

/**
 * The drawing layer over a shared screen.
 *
 * A canvas rather than SVG elements: strokes are redrawn every frame as they
 * fade, and mutating a few hundred DOM nodes at 60 Hz is how a shared screen
 * starts dropping frames. Nothing here decides anything about a stroke's life —
 * `lib/call/annotations` owns the arithmetic and is tested on its own.
 *
 * Sized by its own box rather than by the video's intrinsic resolution: the
 * coordinates on the wire are fractions, so the same stroke lands in the same
 * place on a 4K monitor and a phone.
 */
export function AnnotationCanvas({
  strokes,
  interactive,
  onPoint,
  onStrokeStart,
  onStrokeEnd,
}: AnnotationCanvasProps): JSX.Element {
  const canvasRef: React.MutableRefObject<HTMLCanvasElement | null> = useRef<HTMLCanvasElement | null>(null);
  const strokesRef: React.MutableRefObject<readonly AnnotationStroke[]> = useRef<readonly AnnotationStroke[]>(strokes);
  strokesRef.current = strokes;

  useEffect(() => {
    const canvas: HTMLCanvasElement | null = canvasRef.current;
    if (!canvas) return;
    let frame: number = 0;

    const draw = (): void => {
      const context: CanvasRenderingContext2D | null = canvas.getContext('2d');
      if (!context) return;

      // Match the backing store to the element, allowing for a retina display.
      // Without this the strokes are drawn at half resolution and look soft
      // over text that is not.
      const ratio: number = window.devicePixelRatio || 1;
      const width: number = canvas.clientWidth;
      const height: number = canvas.clientHeight;
      if (canvas.width !== Math.floor(width * ratio) || canvas.height !== Math.floor(height * ratio)) {
        canvas.width = Math.floor(width * ratio);
        canvas.height = Math.floor(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const now: number = Date.now();
      for (const stroke of pruneStrokes(strokesRef.current, now)) {
        const opacity: number = strokeOpacity(stroke, now);
        if (opacity <= 0 || stroke.points.length === 0) continue;

        context.globalAlpha = opacity;
        context.strokeStyle = authorColour(stroke.author);
        context.lineWidth = 4;
        context.lineJoin = 'round';
        context.lineCap = 'round';
        // A soft shadow in the same hue keeps a bright stroke legible over a
        // bright screen -- a yellow line on a white document is otherwise
        // almost invisible, which is exactly where somebody points at a word.
        context.shadowColor = 'rgba(0,0,0,0.55)';
        context.shadowBlur = 6;

        context.beginPath();
        stroke.points.forEach((point, index) => {
          const x: number = point.x * width;
          const y: number = point.y * height;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        // A single point is a tap, not a line: `stroke()` draws nothing for a
        // zero-length path, so somebody pointing once would see nothing at all.
        if (stroke.points.length === 1) {
          context.arc(stroke.points[0].x * width, stroke.points[0].y * height, 5, 0, Math.PI * 2);
          context.fillStyle = authorColour(stroke.author);
          context.fill();
        } else {
          context.stroke();
        }
      }
      context.globalAlpha = 1;
      context.shadowBlur = 0;

      frame = window.requestAnimationFrame(draw);
    };

    frame = window.requestAnimationFrame(draw);
    return (): void => window.cancelAnimationFrame(frame);
  }, []);

  const report = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas: HTMLCanvasElement | null = canvasRef.current;
    if (!canvas || !onPoint) return;
    const box: DOMRect = canvas.getBoundingClientRect();
    onPoint({
      x: (event.clientX - box.left) / box.width,
      y: (event.clientY - box.top) / box.height,
    });
  };

  return (
    <canvas
      ref={canvasRef}
      data-testid="call-annotations"
      // Pointer events only where drawing is allowed; otherwise the layer would
      // swallow clicks meant for the page behind it.
      className={interactive ? 'absolute inset-0 h-full w-full cursor-crosshair touch-none' : 'pointer-events-none absolute inset-0 h-full w-full'}
      onPointerDown={
        interactive
          ? (event: React.PointerEvent<HTMLCanvasElement>): void => {
              // Capture, so a stroke that leaves the canvas keeps drawing to
              // the edge instead of stopping the moment the pointer exits.
              event.currentTarget.setPointerCapture(event.pointerId);
              onStrokeStart?.();
              report(event);
            }
          : undefined
      }
      onPointerMove={interactive ? (event: React.PointerEvent<HTMLCanvasElement>): void => { if (event.buttons > 0) report(event); } : undefined}
      onPointerUp={interactive ? (): void => onStrokeEnd?.() : undefined}
      onPointerCancel={interactive ? (): void => onStrokeEnd?.() : undefined}
    />
  );
}
