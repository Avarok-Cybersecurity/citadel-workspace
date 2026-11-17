/**
 * The server-backed ports: each op as the SDK's HostCall in CBOR over `Call`, the server's reply
 * passed back as it is, and the request's own refusal (the kernel does not serve `Call` yet:
 * ServerFeatureUnavailable) as something the app can read. Internal HTTP over the relay:
 * advertising and renewing, addressing, and inbound frames for this install only, stamped by the
 * server. And the scope key, which must be the kernel's.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { IhttpAddress } from 'citadel-workspace-client-ts';
import type { AppsResult } from '@/lib/workspace-service/apps-operations';
import { decodeCbor, encodeCbor, type Decoded } from '../../host/cbor';
import type { InboundIhttpFrame } from '../../host/ports';
import type { HttpRequest } from '../../sdk/generated/HttpRequest';
import type { IhttpFrame } from '../../sdk/generated/IhttpFrame';
import { serverNet, serverStorage, type HostCaller } from '../kernel-call-ports';
import { ADVERTISE_EVERY_MS, ADVERTISE_TTL_MS, relayIhttpPort, type RelayDeps } from '../ihttp-relay-port';
import { scopeKeyOf } from '../zone-context';
import { InstallPlaneRegistry } from '../install-plane-registry';

const sha = async (b: Uint8Array): Promise<string> => createHash('sha256').update(b).digest('hex');

describe('server ports over Call', () => {
  it('sends the op as a HostCall and hands back the server’s HostReply', async () => {
    const sent: unknown[] = [];
    const call: HostCaller = async (bytes: Uint8Array): Promise<AppsResult<Uint8Array>> => {
      const d: Decoded = decodeCbor(bytes);
      sent.push(d.ok ? d.value : null);
      return { ok: true, value: encodeCbor({ refused: { limit: 'storage_user' } }) };
    };
    expect(await serverStorage(call).KvSet({ backend: 'user', key: 'k', value: Uint8Array.from([5]) })).toEqual({ refused: { limit: 'storage_user' } });
    const request: HttpRequest = { method: 'GET', url: 'https://api.acme.com/', headers: [], body: new Uint8Array(0) };
    await serverNet(call).ServerFetch({ request: { ...request, headers: [] } });
    expect(sent).toEqual([
      { Storage: { KvSet: { backend: 'user', key: 'k', value: Uint8Array.from([5]) } } },
      { Net: { ServerFetch: { request: { method: 'GET', url: 'https://api.acme.com/', headers: [], body: new Uint8Array(0) } } } },
    ]);
  });

  it('a server that does not serve Call yet is unavailable; ungranted is ungranted; a reply that is not a HostReply is refused', async () => {
    const refusing = (refusal: unknown): HostCaller => async () => ({ ok: false, refusal } as AppsResult<Uint8Array>);
    expect(await serverStorage(refusing('ServerFeatureUnavailable')).KvGet({ backend: 'user', key: 'k' })).toEqual({ refused: { unavailable: 'server' } });
    expect(await serverStorage(refusing({ Ungranted: 'storage.user' })).KvGet({ backend: 'user', key: 'k' })).toEqual({ refused: 'ungranted' });
    const junk: HostCaller = async () => ({ ok: true, value: encodeCbor({ hello: 1 }) });
    expect(await serverStorage(junk).KvGet({ backend: 'user', key: 'k' })).toEqual({ refused: { unavailable: 'server_reply' } });
  });
});

function relay(over: Partial<RelayDeps> = {}): { deps: RelayDeps; sent: [IhttpAddress, unknown][]; ads: [string, bigint][]; ticks: (() => void)[]; push: (a: unknown) => void; stopped: number[]; withdrawals: () => number } {
  let withdrawals: number = 0;
  const sent: [IhttpAddress, unknown][] = [];
  const ads: [string, bigint][] = [];
  const ticks: (() => void)[] = [];
  const stopped: number[] = [];
  let listener: ((a: unknown) => void) | null = null;
  const deps: RelayDeps = {
    installId: 'inst-1', seat: new InstallPlaneRegistry().attach('inst-1', 'com.acme.kanban'), sha256Hex: sha, nowMs: () => 1_000,
    send: async (to, frame) => { const d: Decoded = decodeCbor(frame); sent.push([to, d.ok ? d.value : null]); return { ok: true, value: null }; },
    advertise: async (digest, until) => { ads.push([digest, until]); return { ok: true, value: until }; },
    withdraw: async () => { withdrawals++; return { ok: true, value: 1 }; },
    pushes: (l) => { listener = l; return () => { listener = null; }; },
    every: (ms, fire) => { expect(ms).toBe(ADVERTISE_EVERY_MS); ticks.push(fire); return () => { stopped.push(ms); }; },
    ...over,
  };
  return { deps, sent, ads, ticks, stopped, push: (a: unknown) => listener?.(a), withdrawals: () => withdrawals };
}

const frame: IhttpFrame = { v: 1, stream: 3n, kind: 'End' };
const from: Omit<InboundIhttpFrame['from'], 'via'> = { username: 'bob', cid: 7n, app_id: 'com.acme.kanban', install_id: 'inst-9' };

describe('internal HTTP over the relay', () => {
  it('serving advertises sha256 of the routes for 90 s and renews every minute until withdrawn', async () => {
    const r: ReturnType<typeof relay> = relay();
    const port: ReturnType<typeof relayIhttpPort> = relayIhttpPort(r.deps);
    expect(await port.IhttpServe({ routes: [{ method: 'GET', path: '/a' }, { method: 'POST', path: '/b/:id' }], on: { relay: true, p2p: false } })).toEqual({ ok: null });
    const digest: string = await sha(new TextEncoder().encode('GET /a\nPOST /b/:id'));
    expect(r.ads).toEqual([[digest, BigInt(1_000 + ADVERTISE_TTL_MS)]]);
    r.ticks[0]();
    expect(r.ads.length).toBe(2);
    expect(await port.withdraw()).toEqual({ ok: true, value: 1 });
    expect([r.stopped, r.withdrawals()]).toEqual([[ADVERTISE_EVERY_MS], 1]);
  });

  it('an instance that never served withdraws nothing (control: one that did, once its advertisement landed)', async () => {
    const idle: ReturnType<typeof relay> = relay();
    expect(await relayIhttpPort(idle.deps).withdraw()).toBeNull();
    expect(idle.withdrawals()).toBe(0);
    let land: () => void = (): void => undefined;
    const slow: ReturnType<typeof relay> = relay({ advertise: (_d, until) => new Promise((r) => { land = (): void => r({ ok: true, value: until }); }) });
    const port: ReturnType<typeof relayIhttpPort> = relayIhttpPort(slow.deps);
    const serving: Promise<unknown> = Promise.resolve(port.IhttpServe({ routes: [], on: { relay: true, p2p: false } }));
    await new Promise<void>((r) => setTimeout(r, 0));
    const withdrawn: Promise<unknown> = port.withdraw();
    land();
    await serving;
    expect(await withdrawn).toEqual({ ok: true, value: 1 });
    // The advertisement that landed after the withdrawal began is not renewed.
    expect([slow.withdrawals(), slow.ticks]).toEqual([1, []]);
  });

  it('a refused advertisement is the app’s answer, and nothing is renewed', async () => {
    const r: ReturnType<typeof relay> = relay({ advertise: async () => ({ ok: false, refusal: 'ServerFeatureUnavailable' }) });
    expect(await relayIhttpPort(r.deps).IhttpServe({ routes: [], on: { relay: true, p2p: false } })).toEqual({ refused: { unavailable: 'server' } });
    expect(r.ticks).toEqual([]);
  });

  it('a call goes to the address the app named, a response to the caller the server named', async () => {
    const r: ReturnType<typeof relay> = relay();
    const port: ReturnType<typeof relayIhttpPort> = relayIhttpPort(r.deps);
    await port.IhttpCall({ to: { scope: { app_id: 'com.acme.kanban', scope_key: 'workspace' } }, frame, transport: 'relay' });
    await port.respond({ ...from, via: 'relay' }, frame);
    expect(r.sent).toEqual([
      [{ Scope: { app_id: 'com.acme.kanban', scope_key: 'workspace' } }, { v: 1, stream: 3, kind: 'End' }],
      [{ User: { app_id: 'com.acme.kanban', username: 'bob' } }, { v: 1, stream: 3, kind: 'End' }],
    ]);
  });

  it('inbound frames: only this install’s, only well-formed, always via relay', () => {
    const r: ReturnType<typeof relay> = relay();
    const got: InboundIhttpFrame[] = [];
    relayIhttpPort(r.deps).onFrame((f) => got.push(f));
    const bytes: number[] = Array.from(encodeCbor(frame));
    r.push({ IhttpFrame: { from, to_install_id: 'inst-2', frame: bytes } });
    r.push({ IhttpFrame: { from, to_install_id: 'inst-1', frame: Array.from(encodeCbor({ v: 1 })) } });
    expect(got).toEqual([]);
    r.push({ IhttpFrame: { from, to_install_id: 'inst-1', frame: bytes } });
    expect(got).toEqual([{ from: { ...from, via: 'relay' }, frame: { v: 1, stream: 3n, kind: 'End' } }]);
  });
});

describe('the scope key', () => {
  it('is the kernel’s: named scopes by prefix, users by the digest of the sorted, distinct names', async () => {
    expect(await scopeKeyOf('Workspace', sha)).toBe('workspace');
    expect(await scopeKeyOf({ Node: 'n1' }, sha)).toBe('node:n1');
    expect(await scopeKeyOf({ NodeTree: 'n1' }, sha)).toBe('tree:n1');
    expect(await scopeKeyOf({ SelfOnly: 'alice' }, sha)).toBe('self:alice');
    const expected: string = `users:${createHash('sha256').update('alice\nbob').digest('hex').slice(0, 32)}`;
    expect(await scopeKeyOf({ Users: ['bob', 'alice', 'bob'] }, sha)).toBe(expected);
    expect(await scopeKeyOf({ Users: ['alice'] }, sha)).not.toBe(expected);
  });
});
