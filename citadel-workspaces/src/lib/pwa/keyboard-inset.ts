/**
 * Make the app shell shrink when the on-screen keyboard opens, on browsers that
 * do not honour `interactive-widget=resizes-content`.
 *
 * That viewport key is what stops `h-dvh` from keeping its full height while the
 * keyboard covers the bottom of the screen — the chat shell is
 * `overflow-hidden` with the composer as its last flex child, so without it the
 * composer ends up underneath the keyboard. The meta tag in index.html says
 * exactly this.
 *
 * But `interactive-widget` is a Chromium-only viewport key. WebKit does not
 * implement it, so on iOS — the platform whose installed PWA is the product's
 * primary mobile surface — the bug the meta tag exists to fix was still live.
 *
 * `visualViewport` is the cross-browser way to ask how much of the page the user
 * can actually see. Publishing its height as `--app-height` lets the shell use
 * it in place of `100dvh`, in the same measured-CSS-variable style the offline
 * banner already uses for its own height.
 */

/**
 * Below this, a difference is browser chrome retracting rather than a keyboard.
 * A keyboard takes a large fraction of a phone screen; toolbars are tens of px.
 */
const KEYBOARD_THRESHOLD_PX: number = 120;

export function startKeyboardInsetTracking(): () => void {
  const viewport: VisualViewport | null | undefined = typeof window !== 'undefined' ? window.visualViewport : undefined;
  if (!viewport) return () => undefined;

  const root: HTMLElement = document.documentElement;

  const publish = (): void => {
    const hidden: number = window.innerHeight - viewport.height;
    if (hidden > KEYBOARD_THRESHOLD_PX) {
      // `visualViewport.height` excludes the keyboard, which is the number the
      // shell needs. Chromium already resizes the layout viewport, so there the
      // difference stays under the threshold and this never fires — the two
      // mechanisms do not fight.
      root.style.setProperty('--app-height', `${Math.round(viewport.height)}px`);
    } else {
      // Cleared rather than set to a measured full height, so the shell falls
      // back to `100dvh` and keeps handling retractable browser chrome itself.
      root.style.removeProperty('--app-height');
    }
  };

  publish();
  viewport.addEventListener('resize', publish);
  // iOS scrolls the visual viewport rather than resizing it in some states, so
  // height alone can go stale without a resize event.
  viewport.addEventListener('scroll', publish);

  return () => {
    viewport.removeEventListener('resize', publish);
    viewport.removeEventListener('scroll', publish);
    root.style.removeProperty('--app-height');
  };
}
