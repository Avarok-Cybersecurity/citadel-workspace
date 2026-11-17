/**
 * A drawing on a shared screen appears, holds, and gets out of the way.
 *
 * All arithmetic, no canvas: the fade, the lifetime and the coordinate space are
 * the parts that can be wrong in ways nobody notices until a demo.
 */
import { describe, it, expect } from 'vitest';
import {
  applyStrokePoint,
  authorColour,
  clampPoint,
  pruneStrokes,
  strokeOpacity,
  STROKE_FADE_IN_MS,
  STROKE_FADE_OUT_MS,
  STROKE_LIFETIME_MS,
  type AnnotationStroke,
} from '../annotations';

const NOW: number = 1_000_000;

function stroke(updatedAt: number = NOW): AnnotationStroke {
  return { id: 's1', author: 'ada', points: [{ x: 0.5, y: 0.5 }], updatedAt };
}

describe('a stroke', () => {
  it('fades in rather than blinking on', () => {
    expect(strokeOpacity(stroke(), NOW)).toBe(0);
    expect(strokeOpacity(stroke(), NOW + STROKE_FADE_IN_MS / 2)).toBeCloseTo(0.5, 2);
    expect(strokeOpacity(stroke(), NOW + STROKE_FADE_IN_MS)).toBe(1);
  });

  it('is fully visible through the middle of its life', () => {
    expect(strokeOpacity(stroke(), NOW + 2_000)).toBe(1);
  });

  it('fades out over the LAST part of its lifetime, not after it', () => {
    // Total time on screen stays exactly the lifetime however the fade is
    // tuned; a fade that followed the lifetime would silently extend it.
    const halfwayThroughTheFade: number = NOW + STROKE_LIFETIME_MS - STROKE_FADE_OUT_MS / 2;
    expect(strokeOpacity(stroke(), halfwayThroughTheFade)).toBeCloseTo(0.5, 2);
    expect(strokeOpacity(stroke(), NOW + STROKE_LIFETIME_MS)).toBe(0);
    expect(strokeOpacity(stroke(), NOW + STROKE_LIFETIME_MS + 1)).toBe(0);
  });

  it('dies five seconds after its LAST point, not its first', () => {
    // A long arrow drawn over three seconds must not start disappearing while
    // it is still being drawn.
    let strokes: AnnotationStroke[] = [];
    strokes = applyStrokePoint(strokes, { id: 'a', author: 'ada', point: { x: 0, y: 0 }, at: NOW });
    strokes = applyStrokePoint(strokes, { id: 'a', author: 'ada', point: { x: 1, y: 1 }, at: NOW + 3_000 });
    expect(strokes[0].points).toHaveLength(2);
    // The discriminating moment: past the first point's five seconds, and still
    // fully visible because the second point restarted the clock. Asserting
    // only "gone by NOW + 3000 + lifetime" passes either way -- the first
    // version of this test did, and a control that stopped refreshing the clock
    // went green.
    expect(strokeOpacity(strokes[0], NOW + STROKE_LIFETIME_MS + 500)).toBe(1);
    expect(strokeOpacity(strokes[0], NOW + 3_000 + STROKE_LIFETIME_MS)).toBe(0);
  });

  it('is pruned only once it has finished fading', () => {
    const strokes: AnnotationStroke[] = [stroke(NOW), stroke(NOW - STROKE_LIFETIME_MS)];
    expect(pruneStrokes(strokes, NOW + 1_000)).toHaveLength(1);
  });

  it('never leaves the surface it was drawn on', () => {
    // A drag past the edge of the shared area would otherwise be drawn outside
    // it on every other viewer's screen.
    expect(clampPoint({ x: 1.4, y: -0.2 })).toEqual({ x: 1, y: 0 });
    expect(clampPoint({ x: 0.25, y: 0.75 })).toEqual({ x: 0.25, y: 0.75 });
  });
});

describe('a stroke colour', () => {
  it('is stable for the same person', () => {
    expect(authorColour('ada')).toBe(authorColour('ada'));
  });

  it('differs between people', () => {
    expect(authorColour('ada')).not.toBe(authorColour('grace'));
  });

  it('is light enough to sit on a dark screen', () => {
    // These are drawn over arbitrary content -- a dark stroke disappears on a
    // dark terminal, which is exactly where somebody points at something.
    const lightness: number = Number(/(\d+)%\)$/.exec(authorColour('ada'))?.[1]);
    expect(lightness).toBeGreaterThanOrEqual(55);
  });
});
