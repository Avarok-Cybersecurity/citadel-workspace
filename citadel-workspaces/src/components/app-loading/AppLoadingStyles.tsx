/**
 * The app loading pane's own styles, carried in its lazy chunk and drawn as a <style> element
 * beside it rather than in the app's stylesheet: the landing page never shows a loading app, so
 * none of this belongs on its critical path. (A chunk stylesheet would cost the landing entry a
 * preload entry of its own; this costs it nothing.)
 *
 * Motion follows the app's three tiers (lib/motion-tier.ts) the way index.css does. Full: the
 * indeterminate bar sweeps. Lite keeps only opacity, so the sweep's keyframe is swapped for a
 * breathe across the whole track (never by zeroing a variable). Off -- the Animations setting or
 * the OS asking for reduced motion -- is clamped by index.css's global rule; here the bar is
 * drawn full width and dimmed, so a frozen sweep never reads as a measured 40 per cent.
 */
export const APP_LOADING_CSS: string = `
.app-loading-track {
  position: relative;
  height: 6px;
  overflow: hidden;
  border-radius: 9999px;
  background: hsl(var(--muted));
}

.app-loading-fill {
  height: 100%;
  border-radius: inherit;
  background: hsl(var(--primary));
  transition: width 200ms ease-out;
}

@keyframes app-loading-sweep {
  from { transform: translateX(-100%); }
  to { transform: translateX(250%); }
}

@keyframes app-loading-breathe {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}

.app-loading-fill[data-indeterminate] {
  width: 40%;
  animation: app-loading-sweep 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

.lite-motion .app-loading-fill[data-indeterminate] {
  width: 100%;
  animation-name: app-loading-breathe;
}

.reduce-motion .app-loading-fill[data-indeterminate] {
  width: 100%;
  opacity: 0.5;
}

@media (prefers-reduced-motion: reduce) {
  .app-loading-fill[data-indeterminate] {
    width: 100%;
    opacity: 0.5;
  }
}

/* One line tall even while empty, so the card keeps its height when a measured stage begins. */
.app-loading-detail {
  min-height: 1rem;
}

/* A sheet of the document's paper while it loads: A4's proportions, as wide as the pane allows. */
.app-loading-sheet {
  width: min(560px, calc(100% - 32px));
  aspect-ratio: 210 / 297;
  padding: 40px;
}

.app-loading-card {
  width: min(320px, calc(100% - 32px));
}

/* Over the sheet's first lines, where the eye goes when a document opens. */
.app-loading-floating {
  top: 96px;
}
`;

/** The rules, once per mounted indicator; identical copies are harmless and none outlives its pane. */
export function AppLoadingStyles(): JSX.Element {
  return <style data-app-loading-styles="">{APP_LOADING_CSS}</style>;
}
