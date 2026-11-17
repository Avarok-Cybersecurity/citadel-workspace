/**
 * The offline banner must outrank the surfaces that appear BECAUSE you are
 * offline, and must not overlap the content beneath it.
 *
 * At z-40 it sat under every one of them: the opaque z-50 workspace loader, the
 * z-[100] LoadingModal and the four z-50 auth modals. So an offline launch
 * showed a full-screen "Loading workspace..." with the one explanation of why
 * painted over by the thing that was not loading.
 *
 * It is also `fixed`, so it takes no space — and its offset lands exactly where
 * the h-14 header ends and `pt-14` content begins, covering the first ~36px of
 * both the sidebar and the content pane.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (p: string): string => readFileSync(join(process.cwd(), 'src', p), 'utf8');

/** The numeric z-index a Tailwind class encodes, e.g. z-40 or z-[110]. */
function zIndex(className: string): number {
  const bracketed: RegExpMatchArray | null = className.match(/z-\[(\d+)\]/);
  if (bracketed) return Number(bracketed[1]);
  const plain: RegExpMatchArray | null = className.match(/z-(\d+)/);
  return plain ? Number(plain[1]) : 0;
}

const banner: string = src('components/pwa/OfflineBanner.tsx');
// Matched on `fixed inset-x-0`, not on the offset. The offset is now
// `top-[var(--app-header-height,0px)]` so the banner sits below the header where
// there is one and at the top of the header-less landing page — and pinning this
// regex to `top-14` meant a correct change to the offset silently zeroed the
// z-index it extracts, which is the failure mode this whole file guards against.
const bannerZ: number = zIndex(banner.match(/'fixed inset-x-0 [^']*'/)?.[0] ?? '');

describe('offline banner layering', () => {
  it('outranks the opaque workspace loader', () => {
    const loader: string = src('components/ui/workspace-loader-ui.tsx');
    const loaderZ: number = zIndex(loader.match(/fixed inset-0[^"]*/)?.[0] ?? '');

    expect(loaderZ).toBeGreaterThan(0);
    expect(bannerZ).toBeGreaterThan(loaderZ);
  });

  it('outranks the blocking LoadingModal', () => {
    const modal: string = src('components/LoadingModal.tsx');
    const modalZ: number = zIndex(modal.match(/fixed inset-0 z-\[?\d+\]?/)?.[0] ?? '');

    expect(modalZ).toBeGreaterThan(0);
    expect(bannerZ).toBeGreaterThan(modalZ);
  });

  it('stays below the header rather than covering its controls', () => {
    // The reason it was demoted in the first place: at top-0 it swallowed the
    // sidebar toggle, workspace switcher, notifications and account menu. top-14
    // is what makes a high z-index safe.
    expect(banner).toContain('top-14');
  });

  it('publishes its height, and the layout reserves it', () => {
    expect(banner).toContain('--offline-banner-height');

    // Both panes: the banner spans the full width, so the sidebar is covered too.
    const layout: string = src('components/layout/AppLayout.tsx');
    const reserving: [] | RegExpMatchArray = layout.match(/pt-\[calc\(3\.5rem\+var\(--offline-banner-height[^\]]*\]/g) ?? [];
    expect(reserving.length).toBe(2);
  });
});

describe('the extracted z-index is real', () => {
  it('found a z-index at all', () => {
    // Without this, a change to the banner's class string that stops the regex
    // matching turns every comparison above into `0 > n` — which fails, loudly,
    // but for the wrong reason. This says which.
    expect(bannerZ).toBeGreaterThan(0);
  });
});
