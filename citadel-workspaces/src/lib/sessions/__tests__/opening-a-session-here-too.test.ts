/**
 * Opening a session another window holds, here too (agent 0.8.6).
 *
 * The password joins once and earns a token; the token is kept sealed, and
 * joins again later without asking. Real WebCrypto and the real request path;
 * the stand-ins are the IndexedDB store (a Map) and the agent, which answers
 * on the app's event emitter the way it does on the socket.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { joinWithPassword, joinWithRememberedToken, type AttachDeps } from '../attach-session';
import { rememberJoin, recallJoin, type JoinTokenStorage } from '../join-token';
import { eventEmitter } from '@/lib/event-emitter';

const CID: bigint = 4242n;
const TOKEN: number[] = Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256);

function memory(): JoinTokenStorage & { raw: Map<string, unknown> } {
  const raw: Map<string, unknown> = new Map();
  return {
    raw,
    get: async (k: string) => raw.get(k),
    put: async (k: string, v: unknown): Promise<void> => { raw.set(k, v); },
    delete: async (k: string): Promise<void> => { raw.delete(k); },
  };
}

type Proof = { Password?: number[]; Token?: number[] };
let proofs: Proof[] = [];
let agent: (proof: Proof) => Record<string, unknown> = () => ({});

function deps(tokens: JoinTokenStorage): AttachDeps {
  return {
    tokens,
    send: async (request: Record<string, unknown>): Promise<void> => {
      const body: { request_id: string; management_command: { AttachSession: { session_cid: bigint; proof: Proof } } } = (request.ConnectionManagement as { request_id: string; management_command: { AttachSession: { session_cid: bigint; proof: Proof } } });
      expect(body.management_command.AttachSession.session_cid).toBe(CID);
      const proof: Proof = body.management_command.AttachSession.proof;
      proofs.push(proof);
      queueMicrotask(() => eventEmitter.emit('websocket-message', withId(agent(proof), body.request_id)));
    },
  };
}

function withId(answer: Record<string, unknown>, id: string): Record<string, unknown> {
  const [variant, body] = Object.entries(answer)[0] as [string, Record<string, unknown>];
  return { [variant]: { ...body, request_id: id } };
}

const accepts = (password: string) => (proof: Proof): Record<string, unknown> => {
  const ok: boolean = proof.Password
    ? new TextDecoder().decode(Uint8Array.from(proof.Password)) === password
    : JSON.stringify(proof.Token) === JSON.stringify(TOKEN);
  return ok
    ? { SessionAttached: { cid: CID, role: 'Secondary', token: TOKEN } }
    : { ConnectionManagementFailure: { cid: CID, error: proof.Password ? 'The password does not match this session' : "This browser's session token is not valid any more" } };
};

beforeEach(() => { proofs = []; });

describe('opening a session here too', () => {
  it('joins with the password, then again with the token alone', async () => {
    const store: JoinTokenStorage & { raw: Map<string, unknown> } = memory();
    agent = accepts('correct horse');
    expect(await joinWithPassword(deps(store), CID, 'correct horse')).toBe('Secondary');
    expect(await joinWithRememberedToken(deps(store), CID)).toBe(true);
    expect(proofs[1]).toEqual({ Token: TOKEN });
  });

  it('reports a wrong password and remembers nothing', async () => {
    const store: JoinTokenStorage & { raw: Map<string, unknown> } = memory();
    agent = accepts('correct horse');
    await expect(joinWithPassword(deps(store), CID, 'wrong')).rejects.toThrow('password does not match');
    expect(await joinWithRememberedToken(deps(store), CID)).toBe(false);
    expect(proofs).toHaveLength(1);
  });

  it('forgets a token the agent no longer honours, and asks again', async () => {
    const store: JoinTokenStorage & { raw: Map<string, unknown> } = memory();
    agent = accepts('correct horse');
    await joinWithPassword(deps(store), CID, 'correct horse');
    agent = (): Record<string, unknown> => ({ ConnectionManagementFailure: { cid: CID, error: "This browser's session token is not valid any more" } });
    expect(await joinWithRememberedToken(deps(store), CID)).toBe(false);
    expect(await recallJoin(store, CID)).toBeNull();
  });

  it('does not ask without a token', async () => {
    expect(await joinWithRememberedToken(deps(memory()), CID)).toBe(false);
    expect(proofs).toEqual([]);
  });
});

describe('the remembered token', () => {
  it('is never stored as plaintext, under a key nothing can export', async () => {
    const store: JoinTokenStorage & { raw: Map<string, unknown> } = memory();
    await rememberJoin(store, CID, Uint8Array.from(TOKEN));
    const plaintext: string = TOKEN.slice(0, 8).join(',');
    for (const value of store.raw.values()) {
      const sealed: unknown = (value as { sealed?: unknown }).sealed;
      if (sealed instanceof ArrayBuffer) expect(Array.from(new Uint8Array(sealed)).join(',')).not.toContain(plaintext);
      if (Object.prototype.toString.call(value) === '[object CryptoKey]') {
        expect((value as CryptoKey).extractable).toBe(false);
        await expect(crypto.subtle.exportKey('raw', value as CryptoKey)).rejects.toThrow();
      }
    }
    expect(Array.from((await recallJoin(store, CID)) ?? [])).toEqual(TOKEN);
  });

  it('opens only as the session it was sealed for', async () => {
    const store: JoinTokenStorage & { raw: Map<string, unknown> } = memory();
    await rememberJoin(store, CID, Uint8Array.from(TOKEN));
    // Another session's slot, holding this session's sealed token: refused, and dropped.
    store.raw.set('multi-window:join-token:7', store.raw.get(`multi-window:join-token:${CID}`));
    expect(await recallJoin(store, 7n)).toBeNull();
    expect(store.raw.has('multi-window:join-token:7')).toBe(false);
  });
});
