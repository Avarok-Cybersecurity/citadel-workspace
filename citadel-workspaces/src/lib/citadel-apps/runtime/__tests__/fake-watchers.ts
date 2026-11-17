/**
 * TEST HELPER: the page observers a zone watches (zone-watchers.ts), driven by the test. jsdom lays
 * nothing out and has no IntersectionObserver or ResizeObserver, so these stand in for the browser's
 * observers only; what the runtime does with each observation is production code. check:app-zone
 * runs the real observers in a browser.
 */
import type { PlacedSize } from '../placement';
import type { PageLife, ZoneWatchers } from '../zone-watchers';

export interface FakeWatchers extends ZoneWatchers {
  readonly scroll: (inView: boolean) => void;
  readonly tab: (visible: boolean) => void;
  readonly resizeTo: (size: PlacedSize) => void;
  readonly page: (life: PageLife) => void;
  /** Listeners still attached, across all four kinds. */
  readonly attached: () => number;
}

export function fakeWatchers(): FakeWatchers {
  const inView: Set<(v: boolean) => void> = new Set<(v: boolean) => void>();
  const visible: Set<(v: boolean) => void> = new Set<(v: boolean) => void>();
  const sizes: Set<(s: PlacedSize) => void> = new Set<(s: PlacedSize) => void>();
  const life: Set<(l: PageLife) => void> = new Set<(l: PageLife) => void>();
  const add = <T>(set: Set<T>, listener: T): (() => void) => {
    set.add(listener);
    return (): void => { set.delete(listener); };
  };
  return {
    inView: (_host: HTMLElement, l: (v: boolean) => void) => add(inView, l),
    pageVisible: (l: (v: boolean) => void) => add(visible, l),
    size: (_host: HTMLElement, l: (s: PlacedSize) => void) => add(sizes, l),
    pageLife: (l: (p: PageLife) => void) => add(life, l),
    scroll: (v: boolean): void => { for (const l of [...inView]) l(v); },
    tab: (v: boolean): void => { for (const l of [...visible]) l(v); },
    resizeTo: (s: PlacedSize): void => { for (const l of [...sizes]) l(s); },
    page: (p: PageLife): void => { for (const l of [...life]) l(p); },
    attached: (): number => inView.size + visible.size + sizes.size + life.size,
  };
}
