/**
 * The cached leader client must never outlive its socket.
 *
 * `createWebSocketAsLeader` is idempotent — it returns the cached
 * `leaderClient` when one exists — so that a demoted-then-promoted tab, or one
 * racing its own election, cannot open a second WebSocket while the first is
 * live. That guard is only safe if EVERY teardown path clears the handle.
 *
 * The demotion path did. The disconnect path did not: it stopped message
 * processing, closed the client and reset service state, and left the closed
 * object cached. Every subsequent reconnect then returned the dead client,
 * `init()` resolved against it, and the retry modal reported "Connection
 * restored" over a socket that was gone — recoverable only by a reload, with
 * nothing on screen suggesting one.
 *
 * These tests read the source rather than driving the class, because
 * constructing it requires a live WASM client and a BroadcastChannel. The
 * property under test is structural — "is the handle cleared on this path" —
 * so reading the path is a faithful check, and it fails if either clear is
 * removed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const source: string = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'initialization.ts'),
  'utf8',
);

/**
 * The body of a named method DEFINITION, up to its closing brace.
 *
 * Anchored on the two-space indent and optional modifiers, because a bare
 * `indexOf(name + '(')` finds the first CALL SITE instead — which made the
 * first version of these tests read the wrong text and fail for the wrong
 * reason.
 */
function methodBody(name: string): string {
  const definition: RegExp = new RegExp(`\\n  (?:private |public |protected )?(?:async )?${name}\\(`);
  const match: RegExpExecArray | null = definition.exec(source);
  expect(match, `${name} should be defined`).not.toBeNull();
  const rest: string = source.slice(match!.index);
  const end: number = rest.indexOf('\n  }\n');
  return rest.slice(0, end === -1 ? rest.length : end);
}

describe('the cached leader client is cleared on every teardown path', () => {
  it('is cleared when this tab is demoted', () => {
    expect(methodBody('closeLeaderClient')).toContain('this.leaderClient = null');
  });

  it('is cleared when the socket disconnects', () => {
    // The regression: this path closed the client and left it cached, so the
    // idempotence guard handed the dead one back on every reconnect.
    expect(methodBody('setupDisconnectionHandler')).toContain('this.leaderClient = null');
  });

  it('still guards against opening a second socket', () => {
    // The clear above is only correct while the guard exists — without it the
    // tests above would pass while two sockets could be opened.
    expect(methodBody('createWebSocketAsLeader')).toContain('if (this.leaderClient) return this.leaderClient');
  });
});
