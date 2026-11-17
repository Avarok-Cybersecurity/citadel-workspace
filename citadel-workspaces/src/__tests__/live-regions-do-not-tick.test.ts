/**
 * A polite live region re-announces on every content change. Anything that
 * changes on a timer inside one makes the rest of the app unusable to a screen
 * reader for as long as it keeps changing.
 *
 * The ongoing-call bar put `role="status" aria-live="polite"` on its container
 * and rendered the call duration inside it, re-rendered once a second. A
 * screen-reader user working anywhere else in the app heard "In call with Ana
 * 00:41, 00:42, 00:43" for the entire call — exactly while the mic was hot.
 *
 * `CallControls` hides its copy of the same value with a comment saying why.
 * The fix stopped there. This scan is what makes it not stop there again.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';
import { stripComments } from '@/test-utils/strip-comments';

const SRC: string = join(process.cwd(), 'src');

/**
 * Values that change on a timer rather than in response to the user. A live
 * region may hold them only if they are hidden from assistive technology.
 */
const TICKING: string[] = ['{duration}', '{countdown}', '{elapsed}'];

describe('live regions', () => {
  it('do not contain a value that changes on a timer', async () => {
    const files: string[] = await fg(['**/*.tsx'], {
      cwd: SRC,
      ignore: ['**/__tests__/**', '**/*.test.tsx'],
    });

    const offenders: string[] = [];
    for (const rel of files) {
      const source: string = stripComments(readFileSync(join(SRC, rel), 'utf-8'));
      if (!/aria-live=|role="status"|role="alert"/.test(source)) continue;

      for (const ticking of TICKING) {
        if (!source.includes(ticking)) continue;
        // The value has to be inside an element that hides it. Checked by
        // proximity rather than by parsing: the hidden marker must appear
        // within the same element as the interpolation.
        const at: number = source.indexOf(ticking);
        const before: string = source.slice(0, at);
        const marker: number = Math.max(
          before.lastIndexOf('aria-live='),
          before.lastIndexOf('role="status"'),
          before.lastIndexOf('role="alert"'),
        );
        if (marker === -1) continue;

        // Everything between the live-region attribute and the value. A closing
        // tag in there means the value is a SIBLING of the region, not inside
        // it — which is the case in ConnectionRetryModal, whose countdown sits
        // after the status div closes. Without this the scan reported correct
        // code as a defect, and a scan that cries wolf gets relaxed until it
        // catches nothing.
        const between: string = source.slice(marker, at);
        const escapedTheRegion: boolean = /<\/(div|span|p)>/.test(between);
        if (escapedTheRegion) continue;

        // The aria-hidden has to be on the element that DIRECTLY wraps the
        // value, not merely somewhere in the region. Checking the whole region
        // let the decorative icon's own aria-hidden satisfy the scan — and the
        // control proved it: removing the duration's hidden marker still
        // passed. A guard that its own negative control cannot fail is not a
        // guard.
        const enclosingTagEnd: number = between.lastIndexOf('>');
        const enclosingTagStart: number = between.lastIndexOf('<', enclosingTagEnd);
        const enclosingTag: string =
          enclosingTagStart === -1 ? '' : between.slice(enclosingTagStart, enclosingTagEnd);

        if (!enclosingTag.includes('aria-hidden')) {
          offenders.push(`${rel}: ${ticking} inside a live region, not aria-hidden`);
        }
      }
    }

    expect(
      offenders,
      'a live region that re-announces every second takes the whole app away ' +
        'from a screen-reader user for as long as it is on screen',
    ).toEqual([]);
  });
});
