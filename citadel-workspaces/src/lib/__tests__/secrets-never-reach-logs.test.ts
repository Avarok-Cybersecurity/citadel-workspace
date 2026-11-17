/**
 * A password must never reach a log, whatever type it happens to be.
 *
 * Redaction lived entirely inside `shouldFormatAsBytes`, which begins
 * `if (!Array.isArray(value)) return false`. `StoredSession.password` is a
 * STRING, so it fell through to the recursive branch and was printed verbatim —
 * on every session write: auth success, auto-reconnect, logout, role update,
 * active-index change. `serverPassword` was in no list at all and so was never
 * redacted anywhere.
 *
 * `debugLog` is a no-op in production builds — but the shipped compose stack
 * builds `target: dev`, where it is live.
 */
import { describe, it, expect } from 'vitest';
import { formatForDebug, isSecretField } from '../debug-formatter';

const SECRET: "hunter2-do-not-print-me" = 'hunter2-do-not-print-me';

/** Every rendering of the formatted value, so nothing hides in a nested field. */
const rendered = (value: unknown): string => JSON.stringify(formatForDebug(value));

describe('debug formatting', () => {
  it('redacts a password that is a string', () => {
    // The exact shape StoredSession has, and the exact reason this was missed.
    expect(rendered({ username: 'alice', password: SECRET })).not.toContain(SECRET);
  });

  it('redacts a password that is a byte array', () => {
    const bytes: number[] = [...new TextEncoder().encode(SECRET)];
    expect(rendered({ password: bytes })).not.toContain(SECRET);
  });

  it('redacts serverPassword, which was in no list at all', () => {
    expect(rendered({ serverPassword: SECRET })).not.toContain(SECRET);
  });

  it('redacts the workspace master password', () => {
    expect(rendered({ workspace_master_password: SECRET })).not.toContain(SECRET);
  });

  it('redacts secrets nested inside a session list', () => {
    const sessions: { sessions: { username: string; password: string; }[]; activeIndex: number; } = { sessions: [{ username: 'alice', password: SECRET }], activeIndex: 0 };
    expect(rendered(sessions)).not.toContain(SECRET);
  });

  it('redacts secrets inside a JSON STRING, which is how sessions are logged', () => {
    // storeSessionsToLocalDB serializes first and formats the string.
    const serialized: string = JSON.stringify({ sessions: [{ password: SECRET }] });
    expect(rendered(serialized)).not.toContain(SECRET);
  });

  it('still prints the non-secret fields, or the log is useless', () => {
    const out: string = rendered({ username: 'alice', password: SECRET, serverAddress: 'ws://x' });
    expect(out).toContain('alice');
    expect(out).toContain('ws://x');
  });

  it('does not redact fields that merely mention passing', () => {
    // A blunt /pass/ would swallow these and make the logs worse.
    expect(isSecretField('passthrough')).toBe(false);
    expect(isSecretField('bypassed')).toBe(false);
    expect(isSecretField('passes')).toBe(false);
  });
});
