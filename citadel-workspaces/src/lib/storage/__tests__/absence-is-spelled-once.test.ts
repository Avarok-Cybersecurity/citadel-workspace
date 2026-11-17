/**
 * "Key not found" is spelled in exactly one place.
 *
 * The predicate that tells a missing key from a broken read was written once,
 * with a comment explaining that getting it wrong destroys a conversation. The
 * same string test was then spelled out by hand three more times -- and NOT at
 * all in `server-auto-connect-service`, which is the one place where getting it
 * wrong silently re-enables a preference the user turned off.
 *
 * A predicate that four files re-derive is a predicate one file will get wrong.
 * This refuses a fifth copy.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';
import { stripComments } from '@/test-utils/strip-comments';
import { isGenuinelyAbsent } from '../absence';

const SRC: string = join(process.cwd(), 'src');
const HOME: string = 'lib/storage/absence.ts';

describe('the absent-key predicate', () => {
  it('recognises both spellings the service uses, and nothing else', () => {
    expect(isGenuinelyAbsent(new Error('Key not found'))).toBe(true);
    expect(isGenuinelyAbsent(new Error('No keys found'))).toBe(true);
    expect(isGenuinelyAbsent('Key not found')).toBe(true);

    // The whole point: a failed read is not an absent key.
    expect(isGenuinelyAbsent(new Error('Request timed out after 5000ms'))).toBe(false);
    expect(isGenuinelyAbsent(new Error('WebSocket is not connected'))).toBe(false);
    expect(isGenuinelyAbsent(undefined)).toBe(false);
  });

  it('is not re-derived anywhere else', async () => {
    const files: string[] = await fg(['**/*.ts', '**/*.tsx'], {
      cwd: SRC,
      ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx', 'test-utils/**'],
    });

    const offenders: string[] = [];
    for (const rel of files) {
      if (rel === HOME) continue;
      const source: string = stripComments(readFileSync(join(SRC, rel), 'utf-8'));
      if (source.includes("'Key not found'") || source.includes('"Key not found"')) {
        offenders.push(rel);
      }
    }

    expect(
      offenders,
      'import isGenuinelyAbsent from lib/storage/absence instead of testing the ' +
        'message again -- the copy that gets it wrong is the one nobody notices.',
    ).toEqual([]);
  });
});
