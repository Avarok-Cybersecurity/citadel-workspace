/**
 * Drawing on a shared screen.
 *
 * Someone points at a thing and says "this one". The pointer has to be visible
 * to everyone, land where they meant on every screen size, and then get out of
 * the way — a drawing that stays becomes clutter over the very thing it was
 * pointing at.
 *
 * Three decisions live here, all of them arithmetic, none of them touching a
 * canvas or a socket:
 *
 *  - **Coordinates are normalised.** A stroke is stored as fractions of the
 *    shared surface, not pixels. The sharer might be at 3840x2160 and a viewer
 *    on a phone; pixels would put the circle somewhere else on every screen.
 *  - **A stroke dies of old age**, five seconds after its last point. Not after
 *    its first: a long arrow drawn over three seconds should not begin
 *    disappearing while it is still being drawn.
 *  - **It fades in and out** rather than blinking. The fade-in is short enough
 *    to feel immediate and long enough not to flash; the fade-out is generous,
 *    because a mark that vanishes mid-sentence reads as a glitch.
 */

/** A point on the shared surface, as a fraction of its width and height. */
export interface AnnotationPoint {
  x: number;
  y: number;
}

export interface AnnotationStroke {
  id: string;
  /** Who drew it, so each person's marks keep one colour. */
  author: string;
  points: AnnotationPoint[];
  /** When the last point was added, in ms since the epoch. */
  updatedAt: number;
}

/** How long a stroke lives after its last point. */
export const STROKE_LIFETIME_MS: number = 5_000;
/** Fade in fast: this is a pointer, and a slow appearance reads as lag. */
export const STROKE_FADE_IN_MS: number = 120;
/** Fade out slowly, so it reads as receding rather than as a dropped frame. */
export const STROKE_FADE_OUT_MS: number = 900;

/**
 * A stroke's opacity right now, between 0 and 1.
 *
 * Zero means it is finished and can be dropped. The fade-out occupies the LAST
 * `STROKE_FADE_OUT_MS` of the lifetime rather than following it, so the total
 * time on screen is exactly `STROKE_LIFETIME_MS` however the fades are tuned.
 */
export function strokeOpacity(stroke: AnnotationStroke, now: number): number {
  const age: number = now - stroke.updatedAt;
  if (age < 0) return 1;
  if (age >= STROKE_LIFETIME_MS) return 0;

  const fadeInDone: number = Math.min(age / STROKE_FADE_IN_MS, 1);
  const remaining: number = STROKE_LIFETIME_MS - age;
  const fadeOut: number = Math.min(remaining / STROKE_FADE_OUT_MS, 1);
  return Math.max(0, Math.min(fadeInDone, fadeOut));
}

/** Drop everything that has finished fading. */
export function pruneStrokes(
  strokes: readonly AnnotationStroke[],
  now: number,
): AnnotationStroke[] {
  return strokes.filter((stroke) => strokeOpacity(stroke, now) > 0);
}

/**
 * Add or extend a stroke.
 *
 * Points arrive one at a time while a finger or mouse moves, and each one
 * refreshes the clock — the whole stroke stays visible for five seconds after
 * the LAST point, not the first.
 */
export function applyStrokePoint(
  strokes: readonly AnnotationStroke[],
  incoming: { id: string; author: string; point: AnnotationPoint; at: number },
): AnnotationStroke[] {
  const existing: AnnotationStroke | undefined = strokes.find((s) => s.id === incoming.id);
  if (!existing) {
    return [
      ...strokes,
      { id: incoming.id, author: incoming.author, points: [incoming.point], updatedAt: incoming.at },
    ];
  }
  return strokes.map((stroke) =>
    stroke.id === incoming.id
      ? { ...stroke, points: [...stroke.points, incoming.point], updatedAt: incoming.at }
      : stroke,
  );
}

/**
 * A stable colour per author.
 *
 * Hue only, from a hash of the name: everyone gets a distinct, saturated colour
 * that survives a reload and does not need a registry. Lightness is fixed high
 * because these are drawn over arbitrary screen content — a dark stroke
 * disappears on a dark terminal.
 */
export function authorColour(author: string): string {
  let hash: number = 0;
  for (let index: number = 0; index < author.length; index += 1) {
    hash = (hash * 31 + author.charCodeAt(index)) % 360;
  }
  return `hsl(${hash} 90% 62%)`;
}

/** Clamp a point into the surface, so a drag off the edge does not escape it. */
export function clampPoint(point: AnnotationPoint): AnnotationPoint {
  return {
    x: Math.min(1, Math.max(0, point.x)),
    y: Math.min(1, Math.max(0, point.y)),
  };
}
