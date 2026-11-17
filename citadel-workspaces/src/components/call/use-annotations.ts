import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { eventEmitter } from '@/lib/event-emitter';
import {
  applyStrokePoint,
  clampPoint,
  pruneStrokes,
  STROKE_LIFETIME_MS,
  type AnnotationPoint,
  type AnnotationStroke,
} from '@/lib/call/annotations';

interface IncomingAnnotation {
  callId: string;
  strokeId: string;
  author: string;
  point: AnnotationPoint;
  at: number;
}

interface UseAnnotationsOptions {
  callId: string | null;
  /** This viewer's name, stamped on strokes they draw. */
  author: string;
  /** Sends one point to everyone else. Absent means read-only. */
  send?: (stroke: { strokeId: string; point: AnnotationPoint }) => void;
}

/**
 * The strokes currently on the shared screen, local and remote alike.
 *
 * Local strokes are added immediately rather than after a round trip: a pointer
 * that lags behind the mouse by a network hop is unusable, and every stroke
 * disappears in five seconds anyway, so there is nothing to reconcile.
 *
 * The sweep is a timer, not a render loop -- the canvas redraws itself every
 * frame regardless. This only exists so a finished stroke stops occupying
 * memory in a call that runs for an hour.
 */
export function useAnnotations({ callId, author, send }: UseAnnotationsOptions): {
  strokes: readonly AnnotationStroke[];
  beginStroke: () => void;
  addPoint: (point: AnnotationPoint) => void;
  endStroke: () => void;
} {
  const [strokes, setStrokes] = useState<readonly AnnotationStroke[]>([]);
  const localStrokeId: React.MutableRefObject<string | null> = useRef<string | null>(null);

  useEffect(() => {
    const onAnnotate = (incoming: IncomingAnnotation): void => {
      // Another call's strokes are not this call's. Two calls can exist in one
      // browser across tabs, and the event bus is shared.
      if (!callId || incoming.callId !== callId) return;
      setStrokes((previous) =>
        applyStrokePoint(pruneStrokes(previous, incoming.at), {
          id: incoming.strokeId,
          author: incoming.author,
          point: clampPoint(incoming.point),
          at: incoming.at,
        }),
      );
    };
    eventEmitter.on('call:annotate', onAnnotate);
    return (): void => eventEmitter.off('call:annotate', onAnnotate);
  }, [callId]);

  useEffect(() => {
    if (!callId) {
      setStrokes((previous) => (previous.length === 0 ? previous : []));
      return;
    }
    // Half the lifetime: often enough that a finished stroke does not linger in
    // memory, rare enough that it costs nothing.
    const id: number = window.setInterval(() => {
      setStrokes((previous) => {
        const swept: AnnotationStroke[] = pruneStrokes(previous, Date.now());
        return swept.length === previous.length ? previous : swept;
      });
    }, STROKE_LIFETIME_MS / 2);
    return (): void => window.clearInterval(id);
  }, [callId]);

  const beginStroke: () => void = useCallback((): void => {
    localStrokeId.current = crypto.randomUUID();
  }, []);

  const addPoint: (point: AnnotationPoint) => void = useCallback(
    (point: AnnotationPoint): void => {
      if (!callId) return;
      // A move without a preceding down -- possible when a pointer enters the
      // canvas already pressed -- still draws rather than being dropped.
      if (!localStrokeId.current) localStrokeId.current = crypto.randomUUID();
      const strokeId: string = localStrokeId.current;
      const clamped: AnnotationPoint = clampPoint(point);
      setStrokes((previous) =>
        applyStrokePoint(pruneStrokes(previous, Date.now()), {
          id: strokeId,
          author,
          point: clamped,
          at: Date.now(),
        }),
      );
      send?.({ strokeId, point: clamped });
    },
    [callId, author, send],
  );

  const endStroke: () => void = useCallback((): void => {
    localStrokeId.current = null;
  }, []);

  return { strokes, beginStroke, addPoint, endStroke };
}
