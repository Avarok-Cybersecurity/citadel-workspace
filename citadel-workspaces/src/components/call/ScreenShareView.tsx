import { useEffect, useRef } from 'react';
import { MonitorUp, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnnotationCanvas } from './AnnotationCanvas';
import type { AnnotationStroke } from '@/lib/call/annotations';

interface ScreenShareViewProps {
  stream: MediaStream;
  /** Whose screen this is, said plainly above it. */
  sharerName: string;
  /** True when the viewer is the one sharing. */
  isSelf: boolean;
  strokes: readonly AnnotationStroke[];
  onPoint: (point: { x: number; y: number }) => void;
  onStrokeStart: () => void;
  onStrokeEnd: () => void;
}

/**
 * The shared screen, and the drawing over it.
 *
 * Sized by aspect ratio rather than by a fixed height: a shared screen is
 * almost always 16:9 or 16:10, and letterboxing it inside a fixed box wastes
 * the space that makes text readable — which is the entire point of sharing a
 * screen.
 *
 * `object-contain`, never `cover`. Cropping somebody's screen to fill a box
 * hides the part they are pointing at, and they cannot tell that it happened.
 */
export function ScreenShareView({
  stream,
  sharerName,
  isSelf,
  strokes,
  onPoint,
  onStrokeStart,
  onStrokeEnd,
}: ScreenShareViewProps): JSX.Element {
  const videoRef: React.MutableRefObject<HTMLVideoElement | null> = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element: HTMLVideoElement | null = videoRef.current;
    if (!element) return;
    if (element.srcObject !== stream) element.srcObject = stream;
    // Autoplay can still be refused; a share that shows a black rectangle with
    // no explanation is worse than one that says nothing happened.
    void element.play().catch(() => {});
  }, [stream]);

  return (
    <figure
      className="relative mb-2 overflow-hidden rounded-lg border border-border bg-black"
      data-testid="call-screen-share"
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        // Muted always: the screen track carries no audio (see captureScreen),
        // and an unmuted element is one more thing autoplay policy can refuse.
        muted
        className="aspect-video w-full bg-black object-contain"
      />

      <AnnotationCanvas
        strokes={strokes}
        interactive
        onPoint={onPoint}
        onStrokeStart={onStrokeStart}
        onStrokeEnd={onStrokeEnd}
      />

      <figcaption
        className={cn(
          'pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 rounded-md',
          'bg-background/80 px-2 py-1 text-xs font-medium text-foreground backdrop-blur-sm',
        )}
      >
        <MonitorUp className="h-3.5 w-3.5 text-primary-accent" aria-hidden="true" />
        {isSelf ? 'You are sharing your screen' : `${sharerName} is sharing`}
      </figcaption>

      <div
        className={cn(
          'pointer-events-none absolute bottom-2 right-2 flex items-center gap-1.5 rounded-md',
          'bg-background/70 px-2 py-1 text-xs text-muted-foreground backdrop-blur-sm',
        )}
      >
        <Pencil className="h-3 w-3" aria-hidden="true" />
        Draw to point — marks fade after a few seconds
      </div>
    </figure>
  );
}
