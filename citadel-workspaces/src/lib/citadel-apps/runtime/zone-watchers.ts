/**
 * What a mounted zone watches on the page, as the runtime is given it (SBIO): the zone entering
 * and leaving view (IntersectionObserver), the page's visibility (visibilitychange), the size of
 * its host (ResizeObserver), and the page being kept for back/forward or going away (pagehide,
 * pageshow). Each returns its stop. pageZoneWatchers binds them to a real document.
 */
import type { PlacedSize } from './placement';

/** `kept`: pagehide, persisted; `leaving`: pagehide, not persisted (closed or reloaded); `shown`: pageshow. */
export type PageLife = 'kept' | 'leaving' | 'shown';

export interface ZoneWatchers {
  readonly inView: (host: HTMLElement, listener: (inView: boolean) => void) => () => void;
  readonly pageVisible: (listener: (visible: boolean) => void) => () => void;
  /** The host's width and height in CSS px, on every change. */
  readonly size: (host: HTMLElement, listener: (size: PlacedSize) => void) => () => void;
  readonly pageLife: (listener: (life: PageLife) => void) => () => void;
}

export const pageZoneWatchers: ZoneWatchers = {
  inView: (host: HTMLElement, listener: (inView: boolean) => void): (() => void) => {
    const observer: IntersectionObserver = new IntersectionObserver((entries: IntersectionObserverEntry[]): void => {
      const last: IntersectionObserverEntry | undefined = entries[entries.length - 1];
      if (last !== undefined) listener(last.isIntersecting);
    });
    observer.observe(host);
    return (): void => observer.disconnect();
  },
  pageVisible: (listener: (visible: boolean) => void): (() => void) => {
    const changed = (): void => listener(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', changed);
    changed();
    return (): void => document.removeEventListener('visibilitychange', changed);
  },
  size: (host: HTMLElement, listener: (size: PlacedSize) => void): (() => void) => {
    const observer: ResizeObserver = new ResizeObserver((entries: ResizeObserverEntry[]): void => {
      const last: ResizeObserverEntry | undefined = entries[entries.length - 1];
      if (last !== undefined) listener({ width: last.contentRect.width, height: last.contentRect.height });
    });
    observer.observe(host);
    return (): void => observer.disconnect();
  },
  pageLife: (listener: (life: PageLife) => void): (() => void) => {
    const hidden = (e: PageTransitionEvent): void => listener(e.persisted ? 'kept' : 'leaving');
    const shown = (): void => listener('shown');
    window.addEventListener('pagehide', hidden);
    window.addEventListener('pageshow', shown);
    return (): void => {
      window.removeEventListener('pagehide', hidden);
      window.removeEventListener('pageshow', shown);
    };
  },
};
