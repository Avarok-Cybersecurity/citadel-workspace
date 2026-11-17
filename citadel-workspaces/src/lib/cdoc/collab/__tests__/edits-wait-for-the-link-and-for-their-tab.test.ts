/**
 * Edits the server has not acknowledged wait without loss: with AutoSave on and the link down
 * they queue on this device and go on reconnect; a closed tab's are taken over by the next tab
 * to open the document, an open tab's are not; and edits the server refuses stay on the device,
 * said to be unsaved. Real replicas, the kernel double, the production device storage.
 */
import { describe, expect, it, vi } from 'vitest';
import { saveStatus, warnsOnUnload } from '@/lib/document-save/save-status';
import { indexedDbDocumentCache } from '../document-cache';
import { ALICE, BOB, converged, openTab } from './doubles/harness';
import { device, type Device, type RealTab } from './doubles/device-tabs';
import { realReplicas, snapshotText, typeInto } from './doubles/real-replicas';

const store: Map<string, unknown> = vi.hoisted((): Map<string, unknown> => new Map<string, unknown>());
vi.mock('@/lib/storage-utils', async () => (await import('./doubles/memory-storage')).memoryStorageUtils(store));

// Text no blank document holds: what these find was typed.
const FIRST: string = 'Kq7';
const SECOND: string = 'Vx9';
const heldKeys = (): string[] => [...store.keys()].filter((key: string): boolean => key.includes('#edits:'));

describe('with AutoSave on and the link down', () => {
  it('queues edits on this device, says so, and sends them when the link is back', async () => {
    store.clear();
    const d: Device = await device();
    const alice: RealTab = await d.open(ALICE, {});
    const bob: RealTab = await d.open(BOB, {});
    d.kernel.setLink(ALICE, 'down');
    await typeInto(alice.replica(), FIRST);
    await d.settle(alice, bob);
    expect(saveStatus(alice.session.saveInputs)).toBe('offline');
    expect(heldKeys()).toHaveLength(1);
    expect(await snapshotText(bob.replica())).not.toContain(FIRST);

    d.kernel.setLink(ALICE, 'up');
    await d.settle(alice, bob);
    expect(await snapshotText(bob.replica())).toContain(FIRST);
    expect(await converged([alice, bob])).toBe(true);
    expect(saveStatus(alice.session.saveInputs)).toBe('saved');
    expect(heldKeys()).toEqual([]);
  });
});

describe('a tab reopened with AutoSave on', () => {
  it('sends the edits a closed tab left behind as soon as it opens', async () => {
    store.clear();
    const d: Device = await device();
    const closed: RealTab = await d.open(ALICE, {});
    d.kernel.setLink(ALICE, 'down');
    await typeInto(closed.replica(), FIRST);
    await d.settle(closed);
    closed.session.close();
    d.kernel.setLink(ALICE, 'up');

    const reopened: RealTab = await d.open(ALICE, {});
    const bob: RealTab = await d.open(BOB, {});
    await d.settle(reopened, bob);
    expect(await snapshotText(bob.replica())).toContain(FIRST);
    expect(saveStatus(reopened.session.saveInputs)).toBe('saved');
    expect(heldKeys()).toEqual([]);
  });
});

describe('a document opened once on this device', () => {
  it('opens again with the link down, from this device, with what the server had acknowledged, and can be edited', async () => {
    store.clear();
    const d: Device = await device();
    const first: RealTab = await d.open(ALICE, {});
    await typeInto(first.replica(), FIRST);
    await d.settle(first);
    // The base is rewritten once the replica has been still (baseAfterIdleMs).
    d.clock.advance(2_000);
    await d.settle(first);
    first.session.close();

    const offline: RealTab = openTab(d.kernel, d.clock, ALICE, {}, realReplicas(), indexedDbDocumentCache(ALICE, d.locks));
    d.kernel.setLink(ALICE, 'down');
    await offline.session.open();
    await d.settle(offline);
    expect(offline.sources.map((s) => s.kind)).toEqual(['snapshot']);
    expect(await snapshotText(offline.replica())).toContain(FIRST);
    await typeInto(offline.replica(), SECOND);
    await d.settle(offline);
    expect(saveStatus(offline.session.saveInputs)).toBe('offline');

    d.kernel.setLink(ALICE, 'up');
    const bob: RealTab = await d.open(BOB, {});
    await d.settle(offline, bob);
    expect(await snapshotText(bob.replica())).toContain(SECOND);
    expect(await converged([offline, bob])).toBe(true);
  });
});

describe('two tabs of one account on one device', () => {
  it('a tab still open keeps its edits; once it closes, the next tab to open takes them over', async () => {
    store.clear();
    const d: Device = await device();
    const first: RealTab = await d.open(ALICE, { autoSaveWhenUnset: false });
    await typeInto(first.replica(), FIRST);
    await d.settle(first);

    const second: RealTab = await d.open(ALICE, { autoSaveWhenUnset: false });
    expect(await snapshotText(second.replica())).not.toContain(FIRST);
    expect(heldKeys()).toHaveLength(1);
    second.session.close();

    first.session.close();
    const third: RealTab = await d.open(ALICE, { autoSaveWhenUnset: false });
    expect(await snapshotText(third.replica())).toContain(FIRST);
    // Taken over: the closed tab's list is gone, the edits are held as the third tab's.
    expect(heldKeys()).toHaveLength(1);
    await third.session.save();
    await d.settle(third);
    expect(heldKeys()).toEqual([]);
    expect(third.problems).toEqual([]);
  });

  it('a tab that crashed (its lock released, never closed) leaves its edits to the next', async () => {
    store.clear();
    const d: Device = await device();
    const crashed: RealTab = await d.open(ALICE, { autoSaveWhenUnset: false });
    await typeInto(crashed.replica(), SECOND);
    await d.settle(crashed);
    const [key] = heldKeys();
    d.locks.drop(key);
    const next: RealTab = await d.open(ALICE, { autoSaveWhenUnset: false });
    expect(await snapshotText(next.replica())).toContain(SECOND);
  });
});

describe('edits the server will not take', () => {
  it('stay on this device, named refused, and warn on unload only while not yet written there', async () => {
    store.clear();
    const d: Device = await device();
    const alice: RealTab = await d.open(ALICE, { autoSaveWhenUnset: false });
    await typeInto(alice.replica(), FIRST);
    await d.settle(alice);
    d.kernel.deny(ALICE, 'EditMdx');
    await alice.session.save();
    await d.settle(alice);
    // One denial per refused Append, each named (the notice's toast id folds them into one).
    expect(new Set(alice.problems.map((p) => p.problem.kind))).toEqual(new Set(['permissionDenied']));
    expect(saveStatus(alice.session.saveInputs)).toBe('refused');
    expect(warnsOnUnload(alice.session.saveInputs)).toBe(false);
    expect(heldKeys()).toHaveLength(1);
  });
});
