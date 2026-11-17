/**
 * A document shared while no tab here has it open: the edits closed tabs left on this device
 * are sent by a session opened for that alone, and stay held when the server does not
 * acknowledge them in time; with none held, nothing is loaded. The production headless sync,
 * real replicas, the kernel double and the production device storage. The registry's other
 * half (an open session's Save) is sharing-a-document-sends-its-held-edits.test.tsx's.
 */
import { describe, expect, it, vi } from 'vitest';
import { indexedDbDocumentCache } from '../document-cache';
import { syncHeldEdits, type HeadlessOutcome, type HeadlessSession } from '../headless-sync';
import { ALICE, BOB, NODE, openTab } from './doubles/harness';
import { device, type Device, type RealTab } from './doubles/device-tabs';
import { realReplicas, snapshotText, typeInto } from './doubles/real-replicas';

const store: Map<string, unknown> = vi.hoisted((): Map<string, unknown> => new Map<string, unknown>());
vi.mock('@/lib/storage-utils', async () => (await import('./doubles/memory-storage')).memoryStorageUtils(store));

const HELD: string = 'Kq7';
const TIMEOUT_MS: number = 10_000;
const heldKeys = (): string[] => [...store.keys()].filter((key: string): boolean => key.includes('#edits:'));

/** Alice typed with AutoSave off, then closed the document. */
async function editsLeftBehind(d: Device): Promise<void> {
  const alice: RealTab = await d.open(ALICE, { autoSaveWhenUnset: false });
  await typeInto(alice.replica(), HELD);
  await d.settle(alice);
  alice.session.close();
}

function headless(d: Device, started: RealTab[]): () => Promise<HeadlessSession> {
  return (): Promise<HeadlessSession> => {
    const tab: RealTab = openTab(d.kernel, d.clock, ALICE, { autoSaveWhenUnset: false }, realReplicas(), indexedDbDocumentCache(ALICE, d.locks));
    started.push(tab);
    return Promise.resolve({ session: tab.session, release: (): void => { for (const r of tab.replicas) r.dispose(); } });
  };
}

/** Runs the sync while the kernel delivers, as the network would. */
async function syncing(d: Device, started: RealTab[], others: RealTab[]): Promise<HeadlessOutcome> {
  const outcome: Promise<HeadlessOutcome> = syncHeldEdits(NODE, indexedDbDocumentCache(ALICE, d.locks), headless(d, started), d.clock, TIMEOUT_MS);
  for (let round: number = 0; round < 50; round += 1) {
    await d.settle(...started, ...others);
    const settled: HeadlessOutcome | null = await Promise.race([outcome, Promise.resolve(null)]);
    if (settled !== null) return settled;
  }
  return outcome;
}

describe('a share with no tab open on the document', () => {
  it('sends the edits closed tabs left, and the other person sees them', async () => {
    store.clear();
    const d: Device = await device();
    await editsLeftBehind(d);
    const bob: RealTab = await d.open(BOB, {});
    const started: RealTab[] = [];
    expect(await syncing(d, started, [bob])).toBe('synced');
    expect(started).toHaveLength(1);
    expect(await snapshotText(bob.replica())).toContain(HELD);
    expect(heldKeys()).toEqual([]);
  });

  it('opens nothing when no edits are held', async () => {
    store.clear();
    const d: Device = await device();
    const started: RealTab[] = [];
    expect(await syncing(d, started, [])).toBe('nothingHeld');
    expect(started).toEqual([]);
  });

  it('keeps the edits on this device when the server does not acknowledge them in time', async () => {
    store.clear();
    const d: Device = await device();
    await editsLeftBehind(d);
    // The server refuses the writes: nothing it does not take is ever removed from here.
    d.kernel.deny(ALICE, 'EditMdx');
    const started: RealTab[] = [];
    const outcome: Promise<HeadlessOutcome> = syncHeldEdits(NODE, indexedDbDocumentCache(ALICE, d.locks), headless(d, started), d.clock, TIMEOUT_MS);
    await vi.waitFor((): void => expect(started).toHaveLength(1));
    await d.settle(...started);
    d.clock.advance(TIMEOUT_MS);
    expect(await outcome).toBe('stillHeld');
    expect(heldKeys()).toHaveLength(1);
  });
});
