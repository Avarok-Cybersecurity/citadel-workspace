/**
 * With AutoSave off a document's edits stay on this device, sent at Save or when AutoSave is
 * turned on and at no other time, and a reload loses none of them. Real replicas, the kernel
 * double, and the production device storage (doubles/device-tabs.ts).
 */
import { describe, expect, it, vi } from 'vitest';
import { saveStatus } from '@/lib/document-save/save-status';
import { ALICE, BOB, converged } from './doubles/harness';
import { device, type Device, type RealTab } from './doubles/device-tabs';
import { snapshotText, typeInto } from './doubles/real-replicas';

const store: Map<string, unknown> = vi.hoisted((): Map<string, unknown> => new Map<string, unknown>());
vi.mock('@/lib/storage-utils', async () => (await import('./doubles/memory-storage')).memoryStorageUtils(store));

// Text no blank document holds (its snapshot carries "a", "ab", "tab"…): what these find was typed.
const MINE: string = 'Kq7';
const LATER: string = 'Vx9';

const heldKeys = (): string[] => [...store.keys()].filter((key: string): boolean => key.includes('#edits:'));

/** Alice, with AutoSave turned off on this device (remembered, as the switch does). */
async function aliceOffline(d: Device): Promise<RealTab> {
  const alice: RealTab = await d.open(ALICE, {});
  await alice.session.setAutoSave(false);
  return alice;
}

describe('a document with AutoSave off', () => {
  it('keeps edits on this device and sends none: not over time, not across a link drop', async () => {
    store.clear();
    const d: Device = await device();
    const alice: RealTab = await aliceOffline(d);
    await typeInto(alice.replica(), MINE);
    await d.settle(alice);
    d.clock.advance(120_000);
    d.kernel.setLink(ALICE, 'down');
    d.kernel.setLink(ALICE, 'up');
    await d.settle(alice);
    expect(d.appendsOf(ALICE)).toBe(0);
    expect(saveStatus(alice.session.saveInputs)).toBe('savedToDevice');
    expect(heldKeys()).toHaveLength(1);
    expect(alice.problems).toEqual([]);
  });

  it('survives a reload: the next tab opens with the edits, still off, and Save sends them to the other person', async () => {
    store.clear();
    const d: Device = await device();
    const alice: RealTab = await aliceOffline(d);
    // Open long enough for this device to keep a base copy (baseAfterIdleMs), as any open document is.
    d.clock.advance(2_000);
    await d.settle(alice);
    await typeInto(alice.replica(), MINE);
    await d.settle(alice);
    alice.session.close();

    const reloaded: RealTab = await d.open(ALICE, {});
    const bob: RealTab = await d.open(BOB, {});
    // Opened once, from this device: the edits are in it because they were applied over the base.
    expect(reloaded.sources.map((s) => s.kind)).toEqual(['snapshot']);
    expect(await snapshotText(reloaded.replica())).toContain(MINE);
    expect(reloaded.session.saveInputs.autoSave).toBe(false);
    expect(saveStatus(reloaded.session.saveInputs)).toBe('savedToDevice');
    expect(await snapshotText(bob.replica())).not.toContain(MINE);

    await reloaded.session.save();
    await d.settle(reloaded, bob);
    expect(await snapshotText(bob.replica())).toContain(MINE);
    expect(await converged([reloaded, bob])).toBe(true);
    expect(saveStatus(reloaded.session.saveInputs)).toBe('saved');
    expect(heldKeys()).toEqual([]);
    expect([...reloaded.problems, ...bob.problems]).toEqual([]);
  });

  it('sends at Save only what was made before it; the rest waits for the next Save', async () => {
    store.clear();
    const d: Device = await device();
    const alice: RealTab = await aliceOffline(d);
    const bob: RealTab = await d.open(BOB, {});
    await typeInto(alice.replica(), MINE);
    await alice.session.save();
    await typeInto(alice.replica(), LATER);
    await d.settle(alice, bob);
    expect(d.appendsOf(ALICE)).toBe(MINE.length);
    expect(saveStatus(alice.session.saveInputs)).toBe('savedToDevice');
    expect(await snapshotText(bob.replica())).toContain(MINE);
    expect(await snapshotText(bob.replica())).not.toContain(LATER);
  });

  it('sends everything held when AutoSave is turned on, and each edit as it is made from then on', async () => {
    store.clear();
    const d: Device = await device();
    const alice: RealTab = await aliceOffline(d);
    const bob: RealTab = await d.open(BOB, {});
    await typeInto(alice.replica(), MINE);
    await d.settle(alice, bob);
    expect(d.appendsOf(ALICE)).toBe(0);
    await alice.session.setAutoSave(true);
    await d.settle(alice, bob);
    expect(d.appendsOf(ALICE)).toBe(MINE.length);
    await typeInto(alice.replica(), LATER);
    await d.settle(alice, bob);
    expect(d.appendsOf(ALICE)).toBe(MINE.length + LATER.length);
    expect(await converged([alice, bob])).toBe(true);
    expect(saveStatus(alice.session.saveInputs)).toBe('saved');
  });

  it('still takes in the other person\'s edits, and the two converge once Saved', async () => {
    store.clear();
    const d: Device = await device();
    const alice: RealTab = await aliceOffline(d);
    const bob: RealTab = await d.open(BOB, {});
    await typeInto(alice.replica(), MINE);
    await typeInto(bob.replica(), LATER);
    await d.settle(alice, bob);
    expect(await snapshotText(alice.replica())).toContain(LATER);
    expect(await snapshotText(bob.replica())).not.toContain(MINE);
    await alice.session.save();
    await d.settle(alice, bob);
    expect(await converged([alice, bob])).toBe(true);
  });

  it('sends no awareness, so nobody sees where the unsent edits are, and does again once on', async () => {
    store.clear();
    const d: Device = await device();
    const alice: RealTab = await d.open(ALICE, { autoSaveWhenUnset: false });
    const awarenessOf = (): number => d.kernel.sentOf('Awareness').filter((r: { cid: bigint }): boolean => r.cid === ALICE).length;
    await typeInto(alice.replica(), MINE);
    d.clock.advance(30_000);
    await d.settle(alice);
    expect(awarenessOf()).toBe(0);
    await alice.session.setAutoSave(true);
    await d.settle(alice);
    expect(awarenessOf()).toBeGreaterThan(0);
  });
});
