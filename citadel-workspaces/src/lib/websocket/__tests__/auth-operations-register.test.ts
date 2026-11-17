import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Pinning test for the C2S Register payload shape.
 *
 * The Rust internal-service expects `server_password: Option<PreSharedKey>`
 * where `PreSharedKey` is `{ passwords: Vec<Vec<u8>> }`. PR #13 changed
 * the wire format from `serverPassword || null` (raw string) to
 * `{ passwords: [stringToBytes(serverPassword)] }` (the struct shape).
 *
 * Without this pin, a future "simplification" that flattens
 * `server_password` back to a string would silently break server
 * registration (the server would deserialise it as `None` and the
 * registration would fail without a CSP-style telltale).
 */

// Typed against the AuthConfig.sendRequest signature so that
// `sendSpy.mock.calls[0]` is the proper [request, requestId?] tuple.
// Without the explicit generic, vi.fn infers a zero-arg signature and
// the calls array becomes []; the cast in each assertion below would
// then fail strict TS with "Conversion of type '[]' to type [...]".
const sendSpy = vi.fn<(request: unknown, requestId?: string) => Promise<void>>(async (): Promise<undefined> => undefined);

vi.mock('../../address-resolver', () => ({
  resolveServerAddress: async (s: string): Promise<string> => s,
}));

vi.mock('../../multi-instance', () => ({
  instanceManager: { isLeader: true },
}));

vi.mock('../../security-utils', () => ({
  getDefaultSecuritySettings: (): { security_level: string; secrecy_mode: string; header_obfuscator_settings: string; crypto_params: { kem: string; sig: string; }; } => ({
    security_level: 'Standard',
    secrecy_mode: 'Perfect',
    header_obfuscator_settings: 'Disabled',
    crypto_params: { kem: 'Kyber', sig: 'Falcon' },
  }),
}));

import { AuthOperations } from '../auth-operations';

beforeEach(() => sendSpy.mockClear());

function makeAuth(): AuthOperations {
  return new AuthOperations({
    init: async () => undefined,
    sendRequest: sendSpy,
    claimSession: async () => undefined,
    disconnect: async () => undefined,
  });
}

describe('AuthOperations.register — server_password wire format', () => {
  it('sends server_password as Option<PreSharedKey>::Some({passwords: [bytes]}) when provided', async () => {
    await makeAuth().register('req-1', 'alice', 'password', 'Alice', '127.0.0.1:12349', null, 'sekret');
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [request] = sendSpy.mock.calls[0] as [Record<string, unknown>, string];
    const opts: Record<string, unknown> = (request.Register as Record<string, unknown>);
    const sp: { passwords: number[][]; } = opts.server_password as { passwords: number[][] };
    expect(sp).not.toBeNull();
    expect(Array.isArray(sp.passwords)).toBe(true);
    expect(sp.passwords).toHaveLength(1);
    // stringToBytes returns number[]; verify round-trip through Uint8Array
    const decoded: string = new TextDecoder().decode(new Uint8Array(sp.passwords[0]));
    expect(decoded).toBe('sekret');
  });

  it('sends server_password as Option<PreSharedKey>::None when no password is provided', async () => {
    await makeAuth().register('req-2', 'bob', 'password', 'Bob', '127.0.0.1:12349', null);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [request] = sendSpy.mock.calls[0] as [Record<string, unknown>, string];
    const opts: Record<string, unknown> = (request.Register as Record<string, unknown>);
    expect(opts.server_password).toBeNull();
  });

  it('sends proposed_password as bytes (not a raw string)', async () => {
    await makeAuth().register('req-3', 'carol', 'pw', 'Carol', '127.0.0.1:12349', null);
    const [request] = sendSpy.mock.calls[0] as [Record<string, unknown>, string];
    const opts: Record<string, unknown> = (request.Register as Record<string, unknown>);
    const pw: number[] = opts.proposed_password as number[];
    expect(Array.isArray(pw)).toBe(true);
    expect(new TextDecoder().decode(new Uint8Array(pw))).toBe('pw');
  });
});
