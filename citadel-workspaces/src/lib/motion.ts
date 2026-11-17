/**
 * The scroll behaviour to request, honouring prefers-reduced-motion.
 *
 * An explicit `behavior` in ScrollIntoViewOptions beats the
 * `scroll-behavior: auto !important` that index.css sets under
 * prefers-reduced-motion, so the media query has to be read by whoever scrolls.
 */
export function preferredScrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

/**
 * How long script-driven transitions take, in seconds -- the one place they are
 * set. `layout` moves a row to its new place (the focused sidebar's FLIP);
 * `fade` fades in what arrives; `leave` fades out what goes, quicker, so that a
 * row arriving or gliding past is never drawn over one still leaving. Short
 * enough that a click never waits on it.
 */
export const MOTION_SECONDS: { readonly layout: number; readonly fade: number; readonly leave: number } = { layout: 0.22, fade: 0.16, leave: 0.1 };
