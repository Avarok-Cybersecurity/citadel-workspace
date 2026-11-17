/**
 * There is ONE WebSocket per browser. The leader tab owns the WASM client;
 * every follower has `client = null` by design and proxies through the leader.
 *
 * So `websocketService.getClient()` — and `isConnected()`, which is defined in
 * terms of it — answers "does THIS tab own a client", and is false in every
 * follower for ever. Gating an action on it disables that action in every tab
 * but one, permanently, with no error the user can see.
 *
 * This has now been the bug four separate times: `fetchActiveSessions` returned
 * `[]` without sending, so a second tab showed no sessions; the health probe
 * pinned a red "Can't reach the Citadel agent" banner in every follower; all six
 * group operations threw, and answering an invitation threw into a catch that
 * only debugLogs — the invitee saw the group while the server never recorded
 * their membership; and peer-registration persistence RESOLVED SUCCESSFULLY
 * without writing, so an incoming contact request vanished on reload.
 *
 * A file that reaches for the raw client either does so on a leader-only path
 * and says so here, or it should be using `sendMessage` / `canSendRequests`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';
import { stripComments } from '@/test-utils/strip-comments';

const SRC: string = join(process.cwd(), 'src');

/**
 * Files allowed to reach for the raw client, and how that is enforced.
 *
 * `why` alone was not enough. Three entries said "guarded by
 * instanceManager.isLeader; followers proxy" and nothing checked that the guard
 * was there — delete the isLeader branch from workspace-operations.ts and this
 * suite stayed green, which is the fourth recurrence of the exact bug it
 * documents. And one of the three was simply wrong: session-management.ts has
 * no isLeader anywhere; it returns silently when there is no client, which is
 * a follower no-op, not a proxy.
 *
 * `requires` is the machine-checkable half. An exemption that claims a guard
 * has to name a pattern that guard leaves in the file.
 */
const LEADER_ONLY: Record<string, { why: string; requires?: RegExp }> = {
  'lib/websocket-service/core.ts': {
    why: 'defines getClient/isConnected/canSendRequests',
  },
  'lib/websocket/messenger-operations.ts': {
    why: 'guarded by instanceManager.isLeader; followers proxy',
    requires: /instanceManager\.isLeader/,
  },
  'lib/websocket/session-management.ts': {
    why: 'returns silently without a client, so a follower no-ops rather than throwing',
    requires: /Cannot release session|if \(!client\)/,
  },
  'lib/websocket/workspace-operations.ts': {
    why: 'guarded by instanceManager.isLeader; followers proxy',
    requires: /instanceManager\.isLeader/,
  },
  'lib/multi-instance/leader-proxy-handlers.ts': {
    why: 'runs on the leader by definition',
  },
  'lib/call/websocket-call-transport.ts': {
    why: "only the leader's own frames; a follower relays them to the leader (media-frame-relay.ts)",
    requires: /instanceManager\.isLeader/,
  },
  'lib/websocket-service/index.ts': {
    why: "hands the leader's socket to relayed media frames, sent only while this tab leads",
    requires: /installMediaFrameRelay\(\{[\s\S]*?isLeader: \(\): boolean => instanceManager\.isLeader,\s*sink:/,
  },
  'lib/p2p/send-peer-registration.ts': {
    why: 'resendPeerRegistration is only reachable from the leader-gated resend poll (peer-registration-store/service.ts)',
  },
};

async function sourceFiles(): Promise<string[]> {
  return fg(['**/*.ts', '**/*.tsx'], {
    cwd: SRC,
    ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
  });
}

describe('follower tabs', () => {
  it('are not locked out by code reaching for a client only the leader owns', async () => {
    const offenders: string[] = [];
    for (const rel of await sourceFiles()) {
      if (rel in LEADER_ONLY) continue;
      const source: string = stripComments(readFileSync(join(SRC, rel), 'utf-8'));
      if (/\bgetClient\(\)/.test(source)) offenders.push(rel);
    }

    expect(
      offenders,
      'these reach for the raw WASM client, which is null in every follower tab. ' +
        'Use websocketService.sendMessage (it proxies), or add the file to ' +
        'LEADER_ONLY with the reason its path only ever runs on the leader.',
    ).toEqual([]);
  });

  it('keeps every leader-only exemption real', async () => {
    for (const [rel, { why, requires }] of Object.entries(LEADER_ONLY)) {
      const source: string = stripComments(readFileSync(join(SRC, rel), 'utf-8'));

      expect(
        /\bgetClient\b/.test(source),
        `${rel} is exempted but no longer reaches for the client — drop the ` +
          `exemption rather than letting it shield a future one`,
      ).toBe(true);

      // The exemption's REASON, checked. Without this the entry is a claim,
      // and a claim survives the removal of the thing it claims.
      if (requires) {
        expect(
          requires.test(source),
          `${rel} is exempted because "${why}", but ${requires} no longer ` +
            `appears in it. Either the guard was removed — in which case ` +
            `follower tabs are now reaching for a null client — or the reason ` +
            `is stale and the exemption should say what actually protects it.`,
        ).toBe(true);
      }
    }
  });

  it('does not gate sending on isConnected, which asks the wrong question', async () => {
    // `isConnected` is legitimate for "is a client present" — several UI paths
    // ask about P2P peer connectivity, which is unrelated. What it must never
    // do is decide whether this tab may SEND.
    const offenders: string[] = [];
    for (const rel of await sourceFiles()) {
      const source: string = stripComments(readFileSync(join(SRC, rel), 'utf-8'));
      if (!/websocketService\.isConnected\(\)/.test(source)) continue;
      if (/sendMessage|sendRequest|sendDirectToInternalService/.test(source)) {
        offenders.push(rel);
      }
    }

    expect(
      offenders,
      'a file that both consults websocketService.isConnected() and sends ' +
        'requests is very likely gating the send on it; canSendRequests is the ' +
        'question that accounts for follower tabs.',
    ).toEqual([]);
  });
});
