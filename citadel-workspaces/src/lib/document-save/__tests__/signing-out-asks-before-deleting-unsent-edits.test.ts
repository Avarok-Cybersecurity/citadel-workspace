/**
 * A sign-out that would delete edits held only on this device asks first: with this tab able
 * to reach the server it offers to send them, and anything still held is deleted only on an
 * explicit yes. Production IO over the IndexedDB stand-in and the production sync registry;
 * the person's answers are scripted, and an open session's Save is a registered sync that
 * does what an acknowledged Save does to the device: removes the held edits.
 */
import { describe, expect, it, vi } from 'vitest';
import type { HeldEditsPrompt } from '../leave-held-edits-prompt';

const store: Map<string, unknown> = vi.hoisted((): Map<string, unknown> => new Map<string, unknown>());
vi.mock('@/lib/storage-utils', async () => (await import('@/lib/cdoc/collab/__tests__/doubles/memory-storage')).memoryStorageUtils(store));

const { mayLeaveAccountHeldEdits } = await import('../held-edits-io');
const { documentEditsKey, localRecordPut, localRecordRemove } = await import('@/lib/document-replica-cache');
const { registerDocumentSync } = await import('@/lib/document-sync-requests');
const { reconnectingTo } = await import('@/lib/reconnect/server-reconnect');

const ME: bigint = 7n;

async function holdEditsOf(nodeId: string): Promise<void> {
  await localRecordPut(documentEditsKey(ME, nodeId, 'tab-1'), [Uint8Array.from([1])]);
}

/** The person answers each prompt in turn; what they were asked is recorded. */
interface Person {
  readonly confirm: (prompt: HeldEditsPrompt) => Promise<boolean>;
  readonly asked: string[];
}

function answering(...answers: boolean[]): Person {
  const asked: string[] = [];
  return { asked, confirm: (prompt: HeldEditsPrompt): Promise<boolean> => { asked.push(prompt.confirmLabel); return Promise.resolve(answers.shift() ?? false); } };
}

/** An open session whose Save the server acknowledges: the held edits leave the device. */
const acknowledgingSave = (nodeId: string): (() => void) => registerDocumentSync({ nodeId, chatDoc: null }, (): Promise<void> => localRecordRemove(documentEditsKey(ME, nodeId, 'tab-1')));

describe('signing out with edits held on this device', () => {
  it('asks nothing when none are held', async () => {
    store.clear();
    const person: Person = answering();
    expect(await mayLeaveAccountHeldEdits(ME, true, person.confirm)).toBe(true);
    expect(person.asked).toEqual([]);
  });

  it('offers to send them, and goes ahead once they are sent', async () => {
    store.clear();
    await holdEditsOf('doc-a');
    const close: () => void = acknowledgingSave('doc-a');
    const person: Person = answering(true);
    expect(await mayLeaveAccountHeldEdits(ME, true, person.confirm)).toBe(true);
    expect(person.asked).toEqual(['Sync now']);
    close();
  });

  it('asks before deleting what could not be sent, and keeps the account signed in on a no', async () => {
    store.clear();
    await holdEditsOf('doc-b');
    const close: () => void = registerDocumentSync({ nodeId: 'doc-b', chatDoc: null }, (): Promise<void> => Promise.reject(new Error('the server refused the edits')));
    const declines: Person = answering(true, false);
    expect(await mayLeaveAccountHeldEdits(ME, true, declines.confirm)).toBe(false);
    expect(declines.asked).toEqual(['Sync now', 'Delete and sign out']);
    const deletes: Person = answering(true, true);
    expect(await mayLeaveAccountHeldEdits(ME, true, deletes.confirm)).toBe(true);
    close();
  });

  it('only asks about deleting them when this tab cannot send them: link down, or another account', async () => {
    store.clear();
    await holdEditsOf('doc-c');
    reconnectingTo.set('workspace.example:12349');
    const offline: Person = answering(false);
    expect(await mayLeaveAccountHeldEdits(ME, true, offline.confirm)).toBe(false);
    expect(offline.asked).toEqual(['Delete and sign out']);
    reconnectingTo.set(null);
    const another: Person = answering(true);
    expect(await mayLeaveAccountHeldEdits(ME, false, another.confirm)).toBe(true);
    expect(another.asked).toEqual(['Delete and sign out']);
  });

  it('asks about deleting them when the person would rather not send them', async () => {
    store.clear();
    await holdEditsOf('doc-d');
    const person: Person = answering(false, true);
    expect(await mayLeaveAccountHeldEdits(ME, true, person.confirm)).toBe(true);
    expect(person.asked).toEqual(['Sync now', 'Delete and sign out']);
  });
});
