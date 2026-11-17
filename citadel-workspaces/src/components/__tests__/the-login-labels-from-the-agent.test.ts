/**
 * The password login files its session by what the agent reports (session-label), not by
 * this browser's copy. Behaviour is tested in a-sign-in-files-the-session-under-its-server;
 * this pins that the login is wired to it, since the defect was the login's own fallback.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/test-utils/strip-comments';

const source: string = stripComments(readFileSync(join(process.cwd(), 'src/components/login-with-password.ts'), 'utf8'));

describe('loginWithPassword', () => {
  it('labels the session through sessionLabel', () => {
    expect(source).toContain('sessionLabel(cid, username.trim(), live, storedSession)');
  });

  it('no longer files a session under an empty server or the handle as its name', () => {
    expect(source).not.toContain("storedSession?.serverAddress ?? ''");
    expect(source).not.toContain('fullName: username,');
  });
});
