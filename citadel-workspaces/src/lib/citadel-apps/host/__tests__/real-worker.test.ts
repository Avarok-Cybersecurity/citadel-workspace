// @vitest-environment node
/**
 * The production worker entry in a real thread: its scrub really removes fetch and friends from
 * the global, and a guest frame that never returns is terminated by the handle's watchdog while a
 * frame that returns keeps running (the control).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Capability } from '../capabilities';
import { inspectArtifact, type LoadVerdict } from '../inspect';
import { launchAppInstance, type AppInstance, type Launch } from '../instance';
import { InstanceSlots } from '../instance-slots';
import { STANDARD_HOST_POLICY, validateHostPolicy, type HostPolicy } from '../limits';
import { appModule, FIXTURE_CLOSE_GRACE_MS, fixtureContext } from './app-fixtures';
import { realClock, until } from './in-process';
import { bundleWorkerEntry, PROBED, threadChannel, type BundledEntry, type ThreadChannel } from './real-worker';
import { op } from './wasm-builder';

let entry: BundledEntry;
beforeAll(async () => {
  entry = await bundleWorkerEntry();
}, 60_000);
afterAll(() => entry.dispose());

const BUDGET_MS: number = 300;
const policy: HostPolicy = validateHostPolicy({ ...STANDARD_HOST_POLICY, computeBudgetMs: BUDGET_MS });

async function start(bytes: Uint8Array): Promise<{ instance: AppInstance; channel: ThreadChannel }> {
  const verdict: LoadVerdict = await inspectArtifact(bytes, new Set<Capability>(), 16);
  if (!verdict.ok) throw new Error(verdict.reasons.join(', '));
  let channel: ThreadChannel | null = null;
  const launched: Launch = launchAppInstance({
    appId: 'com.acme.test', module: verdict.module, granted: new Set<Capability>(), context: fixtureContext([], FIXTURE_CLOSE_GRACE_MS), closeGraceMs: FIXTURE_CLOSE_GRACE_MS, pageUrl: 'https://work.avarok.net/',
    memory: { initialPages: 1, maxPages: 16 }, policy, limits: { topics: null, p2p: null }, ports: {}, clock: realClock, slots: new InstanceSlots(8),
    spawn: () => {
      channel = threadChannel(entry);
      return channel;
    },
  });
  if (!launched.ok || channel === null) throw new Error('launch failed');
  return { instance: launched.instance, channel };
}

describe('the scrub, in a real worker thread', () => {
  it('fetch and every other probed name is gone after the entry ran (and fetch was there before)', async () => {
    const { instance, channel } = await start(appModule());
    const probe: Awaited<ThreadChannel['probe']> = await channel.probe;
    expect(probe.before.fetch).toBe('function');
    expect(probe.before.BroadcastChannel).toBe('function');
    for (const name of PROBED) expect([name, probe.after[name]]).toEqual([name, 'undefined']);
    await until(() => instance.state === 'running', 5000);
    instance.terminate();
  }, 20_000);
});

describe('the watchdog, against a real thread', () => {
  it('a frame that never returns is terminated within the budget and the thread exits', async () => {
    const { instance, channel } = await start(appModule({ frame: op.spin }));
    await until(() => instance.state === 'running', 5000);
    expect(instance.start()).toBe(true);
    const sent: number = Date.now();
    instance.frame(16);
    await until(() => instance.state === 'stopped-unresponsive', 5000);
    const took: number = Date.now() - sent;
    expect(took).toBeGreaterThanOrEqual(BUDGET_MS - 20);
    expect(took).toBeLessThan(BUDGET_MS + 1500);
    await channel.exited;
  }, 20_000);

  it('control: a frame that returns keeps the instance running past the budget', async () => {
    const { instance } = await start(appModule({ frame: [] }));
    await until(() => instance.state === 'running', 5000);
    expect(instance.start()).toBe(true);
    for (let n: number = 0; n < 5; n++) instance.frame(16);
    await new Promise<void>((r) => setTimeout(r, BUDGET_MS * 2));
    expect(instance.state).toBe('running');
    instance.terminate();
  }, 20_000);
});
