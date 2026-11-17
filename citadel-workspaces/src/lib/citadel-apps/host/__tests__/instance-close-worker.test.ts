/**
 * A close through the production worker host (in-process): app_close gets the reason's code, a
 * closing app reaches storage and is refused everything else with `closing`, and the instance
 * settles only after the reply its close waited on was delivered.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CLOSE_REASON_CODE } from '../../sdk/generated/AbiConstants';
import { encodeCbor } from '../cbor';
import type { Capability } from '../capabilities';
import { inspectArtifact, type LoadVerdict } from '../inspect';
import { launchAppInstance, type AppInstance, type CloseOutcome, type Launch } from '../instance';
import { InstanceSlots } from '../instance-slots';
import { STANDARD_HOST_POLICY } from '../limits';
import { appModule, callGroup, fixtureContext, FIXTURE_CLOSE_GRACE_MS, type AppModuleOptions } from './app-fixtures';
import { fakeNodes, fakeStorage, type Recorder } from './fakes';
import { inProcess, realClock, until, type InProcess } from './in-process';
import { op } from './wasm-builder';

let rigs: InProcess[] = [];
afterEach(() => {
  rigs.forEach((r: InProcess) => r.close());
  rigs = [];
});

const NODE_ARGS: Uint8Array = encodeCbor({ node_id: 'n1' });
const KV_ARGS: Uint8Array = encodeCbor({ backend: 'user', key: 'k' });
const NODE_AT: number = 1024;
const KV_AT: number = 2048;
const OPTS: AppModuleOptions = { groups: ['nodes', 'storage'] };

/** app_close calls nodes.NodeGet and storage.KvGet, then answers its reason's code. */
const closesWithCalls: Uint8Array = appModule({
  ...OPTS,
  close: [...callGroup(OPTS, 'nodes', 1, NODE_AT, NODE_ARGS.byteLength), ...callGroup(OPTS, 'storage', 1, KV_AT, KV_ARGS.byteLength), ...op.localGet(0)],
  data: [{ offset: NODE_AT, bytes: NODE_ARGS }, { offset: KV_AT, bytes: KV_ARGS }],
});

async function startedWith(rec: Recorder, granted: readonly Capability[]): Promise<AppInstance> {
  const verdict: LoadVerdict = await inspectArtifact(closesWithCalls, new Set<Capability>(granted), 16);
  if (!verdict.ok) throw new Error(verdict.reasons.join(', '));
  const rig: InProcess = inProcess();
  rigs.push(rig);
  const l: Launch = launchAppInstance({
    appId: 'com.acme.test', module: verdict.module, granted: new Set<Capability>(granted), context: fixtureContext([...granted], FIXTURE_CLOSE_GRACE_MS),
    closeGraceMs: FIXTURE_CLOSE_GRACE_MS, pageUrl: 'https://work.avarok.net/', memory: { initialPages: 1, maxPages: 16 }, policy: STANDARD_HOST_POLICY, limits: { topics: null, p2p: null },
    ports: { nodes: fakeNodes(rec), storage: fakeStorage(rec) }, clock: realClock, slots: new InstanceSlots(8), spawn: rig.spawn,
  });
  if (!l.ok) throw new Error('no slot');
  await until(() => l.instance.state === 'running', 2000);
  expect(l.instance.start()).toBe(true);
  return l.instance;
}

describe('a close in the worker host', () => {
  it('app_close gets the code of each reason', async () => {
    for (const reason of ['unmount', 'access_revoked', 'host_error'] as const) {
      const outcome: CloseOutcome = await (await startedWith({ calls: [] }, ['nodes.read', 'storage.user'])).close(reason);
      expect([reason, outcome.ending, outcome.closeResult]).toEqual([reason, 'settled', CLOSE_REASON_CODE[reason]]);
    }
  });

  it('closing, storage is reached and nodes is not, though both are granted; it settles after the storage reply', async () => {
    const rec: Recorder = { calls: [] };
    const i: AppInstance = await startedWith(rec, ['nodes.read', 'storage.user']);
    const outcome: CloseOutcome = await i.close('unmount');
    expect(outcome.ending).toBe('settled');
    expect(rec.calls.map((c) => c.method)).toEqual(['KvGet']);
    expect(i.state).toBe('closed');
  });
});
