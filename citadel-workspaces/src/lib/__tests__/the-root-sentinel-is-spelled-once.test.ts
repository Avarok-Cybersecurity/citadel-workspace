/**
 * `workspace-root` is written once on each side, and the two sides agree.
 *
 * `workspace-constants.ts` says exactly why it exists:
 *
 *   It was written as a bare 'workspace-root' literal in several components,
 *   which is exactly the kind of duplication that survives a rename on the Rust
 *   side without anything failing to compile.
 *
 * The constant was added and the call sites were never converted. Six of them
 * were still bare literals — including the permission cache's hierarchy
 * fallback, which is what every inherited grant in the app resolves through.
 *
 * Two things are checked here, and they are different:
 *
 *  - nobody re-spells the literal, so a rename has one place to change;
 *  - the constant still equals the Rust sentinel, so that one place is right.
 *
 * The second is the one that matters. A single spelling that has drifted from
 * the server is a single spelling of the wrong thing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import fg from 'fast-glob';
import { stripComments } from '@/test-utils/strip-comments';
import { WORKSPACE_ROOT_ID } from '../workspace-constants';

const SRC: string = join(process.cwd(), 'src');
const HOME: string = 'lib/workspace-constants.ts';
// Moved from the kernel's lib.rs, which re-exports it, when the messaging trust policy needed it in the types.
const KERNEL: string = resolve(process.cwd(), '..', 'citadel-workspace-types', 'src', 'lib.rs');

describe('the workspace root sentinel', () => {
  it('matches the Rust constant it mirrors', () => {
    const rust: string = readFileSync(KERNEL, 'utf-8');
    const declared: RegExpMatchArray | null = rust.match(
      /pub const WORKSPACE_ROOT_ID:\s*&str\s*=\s*"([^"]+)"/,
    );

    expect(
      declared,
      'citadel-workspace-types/src/lib.rs no longer declares WORKSPACE_ROOT_ID ' +
        'the way this check reads it — find where it moved rather than deleting this.',
    ).not.toBeNull();
    expect(declared?.[1]).toBe(WORKSPACE_ROOT_ID);
  });

  it('is not re-spelled anywhere else', async () => {
    const files: string[] = await fg(['**/*.ts', '**/*.tsx'], {
      cwd: SRC,
      ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
    });

    const offenders: string[] = [];
    for (const rel of files) {
      if (rel === HOME) continue;
      const source: string = stripComments(readFileSync(join(SRC, rel), 'utf-8'));
      if (source.includes(`'${WORKSPACE_ROOT_ID}'`) || source.includes(`"${WORKSPACE_ROOT_ID}"`)) {
        offenders.push(rel);
      }
    }

    expect(
      offenders,
      'import WORKSPACE_ROOT_ID from lib/workspace-constants — a bare literal ' +
        'survives a rename on the Rust side without anything failing to compile.',
    ).toEqual([]);
  });
});
