// Test setup file
import '@testing-library/jest-dom';

/**
 * jsdom does not implement matchMedia.
 *
 * Anything using useIsMobile — the sidebar, the responsive layout shells —
 * throws "window.matchMedia is not a function" on render without this. Shimmed
 * in the environment rather than mocked per component, because it is a gap in
 * jsdom rather than something about our code, and stubbing it inside a test
 * would mean testing a component with its responsive behaviour removed.
 *
 * Reports "not matching", i.e. the desktop branch of every query. A test that
 * cares about the mobile branch should override this for itself, so that
 * intent is visible in the test rather than assumed from a default here.
 */
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

/**
 * jsdom does not implement the Pointer Capture API.
 *
 * Anything that drags calls `setPointerCapture` on pointerdown — Sonner's
 * swipe-to-dismiss, and the theme editor's colour wheel. Without these, a plain
 * click on a toast action throws inside an event listener, which vitest reports
 * as an unhandled error and explicitly warns can cause false positives: the test
 * still passes while an exception escapes mid-interaction.
 *
 * No-ops rather than a real implementation. Capture only affects where
 * subsequent pointer events are routed, and jsdom dispatches directly to the
 * target anyway, so nothing under test depends on the behaviour — only on the
 * methods existing.
 */
if (typeof Element !== 'undefined' && !Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = function setPointerCapture(): void {};
  Element.prototype.releasePointerCapture = function releasePointerCapture(): void {};
  Element.prototype.hasPointerCapture = function hasPointerCapture(): false {
    return false;
  };
}

// jsdom implements neither ResizeObserver nor layout, so a component that
// measures itself throws on import rather than failing an assertion — which
// reads as "the component is broken" rather than "the environment lacks an
// API". Elements report 0 height here, so anything asserting on the measured
// value must set offsetHeight explicitly rather than trusting this.
if (!('ResizeObserver' in globalThis)) {
  class TestResizeObserver implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = TestResizeObserver;
}
