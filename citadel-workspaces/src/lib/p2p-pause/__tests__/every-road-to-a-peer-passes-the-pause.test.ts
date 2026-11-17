/**
 * Every road that carries bytes to a peer passes the pause check first.
 *
 * The outbox (a-paused-contacts-outbound-waits-here) is only a promise if
 * nothing reaches the ILM or the agent's Message request around it. The
 * websocket service is where those roads start, and it cannot be imported under
 * node (its own header explains the cycle), so this pins the wiring by source:
 *
 *  - the service's reliable send goes through `sendOrHold`, its direct sends
 *    through `refuseIfPaused`;
 *  - nothing else calls the operations underneath them; and
 *  - the WASM client's reliable send is called only by the messenger operation
 *    (reached through the service) and by the leader executing a follower's
 *    proxied send -- which the follower's own service already gated.
 *
 * A new caller of any of those, added without the gate, fails here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC: string = join(process.cwd(), 'src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name: string): string[] => {
    const path: string = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function callersOf(pattern: RegExp): string[] {
  return sources(SRC).filter((f: string): boolean => pattern.test(readFileSync(f, 'utf8')))
    .map((f: string): string => relative(SRC, f)).sort();
}

function methodBody(src: string, signature: RegExp): string {
  const start: number = src.search(signature);
  expect(start, `${signature} not found`).toBeGreaterThanOrEqual(0);
  const next: number = src.slice(start + 1).search(/\n {2}(async |\/\*\*|\/\/ =)/);
  return src.slice(start, next < 0 ? undefined : start + 1 + next);
}

describe('the roads to a peer', () => {
  const core: string = readFileSync(join(SRC, 'lib/websocket-service/core.ts'), 'utf8');

  it('the reliable send holds a paused contact’s bytes in the outbox', () => {
    expect(methodBody(core, /async sendP2PMessageReliable\(/)).toMatch(/this\.outbox\.sendOrHold\(/);
  });

  it('both direct sends refuse a paused contact', () => {
    expect(methodBody(core, /async sendP2PMessage\(/)).toMatch(/refuseIfPaused\(/);
    expect(methodBody(core, /async sendP2PMessageBytes\(/)).toMatch(/refuseIfPaused\(/);
  });

  it('nothing else reaches the operations beneath them', () => {
    expect(callersOf(/messengerOps\.sendP2PMessageReliable\(/)).toEqual(['lib/websocket-service/core.ts']);
    expect(callersOf(/p2pOps\.sendP2PMessage(Bytes)?\(/)).toEqual(['lib/websocket-service/core.ts']);
  });

  it('the WASM reliable send has only its two known callers', () => {
    expect(callersOf(/client\??\.sendP2PMessageReliable\(/)).toEqual([
      'lib/multi-instance/leader-proxy-handlers.ts',
      'lib/websocket/messenger-operations.ts',
    ]);
  });
});
