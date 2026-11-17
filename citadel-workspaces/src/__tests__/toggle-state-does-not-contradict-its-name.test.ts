/**
 * `aria-pressed` carries the state, so the accessible name must not also flip
 * with it. Paired, they contradict each other.
 *
 * The mute button was `aria-label={media.audio ? 'Mute microphone' : 'Unmute
 * microphone'}` with `aria-pressed={media.audio}`. Announced: "Mute
 * microphone, toggle button, pressed" — which a listener reads as *muted*,
 * while the microphone was in fact live. On a privacy control that is the worst
 * possible direction to be wrong in.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';
import { stripComments } from '@/test-utils/strip-comments';

const SRC: string = join(process.cwd(), 'src');

describe('a control with aria-pressed', () => {
  it('does not also flip its accessible name', async () => {
    const files: string[] = await fg(['**/*.tsx'], {
      cwd: SRC,
      ignore: ['**/__tests__/**', '**/*.test.tsx'],
    });

    const offenders: string[] = [];
    for (const rel of files) {
      const source: string = stripComments(readFileSync(join(SRC, rel), 'utf-8'));
      if (!source.includes('aria-pressed')) continue;

      // A conditional expression inside aria-label is the shape: the name is
      // being computed from the same state aria-pressed already announces.
      for (const match of source.matchAll(/aria-label=\{([^}]*)\}/g)) {
        if (match[1].includes('?')) {
          offenders.push(`${rel}: aria-label={${match[1].trim()}} beside aria-pressed`);
        }
      }
    }

    expect(
      offenders,
      'aria-pressed already says whether it is on. A name that flips too makes ' +
        'the two disagree, and the listener believes the name.',
    ).toEqual([]);
  });
});
