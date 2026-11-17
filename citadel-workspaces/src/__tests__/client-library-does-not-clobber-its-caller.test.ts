/**
 * Two defects in `citadel-workspace-client-ts` that fire in the one code path
 * this app actually uses.
 *
 * `WorkspaceSessionManager`'s constructor called `client.setErrorHandler(...)`,
 * which overwrites the single handler slot — so the `errorHandler` this app
 * passes in its config (`lib/websocket/initialization.ts`) was silently
 * discarded before the first error ever arrived. And the reconnect it installed
 * in place of it was a stub: it logged "Reconnection would require stored
 * credentials" and then CLEARED the workspace session, on the success path,
 * unconditionally. So any WASM-layer error — including a routine
 * message-processing error — threw the user out of their workspace, while the
 * base client had a real `restart_ws_connection` it never called.
 *
 * Asserted against the library's source. That package has no test harness of its
 * own, and adding one is a larger change than these two fixes; a source guard
 * cannot prove the behaviour is right, but it does prevent this exact pair
 * coming back, and it says which line to look at when it fails.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/test-utils/strip-comments';

const LIB: string = join(process.cwd(), '..', 'citadel-workspace-client-ts', 'src');
const CLIENT: string = join(
  process.cwd(),
  '..',
  'citadel-internal-service',
  'typescript-client',
  'src',
);

const read = (base: string, file: string): string =>
  stripComments(readFileSync(join(base, file), 'utf8'));

describe('the session manager does not displace the caller', () => {
  const session: string = read(LIB, 'session.ts');

  it('was found, so the assertions below are about something', () => {
    expect(session).toContain('setupErrorHandling');
  });

  it('subscribes rather than taking the single handler slot', () => {
    expect(session).not.toContain('setErrorHandler');
    expect(session).toContain('addErrorListener');
  });

  it('releases its subscription', () => {
    // A discarded manager could otherwise still fire a timer that touched auth
    // state, with its listener alive for the life of the page.
    expect(session).toContain('dispose()');
  });
});

describe('reconnect actually reconnects', () => {
  const session: string = read(LIB, 'session.ts');

  it('does not clear the workspace session on a transport error', () => {
    // A CID is permanent per account and the session survives a transport drop,
    // so discarding local session state is both wrong and unrecoverable.
    const scheduled: string = session.slice(session.indexOf('private scheduleReconnect'));
    expect(scheduled).not.toContain('clearWorkspaceSession');
  });

  it('calls the real restart the base client has always had', () => {
    expect(session).toContain('restart_ws_connection');
  });
});

describe('the base client supports more than one error subscriber', () => {
  const client: string = read(CLIENT, 'InternalServiceWasmClient.ts');

  it('exposes a listener API that returns a remover', () => {
    expect(client).toContain('addErrorListener');
    expect(client).toContain('errorListeners');
  });

  it('still honours a handler passed in the config', () => {
    // The listener list is additional, not a replacement: removing the config
    // handler would fix the clobber by breaking the thing it clobbered.
    expect(client).toContain('this.errorHandler = config.errorHandler');
  });
});
