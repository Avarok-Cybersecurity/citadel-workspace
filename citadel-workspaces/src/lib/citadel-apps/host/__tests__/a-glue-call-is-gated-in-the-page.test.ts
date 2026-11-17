/**
 * A glue app's in-page call is gated exactly as a worker's, by the same Dispatcher: an op its
 * grant does not cover never reaches the port, though the port is bound; its calls count against
 * the worker's host-call rate, and a server call past the server rate waits rather than fails;
 * and once it closes nothing more reaches a port.
 */
import { describe, expect, it } from 'vitest';
import type { Capability } from '../capabilities';
import { glueInstance, type GlueInstance } from '../glue-instance';
import { STANDARD_HOST_POLICY } from '../limits';
import type { HostPorts, HostReply } from '../ports';
import { fakeLog, fakeNodes, fakeStorage, ManualClock, type Recorder } from './fakes';
import type { KvValue } from '@/lib/citadel-apps/sdk/generated/KvValue';

/** Every microtask the calls queued, run: a real macrotask turn (the test's clock is the manual one). */
const flush = (): Promise<void> => new Promise<void>((done: () => void): void => { setTimeout(done, 0); });

function glue(ports: HostPorts, held: Capability[], clock: ManualClock = new ManualClock()): GlueInstance {
  return glueInstance({
    appId: 'net.avarok.calendar', ports, held: new Set<Capability>(held), policy: STANDARD_HOST_POLICY,
    limits: { topics: null, p2p: null }, clock, pageUrl: 'https://w.example/n1', storageChanges: () => () => {},
  });
}

describe('a glue instance', () => {
  it('refuses an ungranted call in the page without touching the port (control: a granted one reaches it)', async () => {
    const rec: Recorder = { calls: [] };
    const g: GlueInstance = glue({ nodes: fakeNodes(rec) }, ['nodes.read']);
    expect(await g.call('nodes', 4, { parent_id: 'n1', name: 'x' })).toEqual({ refused: 'ungranted' });
    expect(rec.calls).toEqual([]);
    expect(await g.call('nodes', 1, { node_id: 'n1' })).toMatchObject({ ok: { node_id: 'n1', name: 'Board' } });
    expect(rec.calls.map((c) => c.method)).toEqual(['NodeGet']);
  });

  it('names an op by its generated name and refuses a store the grant does not name', async () => {
    const rec: Recorder = { calls: [] };
    const g: GlueInstance = glue({ storage: fakeStorage(rec) }, ['storage.user']);
    expect(await g.op('KvGet', { backend: { node_authored: { node_id: 'n1', author: null } }, key: 'cal/event/x' })).toEqual({ refused: 'ungranted' });
    expect(rec.calls).toEqual([]);
    expect(await g.op('KvGet', { backend: 'user', key: 'cal/settings' })).toEqual({ ok: { value: null } });
    expect(rec.calls).toEqual([{ method: 'KvGet', args: { backend: 'user', key: 'cal/settings' } }]);
  });

  it("holds the app to a worker's host-call rate", async () => {
    const rec: Recorder = { calls: [] };
    const g: GlueInstance = glue({ log: fakeLog(rec) }, []);
    const answers: HostReply<null>[] = await Promise.all(Array.from({ length: STANDARD_HOST_POLICY.hostCallsPerSecond + 1 }, () => g.op('LogWrite', { level: 'info', message: 'm' })));
    expect(answers.filter((a) => 'refused' in a)).toEqual([{ refused: { limit: 'host_calls' } }]);
    expect(rec.calls).toHaveLength(STANDARD_HOST_POLICY.hostCallsPerSecond);
  });

  it('makes a server call past the rate wait its turn rather than be refused', async () => {
    const rec: Recorder = { calls: [] };
    const clock: ManualClock = new ManualClock();
    const g: GlueInstance = glue({ storage: fakeStorage(rec) }, ['storage.user'], clock);
    const rate: number = STANDARD_HOST_POLICY.serverCallsPerSecond;
    const pending: Promise<HostReply<KvValue>>[] = Array.from({ length: rate + 1 }, () => g.op('KvGet', { backend: 'user', key: 'k' }));
    await flush();
    expect(rec.calls).toHaveLength(rate);
    clock.advance(1000 / rate);
    const answers: HostReply<KvValue>[] = await Promise.all(pending);
    expect(answers.every((a) => 'ok' in a)).toBe(true);
    expect(rec.calls).toHaveLength(rate + 1);
  });

  it('reaches no port once closed', async () => {
    const rec: Recorder = { calls: [] };
    const g: GlueInstance = glue({ storage: fakeStorage(rec) }, ['storage.user']);
    g.close();
    expect(await g.op('KvGet', { backend: 'user', key: 'k' })).toEqual({ refused: { unavailable: 'closed' } });
    expect(rec.calls).toEqual([]);
  });
});
