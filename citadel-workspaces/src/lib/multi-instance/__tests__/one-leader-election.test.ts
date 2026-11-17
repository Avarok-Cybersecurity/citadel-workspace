/**
 * There is one leader election, on one channel.
 *
 * `BroadcastChannelService` carried a complete second apparatus —
 * `becomeLeader()`, `broadcastLeaderClaim()`, a `handleLeaderElection` arm, a
 * `leaderCheckInterval` — on a different channel (`citadel-workspace-sync`),
 * none of it reachable: `becomeLeader` had no caller anywhere, and the claim
 * messages its handler answered were sent by nobody.
 *
 * Dead code that looks load-bearing is worse than dead code that looks dead.
 * That copy had none of the sticky-leadership rules, so reviving it — which its
 * completeness and plausible naming invited — would have reinstated the
 * HMR/StrictMode defect documented in channel-leader-election.ts: a remount
 * hands the WebSocket to the newer tab, the workspace redirects to /connect,
 * and every cross-tab message is dropped.
 *
 * This keeps the second one from growing back.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';
import { stripComments } from '@/test-utils/strip-comments';

const SRC: string = join(process.cwd(), 'src');

/** The one module allowed to decide who leads. */
const ELECTION_HOME: "lib/multi-instance/channel-leader-election.ts" = 'lib/multi-instance/channel-leader-election.ts';

/**
 * DEFINING a decision about who leads — not calling one.
 *
 * Routing a message to the election, or importing `tryBecomeLeader` to ask for
 * leadership, is how the rest of the app participates and must stay allowed;
 * `channel-message-dispatch` and `channel-messaging` both do exactly that.
 * What must not exist twice is the decision itself.
 */
const NAMES: string = String.raw`becomeLeader|tryBecomeLeader|broadcastLeaderClaim|handleLeaderElection`;
const DEFINES_A_DECISION: RegExp = new RegExp(
  // A free function...
  String.raw`(?:export\s+)?(?:async\s+)?function\s+(?:${NAMES})\b` +
    // ...or a class method, which is how the dead copy was written. My first
    // version required the `function` keyword, and the negative control —
    // re-adding `private becomeLeader(): void {` to BroadcastChannelService —
    // passed. A guard that misses the exact shape of the thing it was written
    // for is the shape it was written for.
    // A class method must carry an access modifier or a return type, so a
    // destructured dynamic import -- `.then(({ tryBecomeLeader }) => …)`, which
    // is how channel-messaging asks for leadership -- is not mistaken for one.
    String.raw`|^\s*(?:private|public|protected)\s+(?:async\s+)?(?:${NAMES})\s*\(` +
    String.raw`|^\s*(?:async\s+)?(?:${NAMES})\s*\([^)]*\)\s*:`,
  'm',
);

describe('leader election', () => {
  it('is decided in one module', async () => {
    const files: string[] = await fg(['**/*.ts', '**/*.tsx'], {
      cwd: SRC,
      ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx', 'test-utils/**'],
    });

    const offenders: string[] = files
      .filter((rel) => rel !== ELECTION_HOME)
      .filter((rel) =>
        DEFINES_A_DECISION.test(stripComments(readFileSync(join(SRC, rel), 'utf-8'))),
      );

    expect(
      offenders,
      'this claims or concedes leadership outside channel-leader-election. ' +
        'A second election has none of the sticky rules, and reviving one cost ' +
        'the workspace tab its WebSocket on every HMR reload.',
    ).toEqual([]);
  });

  it('still has an election to be the one', () => {
    // A home that stopped deciding would make the rule above vacuous.
    const source: string = stripComments(readFileSync(join(SRC, ELECTION_HOME), 'utf-8'));
    expect(
      DEFINES_A_DECISION.test(source),
      `${ELECTION_HOME} no longer defines the decision`,
    ).toBe(true);
  });
});
