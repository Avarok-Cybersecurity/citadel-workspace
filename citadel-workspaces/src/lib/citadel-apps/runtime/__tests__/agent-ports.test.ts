/**
 * The agent-backed ports: `storage.local` over AppKv and `net.host` over AppFetch, each request
 * carrying the install's namespace or grant (never the app's), each answer read by its request id,
 * the agent's closed refusals mapped to what an app reads, and streams read against credit.
 */
import { describe, expect, it } from 'vitest';
import { agentKvPort, splitStorage, type LocalKvTarget } from '../agent-kv-port';
import { agentFetchPort } from '../agent-fetch-port';
import type { HostFetchTarget } from '../agent-fetch-wire';
import type { HttpRequest } from '../../sdk/generated/HttpRequest';
import { MAX_OPEN_FETCH_STREAMS } from '../agent-fetch-stream';
import type { HostNetPort, PortAnswer, StoragePort } from '../../host/ports';
import { bodyOf, FakeAgent, variantName } from './fake-agent';

const TARGET: LocalKvTarget = { cid: 42n, appId: 'com.acme.kanban', scopeKey: 'workspace', timeoutMs: 200 } as const;

type KvGetBody = { request_id: string; op: { Get: { key: string } } };
type FetchPort = HostNetPort & { readonly closeAll: () => void };

describe('storage.local over the agent', () => {
  it('a get names the install’s namespace and reads the value; a miss is null', async () => {
    const agent: FakeAgent = new FakeAgent((r) => {
      const b: KvGetBody = bodyOf(r) as KvGetBody;
      return [{ AppKvResponse: { cid: 42n, request_id: b.request_id, result: { Value: b.op.Get.key === 'k' ? [1, 2] : null } } }];
    });
    const port: StoragePort = agentKvPort(agent, TARGET);
    expect(await port.KvGet({ backend: 'local', key: 'k' })).toEqual({ ok: { value: Uint8Array.from([1, 2]) } });
    expect(await port.KvGet({ backend: 'local', key: 'gone' })).toEqual({ ok: { value: null } });
    expect(agent.sent[0]).toEqual({ AppKv: { request_id: 'req-1', cid: 42n, namespace: { app_id: 'com.acme.kanban', scope_key: 'workspace' }, op: { Get: { key: 'k' } } } });
  });

  it('a refusal is the app’s to read: over quota is a limit, a bad namespace is unavailable', async () => {
    const refusing = (refusal: string): FakeAgent => new FakeAgent((r) => [{ AppKvFailure: { cid: 42n, request_id: (bodyOf(r) as { request_id: string }).request_id, refusal } }]);
    expect(await agentKvPort(refusing('Quota'), TARGET).KvSet({ backend: 'local', key: 'k', value: Uint8Array.from([1]) })).toEqual({ refused: { limit: 'quota' } });
    expect(await agentKvPort(refusing('Namespace'), TARGET).KvDelete({ backend: 'local', key: 'k' })).toEqual({ refused: { unavailable: 'local_namespace' } });
  });

  it('an answer for another request is not ours (control: the same answer with our id is)', async () => {
    const stranger: FakeAgent = new FakeAgent(() => [{ AppKvResponse: { cid: 42n, request_id: 'someone-else', result: 'Done' } }]);
    expect(await agentKvPort(stranger, TARGET).KvDelete({ backend: 'local', key: 'k' })).toEqual({ refused: { unavailable: 'agent' } });
    expect(stranger.listeners).toBe(0);
    const ours: FakeAgent = new FakeAgent((r) => [{ AppKvResponse: { cid: 42n, request_id: (bodyOf(r) as { request_id: string }).request_id, result: 'Done' } }]);
    expect(await agentKvPort(ours, TARGET).KvDelete({ backend: 'local', key: 'k' })).toEqual({ ok: null });
  });

  it('set_many is refused rather than done half-way; without an agent `local` is unavailable and `user` still reaches the server', async () => {
    const agent: FakeAgent = new FakeAgent(() => []);
    expect(await agentKvPort(agent, TARGET).KvSetMany({ backend: 'local', entries: [] })).toEqual({ refused: { unavailable: 'local_set_many' } });
    expect(agent.sent).toEqual([]);
    const server: StoragePort = { ...agentKvPort(agent, TARGET), KvGet: (): PortAnswer<{ value: null }> => ({ ok: { value: null } }) };
    const split: StoragePort = splitStorage(server, null);
    expect(await split.KvGet({ backend: 'local', key: 'k' })).toEqual({ refused: { unavailable: 'local' } });
    expect(await split.KvGet({ backend: 'user', key: 'k' })).toEqual({ ok: { value: null } });
  });
});

const FETCH: HostFetchTarget = { cid: 42n, appId: 'com.acme.kanban', installId: 'inst-1', grant: { hosts: ['api.acme.com'], private: false }, timeoutMs: 200 } as const;
const GET: HttpRequest = { method: 'GET', url: 'https://api.acme.com/x', headers: [['accept', 'text/plain']], body: new Uint8Array(0) };

