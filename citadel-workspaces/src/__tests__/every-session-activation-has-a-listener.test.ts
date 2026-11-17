/**
 * Every module that emits 'session:activated' loads the service that listens for it.
 *
 * SessionStartupService subscribes when its module is first imported. Only the
 * register path and a workspace-sidebar hook imported it, so a password sign-in
 * from a freshly loaded landing page emitted the event to nobody: the P2P
 * registry never started, and presence read "not known" for every member
 * (live, admin-lab, 2026-09-25). The emitter carries the import, so the
 * listener exists wherever the event can be raised.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';
import { stripComments } from '@/test-utils/strip-comments';

const SRC: string = join(__dirname, '..');
/** The listener itself re-emits to queue a reconnection behind a running startup. */
const LISTENER: string = 'lib/session-startup-service.ts';
const EMITS: RegExp = /emit\(\s*['"]session:activated['"]/;
const LOADS_LISTENER: RegExp = /import\s+(?:[^'"]*from\s+)?['"]@\/lib\/session-startup-service['"]/;

describe("the 'session:activated' listener", () => {
  const emitters: string[] = fg.sync('**/*.{ts,tsx}', { cwd: SRC, ignore: ['**/__tests__/**', '**/*.test.*', LISTENER] })
    .filter((file: string): boolean => EMITS.test(stripComments(readFileSync(join(SRC, file), 'utf8'))));

  it('has emitters to check', () => {
    expect(emitters.length).toBeGreaterThan(0);
  });

  it('is imported by every module that emits the event', () => {
    const missing: string[] = emitters.filter(
      (file: string): boolean => !LOADS_LISTENER.test(readFileSync(join(SRC, file), 'utf8')),
    );
    expect(missing).toEqual([]);
  });
});

/**
 * A module that finishes a sign-in or claim with postAuthSetup must also
 * activate the session -- postAuthSetup loads the workspace, and only the
 * activation starts the P2P registry and the peer connections. The page-load
 * claim and the /connect adoption both skipped it, so after any reload the
 * registry stayed stopped.
 */
const FOLLOWS_AN_ACTIVATING_PATH: Record<string, string> = {
  'lib/post-auth-setup.ts': 'the function itself',
  'pages/Landing.tsx': 'the join step runs after the register path (useConnectionHandler), which activates',
  'components/TakeoverSignIn.tsx': 'finishes a <Login>, whose password sign-in (login-with-password.ts) activates',
  'components/ServerReconnectWatcher.tsx': 'the session was already active; it resumes peers itself (server-reconnect.ts)',
};

describe('a sign-in or claim', () => {
  it('activates the session wherever it runs postAuthSetup', () => {
    const callers: string[] = fg.sync('**/*.{ts,tsx}', { cwd: SRC, ignore: ['**/__tests__/**', '**/*.test.*'] })
      .filter((file: string): boolean => /postAuthSetup\(/.test(stripComments(readFileSync(join(SRC, file), 'utf8'))));
    const silent: string[] = callers.filter((file: string): boolean =>
      !(file in FOLLOWS_AN_ACTIVATING_PATH) && !EMITS.test(stripComments(readFileSync(join(SRC, file), 'utf8'))));
    expect(callers.length).toBeGreaterThan(3);
    expect(silent).toEqual([]);
  });
});
