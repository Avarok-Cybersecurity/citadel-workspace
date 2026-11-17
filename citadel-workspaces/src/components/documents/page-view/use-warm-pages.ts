/**
 * The column's mounted pages (warm-pages.ts decides which): those near the view at once, the
 * rest of the warm window one idle tick at a time, and none repainted for being scrolled past.
 */
import { useEffect, useMemo, useState } from 'react';
import { visiblePages, type PageLayout } from './page-layout';
import { aheadPages, keptPages, type PaintAhead } from './warm-pages';

/** Pages beyond the visible ones, each side, that mount at once rather than when idle. */
const NEAR_PAGES: number = 1;

export interface WarmPages {
  /** The pages to mount, ascending. */
  readonly pages: readonly number[];
  /** The pages any part of which is on screen: painted first. */
  readonly visible: ReadonlySet<number>;
}

const NONE: WarmPages = { pages: [], visible: new Set<number>() };

export function useWarmPages(layout: PageLayout | null, top: number, height: number, ahead: PaintAhead): WarmPages {
  const [mounted, setMounted] = useState<ReadonlySet<number>>(new Set<number>());
  const visible: number[] = layout === null ? [] : visiblePages(layout, top, height, 0);
  const near: number[] = layout === null ? [] : visiblePages(layout, top, height, NEAR_PAGES);
  const warm: number[] = layout === null ? [] : visiblePages(layout, top, height, ahead.warmPages);
  const kept: number[] = keptPages(near, warm, mounted);
  const keptKey: string = kept.join(',');
  const warmKey: string = warm.join(',');
  const center: number = visible[0] ?? 0;
  const { idle, mountsPerTick } = ahead;

  useEffect((): (() => void) | undefined => {
    const now: number[] = keptKey === '' ? [] : keptKey.split(',').map(Number);
    const sameAsMounted: boolean = now.length === mounted.size && now.every((p: number): boolean => mounted.has(p));
    if (!sameAsMounted) {
      setMounted(new Set<number>(now));
      return undefined;
    }
    const inWarm: number[] = warmKey === '' ? [] : warmKey.split(',').map(Number);
    if (!aheadPages(now, inWarm, center, 0).more) return undefined;
    return idle((): void => setMounted(new Set<number>(aheadPages(now, inWarm, center, mountsPerTick).pages)));
  }, [keptKey, warmKey, center, mounted, idle, mountsPerTick]);

  const visibleKey: string = visible.join(',');
  const visibleSet: ReadonlySet<number> = useMemo(
    (): ReadonlySet<number> => new Set<number>(visibleKey === '' ? [] : visibleKey.split(',').map(Number)),
    [visibleKey],
  );
  const pages: readonly number[] = useMemo((): readonly number[] => (keptKey === '' ? [] : keptKey.split(',').map(Number)), [keptKey]);
  return layout === null ? NONE : { pages, visible: visibleSet };
}
