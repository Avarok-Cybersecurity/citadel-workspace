/**
 * The promotion/demotion listener lived inside `initializeAsFollower`, so a tab
 * that BOOTED as leader never registered it. `closeLeaderClient` has no other
 * caller, so on demotion that tab kept a live socket whose handler discarded
 * every inbound frame: the browser held two sockets, the sessions on the old one
 * went permanently deaf, and the tab proxied new requests to a leader that had
 * never seen them.
 *
 * Asserted from source because the class under test opens a real WebSocket in
 * its leader path; the discriminating property is WHERE the call sits, which
 * source can answer exactly. Comments are stripped first.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const initService: string = strip(
  readFileSync(join(process.cwd(), 'src/lib/websocket-service/initialization.ts'), 'utf8'),
);
const initOps: string = strip(
  readFileSync(join(process.cwd(), 'src/lib/websocket/initialization.ts'), 'utf8'),
);

describe('the leadership listener', () => {
  it('exists as its own method rather than a follower-only side effect', () => {
    expect(initOps).toContain('registerLeadershipListener()');
    expect(initOps).toMatch(/leadershipListenerRegistered/);
  });

  it('is registered BEFORE the leader/follower branch', () => {
    const call: number = initService.indexOf('registerLeadershipListener()');
    const branch: number = initService.indexOf('if (!isLeader)');

    expect(call, 'doInit never registers the leadership listener').toBeGreaterThan(-1);
    expect(branch).toBeGreaterThan(-1);
    expect(
      call,
      'the listener is registered inside or after the leader/follower branch, so a ' +
        'tab that boots as leader is never wired for demotion',
    ).toBeLessThan(branch);
  });

  it('still closes the socket on demotion', () => {
    const method: string = initOps.slice(initOps.indexOf('registerLeadershipListener()'));
    const body: string = method.slice(0, method.indexOf('\n  initializeAsFollower'));
    expect(body).toContain('closeLeaderClient');
  });
});
