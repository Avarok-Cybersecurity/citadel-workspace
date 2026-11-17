/**
 * The landing page's sessions bar is offset by the banner's published height.
 *
 * Measured live: with "Update available" showing, the fixed banner (0-46px) sat over the
 * chips (7-35px) and elementFromPoint on a chip returned the banner, so no chip, and no
 * disconnect button, could be clicked. jsdom cannot lay out, so the geometry is checked
 * live; this pins the offset the fix depends on.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source: string = readFileSync(join(process.cwd(), 'src/components/OrphanSessionsNavbar.tsx'), 'utf8');

describe('the landing sessions bar', () => {
  it('is placed below the banner stack', () => {
    expect(source).toContain('fixed top-[var(--offline-banner-height,0px)]');
    expect(source).not.toContain('className="fixed top-0 left-0 right-0 z-50');
  });
});
