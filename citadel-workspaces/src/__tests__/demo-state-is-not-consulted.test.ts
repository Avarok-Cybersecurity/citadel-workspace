/**
 * Nothing real may consult the demo simulator's store.
 *
 * `lib/connection-service` mixes one live duty — connection-status fan-out —
 * with a simulated P2P pipeline: handlers that fabricate responses on a
 * `setTimeout`, a module that raises fake notifications, and a connection map
 * keyed on the literal `'current-user'`. The only writer of that map is
 * `acceptConnectionRequest`, which nothing outside the demo calls.
 *
 * So every read of it answers the same thing forever, and the reads looked
 * like real service calls. Two shipped: the green dot in user search (which
 * had previously been `Math.random()`, so the "fix" swapped a random lie for a
 * constant one), and a send gate that could never pass, sitting in front of a
 * method with no callers, waiting for someone to wire it up.
 *
 * Presence and connectivity both have real sources — the polled peer registry.
 * This keeps the demo store from being mistaken for one again.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';
import { stripComments } from '@/test-utils/strip-comments';

const SRC: string = join(process.cwd(), 'src');

/** Reads that only the demo simulator can answer truthfully. */
const DEMO_ONLY: RegExp = /\b(canMessageUser|simulateRequestReceived|autoAcceptConnection|DEMO_PEERS)\b/;

describe('the demo simulation store', () => {
  it('is not consulted outside its own module', async () => {
    const files: string[] = await fg(['**/*.ts', '**/*.tsx'], {
      cwd: SRC,
      ignore: [
        '**/__tests__/**',
        '**/*.test.ts',
        '**/*.test.tsx',
        'test-utils/**',
        // Its own module may name its own functions.
        'lib/connection-service/**',
      ],
    });

    const offenders: string[] = files.filter((rel) =>
      DEMO_ONLY.test(stripComments(readFileSync(join(SRC, rel), 'utf-8'))),
    );

    expect(
      offenders,
      'this reads a store only the demo simulation writes, so it answers the ' +
        'same thing for everyone forever. Presence comes from lib/presence; ' +
        'connectivity from p2pAutoConnectService.',
    ).toEqual([]);
  });
});
