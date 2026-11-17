/**
 * A fold cuts the pending updates where snapshot() was called: an edit recorded while the
 * snapshot is being taken stays pending, so a reopen (stored snapshot, then pending, in order)
 * still equals the live replica. Real replica; the snapshot is held open by the test to land
 * an edit inside it.
 */
import { describe, expect, it } from 'vitest';
import { ManualClock } from '../../collab/__tests__/doubles/manual-clock';
import { realReplicas } from '../../collab/__tests__/doubles/real-replicas';
import type { EditorSession } from '../../editor/editor-session';
import { CHAT_SYNC } from '../chat-config';
import { localDbChatStore } from '../chat-local-db';
import type { ChatStoreBackend, StoredBase } from '../chat-ports';
import type { ChatSyncProblem } from '../chat-problems';
import { ChatReplicaStore } from '../chat-replica-store';
import { ALICE, DOC } from './doubles/chat-pair';
import { FakeAgentLocalDb } from './doubles/fake-agent-local-db';

/** Runs `command` and resolves with the update it made. */
async function edit(editor: EditorSession, text: string): Promise<Uint8Array> {
  const made: Promise<Uint8Array> = new Promise<Uint8Array>((resolve: (u: Uint8Array) => void): void => {
    const off: () => void = editor.on('change', ({ update }: { readonly update: Uint8Array }): void => { off(); resolve(update); });
  });
  await editor.execute({ name: 'insertText', text });
  return made;
}

describe('a fold', () => {
  it('keeps pending the edit recorded while its snapshot was being taken', async () => {
    const live: EditorSession = await realReplicas().open({ kind: 'blank' });
    const backend: ChatStoreBackend = localDbChatStore(ALICE, new FakeAgentLocalDb().connection([ALICE]));
    const problems: ChatSyncProblem[] = [];
    let release: () => void = (): void => undefined;
    const held: Promise<void> = new Promise<void>((resolve: () => void): void => { release = resolve; });
    let inside: () => void = (): void => undefined;
    const snapshotting: Promise<void> = new Promise<void>((resolve: () => void): void => { inside = resolve; });
    const store: ChatReplicaStore = new ChatReplicaStore(backend, DOC, CHAT_SYNC, new ManualClock(), { baseStored: false, pending: [], migrationOrigin: null }, {
      snapshot: async (): Promise<Uint8Array> => {
        const bytes: Uint8Array = await live.snapshot();
        inside();
        await held;
        return bytes;
      },
      report: (problem: ChatSyncProblem): void => { problems.push(problem); },
    });
    store.added(await edit(live, 'before the fold'));
    const written: Promise<void> = store.write();
    await snapshotting;
    store.added(await edit(live, ', during it'));
    release();
    await written;
    await store.write();
    const base: StoredBase | null = await backend.loadBase(DOC);
    if (base === null) throw new Error('the fold stored no snapshot');
    const reopened: EditorSession = await realReplicas().open({ kind: 'snapshot', snapshot: base.snapshot });
    for (const update of await backend.loadPending(DOC)) await reopened.applyRemote(update);
    expect(Array.from(await reopened.snapshot())).toEqual(Array.from(await live.snapshot()));
    expect(problems).toEqual([]);
  });
});
