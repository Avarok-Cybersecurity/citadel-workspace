/**
 * The whole page path of `citadel.session`: a mounted app opens a session at init through the real
 * runtime (mount-steps, host-ports, the in-process worker's dispatcher), the agent answers, and
 * what the agent then reports on that session reaches the running app as AppEvent `session`.
 * The agent is the only fake (FakeAgent: the socket boundary); the kernel is the runtime rig's.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { AppLimits, CapabilityRequest } from 'citadel-workspace-client-ts';
import { callGroup, appModule, type AppModuleOptions } from '../../host/__tests__/app-fixtures';
import { until } from '../../host/__tests__/in-process';
import { decodeCbor, encodeCbor, type Decoded } from '../../host/cbor';
import type { ToWorker } from '../../host/worker-protocol';
import { ABI_MINOR } from '../../sdk/generated/AbiConstants';
import type { Json } from '../agent-link';
import { bodyOf, FakeAgent, variantName } from './fake-agent';
import { FakeRuntimeKernel, hostOf, release, rig, slotsOf, zoneOf, type Rig } from './runtime-rig';
import { cap } from '@/test/app-manifests';
import { sha256Hex } from '../../host/__tests__/fake-verifier';

const SERVER: string = 'synchronized.work';
const OPEN_ARGS: Uint8Array = encodeCbor({ server: SERVER });
const OPEN_AT: number = 1024;
const SESSION: number = 7;

/** app_init opens the session to SERVER once and returns 0; its reply arrives later as reply_ready. */
function opensAtInit(): Uint8Array {
  const base: AppModuleOptions = { groups: ['session'] };
  return appModule({ ...base, init: [...callGroup(base, 'session', 1, OPEN_AT, OPEN_ARGS.byteLength), 0x41, 0x00], data: [{ offset: OPEN_AT, bytes: OPEN_ARGS }] });
}

const CAPABILITIES: CapabilityRequest[] = [cap('canvas'), { cap: 'citadel.session', why: 'Keeps the graph live', optional: false, servers: [SERVER] }];
// The shared base manifest's limits, with the session limits citadel.session must state.
const LIMITS: AppLimits = { memory_pages: 1024, max_call_rate_per_s: 200, frame_budget_ms: 16, storage_user_bytes: 1048576, storage_scope_bytes: 8388608, close_grace_ms: 500, session: { max_msg_bytes: 1024, max_msgs_per_s: 8 } };

let rigs: Rig[] = [];
afterEach(() => {
  rigs.forEach((r: Rig) => r.close());
  rigs = [];
  document.body.innerHTML = '';
});

/** The rig with a signed-in agent session (cid 42) that serves apps, reached through `agent`. */
function mounted(agent: FakeAgent): { r: Rig; host: HTMLDivElement } {
  const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(release(opensAtInit(), ['citadel.session'], { capabilities: CAPABILITIES, limits: LIMITS }));
  const r: Rig = rig(kernel, {
    portWorld: async () => ({
      transport: kernel, agent, agentSession: { cid: 42n }, log: { LogWrite: () => ({ ok: null }) },
      pushes: () => (): void => undefined, sha256Hex: async (b: Uint8Array): Promise<string> => sha256Hex(b),
      nowMs: (): number => Date.now(), every: () => (): void => undefined,
      // Nothing here asks the peer planes: the app neither serves, calls nor opens a topic.
      peerCid: () => null, presence: () => null, peerForMe: () => null, topicRecord: { group: () => undefined, request: () => undefined }, report: (): void => undefined,
      // The app raises no notification, and is not granted `notifications`.
      notices: (): void => undefined,
      // A worker app hears no storage changes, so there is nobody to announce its own-store writes to.
      ownWrites: null,
    }),
  });
  rigs.push(r);
  const host: HTMLDivElement = hostOf(320);
  r.runtime.mount(slotsOf(host), zoneOf(kernel.rel));
  return { r, host };
}

const sessionEvents = (r: Rig): unknown[] => r.sent.flatMap((m: ToWorker): unknown[] => {
  if (m.kind !== 'event') return [];
  const d: Decoded = decodeCbor(m.event);
  return d.ok && typeof d.value === 'object' && d.value !== null && 'session' in d.value ? [d.value] : [];
});

describe('a session the mounted app opened', () => {
  it('carries what the agent reports to the running app, and nothing for another install', async () => {
    const agent: FakeAgent = new FakeAgent((q: Json): unknown[] => variantName(q) !== 'AppSessionOpen' ? [] : [
      { AppSessionState: { cid: 42n, request_id: bodyOf(q).request_id, install_id: bodyOf(q).install_id, session: SESSION, server_cid: 900n, state: 'connected' } },
    ]);
    const { r, host } = mounted(agent);
    await until(() => host.dataset.appState === 'running' && agent.sent.length === 1, 4000);
    expect(agent.sent[0]).toEqual({ AppSessionOpen: { request_id: 'req-1', cid: 42n, app_id: 'com.acme.kanban', install_id: 'inst-1', acting_username: 'alice', server: SERVER } });
    agent.emitSoon({ AppSessionMessage: { cid: 42n, request_id: undefined, install_id: 'inst-2', session: SESSION, body: new Uint8Array([9]) } });
    agent.emitSoon({ AppSessionMessage: { cid: 42n, request_id: undefined, install_id: 'inst-1', session: SESSION, body: new Uint8Array([1, 2]) } });
    await until(() => sessionEvents(r).length > 0, 4000);
    expect(sessionEvents(r)).toEqual([{ session: { session: SESSION, event: { message: { body: Uint8Array.from([1, 2]) } } } }]);
  });

  it('runs under a context naming the host’s ABI minor, which a guest reads before it opens', async () => {
    const { r, host } = mounted(new FakeAgent(() => []));
    await until(() => host.dataset.appState === 'running', 4000);
    const load: ToWorker | undefined = r.sent.find((m: ToWorker): boolean => m.kind === 'load');
    const context: Decoded = load !== undefined && load.kind === 'load' ? decodeCbor(load.context) : { ok: false };
    expect(context.ok && (context.value as Record<string, unknown>).sdk_abi_minor).toBe(ABI_MINOR);
  });
});