describe('net.host over the agent', () => {
  it('sends the install’s grant with the request and reads the response', async () => {
    const agent: FakeAgent = new FakeAgent((r) => [{ AppFetchResponse: { cid: 42n, request_id: (bodyOf(r) as { request_id: string }).request_id, status: 200, headers: [{ name: 'content-type', value: 'text/plain' }], body: [104, 105], redirects: 0 } }]);
    const answer: PortAnswer = await agentFetchPort(agent, FETCH).HostFetch({ request: GET });
    expect(answer).toEqual({ ok: { status: 200, headers: [['content-type', 'text/plain']], body: Uint8Array.from([104, 105]) } });
    expect(agent.sent[0]).toEqual({ AppFetch: {
      request_id: 'req-1', cid: 42n, app_id: 'com.acme.kanban', install_id: 'inst-1', grant: { hosts: ['api.acme.com'], private: false },
      request: { method: 'GET', url: 'https://api.acme.com/x', headers: [{ name: 'accept', value: 'text/plain' }], body: [] }, stream: false,
    } });
  });

  it('the agent’s policy refusal is one answer for every reason; a limit names what', async () => {
    const failing = (refusal: unknown): FakeAgent => new FakeAgent((r) => [{ AppFetchFailure: { cid: 42n, request_id: (bodyOf(r) as { request_id: string }).request_id, refusal } }]);
    expect(await agentFetchPort(failing({ kind: 'Policy' }), FETCH).HostFetch({ request: GET })).toEqual({ refused: { policy: 'denied' } });
    expect(await agentFetchPort(failing({ kind: 'Limit', detail: 'Rate' }), FETCH).HostFetch({ request: GET })).toEqual({ refused: { limit: 'rate' } });
  });

  it('a stream is read chunk by chunk, granting one credit per whole chunk read, and ends', async () => {
    const agent: FakeAgent = new FakeAgent((r, a) => {
      if (variantName(r) !== 'AppFetch') return [];
      const id: string = (bodyOf(r) as { request_id: string }).request_id;
      a.emitSoon({ AppFetchStreamChunk: { cid: 42n, request_id: id, seq: 0, bytes: [1, 2, 3] } });
      a.emitSoon({ AppFetchStreamEnd: { cid: 42n, request_id: id, body_bytes: 3n } });
      return [{ AppFetchStreamHead: { cid: 42n, request_id: id, status: 200, headers: [], redirects: 0 } }];
    });
    const port: FetchPort = agentFetchPort(agent, FETCH);
    expect(await port.HostFetchOpen({ request: GET })).toEqual({ ok: { stream: 1, status: 200, headers: [] } });
    await new Promise<void>((done) => setTimeout(done, 5));
    expect(await port.NetStreamRead({ stream: 1, max: 2 })).toEqual({ ok: { bytes: Uint8Array.from([1, 2]), end: false } });
    expect(agent.sent.filter((s) => variantName(s) === 'AppFetchCredit')).toEqual([]);
    expect(await port.NetStreamRead({ stream: 1, max: 10 })).toEqual({ ok: { bytes: Uint8Array.from([3]), end: true } });
    expect(await port.NetStreamRead({ stream: 1, max: 10 })).toEqual({ ok: { bytes: new Uint8Array(0), end: true } });
    // Ended streams need no more credit; an open one would get `n: 1` per chunk.
    expect(agent.sent.filter((s) => variantName(s) === 'AppFetchCredit')).toEqual([]);
  });

  it('credit is granted for a chunk read while the stream is still open, and closing cancels', async () => {
    const agent: FakeAgent = new FakeAgent((r, a) => {
      if (variantName(r) !== 'AppFetch') return [];
      const id: string = (bodyOf(r) as { request_id: string }).request_id;
      a.emitSoon({ AppFetchStreamChunk: { cid: 42n, request_id: id, seq: 0, bytes: [9] } });
      return [{ AppFetchStreamHead: { cid: 42n, request_id: id, status: 200, headers: [], redirects: 0 } }];
    });
    const port: FetchPort = agentFetchPort(agent, FETCH);
    await port.HostFetchOpen({ request: GET });
    await new Promise<void>((done) => setTimeout(done, 5));
    expect(await port.NetStreamRead({ stream: 1, max: 10 })).toEqual({ ok: { bytes: Uint8Array.from([9]), end: false } });
    expect(agent.sent.filter((s) => variantName(s) === 'AppFetchCredit').map(bodyOf)).toEqual([{ request_id: 'req-2', cid: 42n, fetch_id: 'req-1', n: 1 }]);
    await port.NetStreamClose({ stream: 1 });
    expect(agent.sent.filter((s) => variantName(s) === 'AppFetchCancel').map(bodyOf)).toEqual([{ request_id: 'req-3', cid: 42n, fetch_id: 'req-1' }]);
    expect(agent.listeners).toBe(0);
  });

  it(`at most ${MAX_OPEN_FETCH_STREAMS} streams are open at once`, async () => {
    const agent: FakeAgent = new FakeAgent((r) => [{ AppFetchStreamHead: { cid: 42n, request_id: (bodyOf(r) as { request_id: string }).request_id, status: 200, headers: [], redirects: 0 } }]);
    const port: FetchPort = agentFetchPort(agent, FETCH);
    for (let i: number = 0; i < MAX_OPEN_FETCH_STREAMS; i++) expect('ok' in (await port.HostFetchOpen({ request: GET }))).toBe(true);
    expect(await port.HostFetchOpen({ request: GET })).toEqual({ refused: { limit: 'streams' } });
    port.closeAll();
    expect('ok' in (await port.HostFetchOpen({ request: GET }))).toBe(true);
  });
});
