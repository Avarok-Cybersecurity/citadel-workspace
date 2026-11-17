/**
 * There is one place that claims a session, and it checks for another tab.
 *
 * "Not orphaned" from the agent means somebody has this session, and that
 * somebody may be another tab in this browser. Adopting it anyway lets two tabs
 * register the same CID, after which `findInstanceByCid` returns the first map
 * hit and every CID-routed notification — messages, transfer ticks, call media
 * — goes to one tab while the other renders the same conversation and silently
 * never updates.
 *
 * Round 153 fixed that in the auto-claim path. It reached one site of FOUR: the
 * workspace switcher, the orphan-sessions navbar and the post-login redirect
 * all still swallowed the refusal and adopted, so the defect stayed reachable
 * through three unfixed doors. This is that lesson made mechanical.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';
import { stripComments } from '@/test-utils/strip-comments';

const SRC: string = join(process.cwd(), 'src');

/** The one module allowed to call the transport's claim directly. */
const CLAIM_HOME: "lib/sessions/claim-session.ts" = 'lib/sessions/claim-session.ts';

/**
 * Calls that are not a tab adopting a session, and why.
 *
 * The distinction that matters is `onlyIfOrphaned`: a claim that passes `true`
 * is asking "may I take this?", which is the question another tab can already
 * have answered. The entries below are not asking that.
 */
const NOT_A_TAB_ADOPTING: Record<string, string> = {
  'lib/connection/io-websocket.ts':
    'the IO router forwarding a claim intent; it is the transport, not a caller',
  'lib/peer-registration-store/lifecycle.ts':
    're-asserts ownership of a session this tab already holds before sending ' +
    'PeerRegister; passes no onlyIfOrphaned, so it is not adopting anything',
  'lib/p2p/send-peer-registration.ts':
    're-asserts ownership of the session that recorded a PeerRegister before ' +
    'the leader resends it; passes no onlyIfOrphaned, so it is not adopting anything',
  'components/WorkspaceApp.tsx':
    'the connection-retry modal reclaiming the session this tab just lost — ' +
    'the CID came from this tab losing it, so no other tab can own it',
};

describe('claiming a session', () => {
  it('goes through the one place that checks for another tab', async () => {
    const files: string[] = await fg(['**/*.ts', '**/*.tsx'], {
      cwd: SRC,
      ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx', 'test-utils/**'],
    });

    const offenders: string[] = files
      .filter((rel) => rel !== CLAIM_HOME && !(rel in NOT_A_TAB_ADOPTING))
      // websocket-service defines it; calling it from anywhere else is the fork.
      .filter((rel) => !rel.startsWith('lib/websocket'))
      .filter((rel) =>
        /websocketService\.claimSession\s*\(/.test(
          stripComments(readFileSync(join(SRC, rel), 'utf-8')),
        ),
      );

    expect(
      offenders,
      'this claims a session without checking whether another tab in this ' +
        'browser already owns it. Use claimSessionForThisTab, which returns ' +
        "'owned-by-another-tab' instead of adopting.",
    ).toEqual([]);
  });

  it('nobody re-implements the not-orphaned check', async () => {
    // The substring match on the agent's refusal is the tell: four copies of it
    // is how three came to differ.
    const files: string[] = await fg(['**/*.ts', '**/*.tsx'], {
      cwd: SRC,
      ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx', 'test-utils/**'],
    });

    const offenders: string[] = files
      .filter((rel) => rel !== CLAIM_HOME)
      .filter((rel) =>
        /['"]not orphaned['"]/.test(stripComments(readFileSync(join(SRC, rel), 'utf-8'))),
      );

    expect(offenders, 'the not-orphaned refusal is interpreted in one place').toEqual([]);
  });

  it('keeps every exemption honest', async () => {
    for (const rel of Object.keys(NOT_A_TAB_ADOPTING)) {
      const source: string = stripComments(readFileSync(join(SRC, rel), 'utf-8'));
      expect(
        /websocketService\.claimSession\s*\(/.test(source),
        `${rel} is exempted but no longer claims — drop the exemption rather ` +
          `than letting it shield a future one`,
      ).toBe(true);
    }
  });

  it('keeps the one place real', () => {
    const source: string = stripComments(readFileSync(join(SRC, CLAIM_HOME), 'utf-8'));
    expect(source).toMatch(/websocketService\.claimSession\s*\(/);
    expect(
      source,
      'the whole point is that it consults the instance registry',
    ).toMatch(/findInstanceByCid/);
  });
});
