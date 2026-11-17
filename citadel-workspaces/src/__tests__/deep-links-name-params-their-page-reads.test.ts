/**
 * A navigation whose query param the destination never reads.
 *
 * The ongoing-call bar sent 1:1 callers to `/messages?peer=<cid>`. The Messages
 * page reads `?channel=`, and nothing anywhere reads `peer` -- so pressing
 * Return during a call landed on "No conversation selected", the call stage
 * never came back, and the floating bar kept offering the same dead button.
 *
 * Wired from one end: the button navigated, the page never listened. Nothing
 * fails, nothing warns, and the only way to notice is to be in a call.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';
import { stripComments } from '@/test-utils/strip-comments';

const SRC: string = join(process.cwd(), 'src');

/** Route path → the file that reads its query params. */
const PAGE_FOR_ROUTE: Record<string, string> = {
  '/messages': 'pages/Messages.tsx',
};

describe('deep links', () => {
  it('only carry query params the destination page reads', async () => {
    const files: string[] = await fg(['**/*.ts', '**/*.tsx'], {
      cwd: SRC,
      ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
    });

    const offenders: string[] = [];
    for (const [route, pageRel] of Object.entries(PAGE_FOR_ROUTE)) {
      const page: string = stripComments(readFileSync(join(SRC, pageRel), 'utf-8'));
      const pattern: RegExp = new RegExp(`${route}\\?([A-Za-z_][A-Za-z0-9_]*)=`, 'g');

      for (const rel of files) {
        if (rel === pageRel) continue;
        const source: string = stripComments(readFileSync(join(SRC, rel), 'utf-8'));
        for (const match of source.matchAll(pattern)) {
          const param: string = match[1];
          if (!page.includes(`get("${param}")`) && !page.includes(`get('${param}')`)) {
            offenders.push(`${rel} links to ${route}?${param}= but ${pageRel} never reads it`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps the route table pointing at real files', () => {
    for (const pageRel of Object.values(PAGE_FOR_ROUTE)) {
      expect(() => readFileSync(join(SRC, pageRel), 'utf-8')).not.toThrow();
    }
  });
});
