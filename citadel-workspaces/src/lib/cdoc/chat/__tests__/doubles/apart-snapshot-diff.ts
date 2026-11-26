/**
 * SnapshotDiff for tests: the production shape (a runtime of its own, one replica in it over the
 * snapshot, its diff, both gone) on the in-process runtime, because jsdom has no Worker for the
 * app's (chat-snapshot-diff.ts) to spawn.
 */
import { realReplicas } from '../../../collab/__tests__/doubles/real-replicas';
import type { EditorSession } from '../../../editor/editor-session';
import type { SnapshotDiff } from '../../chat-ports';

export const apartSnapshotDiff: SnapshotDiff = async (snapshot: Uint8Array, stateVector: Uint8Array): Promise<Uint8Array> => {
  const replica: EditorSession = await realReplicas().open({ kind: 'snapshot', snapshot });
  try {
    return await replica.encodeDiff(stateVector);
  } finally {
    replica.dispose();
  }
};
