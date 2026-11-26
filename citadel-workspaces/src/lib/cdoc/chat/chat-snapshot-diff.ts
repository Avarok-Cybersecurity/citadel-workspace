/**
 * The app's SnapshotDiff: a Citadel Docs runtime of its own (a worker, as a headless session
 * spawns one: collab/headless-sync.ts), one replica in it opened over the stored snapshot, its
 * diff against the caller's state vector, and both disposed. Never the shown document's
 * runtime: that one holds the shown replica, and opening another there replaces it. It runs only
 * when another window or view stored a snapshot this replica does not hold, so the cost of a
 * runtime is paid rarely. Loaded on first use, as the rest of Citadel Docs is.
 */
import type { EditorSession } from '../editor/editor-session';
import type { PictureAccess } from '../pictures/document-pictures';
import { loadCdocRuntime } from '../runtime-loader';
import type { CdocRuntime } from '../runtime';
import type { SnapshotDiff } from './chat-ports';

/** It is read for its edits only; nothing is drawn and no picture is fetched. */
const READ_ONLY: PictureAccess = { kind: 'none', reason: 'A stored copy is read here only for the edits it holds.' };

export const runtimeOfItsOwnDiff: SnapshotDiff = async (snapshot: Uint8Array, stateVector: Uint8Array): Promise<Uint8Array> => {
  const [runtime, { createEditorOpener }]: [CdocRuntime, typeof import('../editor/editor-opener')] = await Promise.all([loadCdocRuntime(), import('../editor/editor-opener')]);
  try {
    const replica: EditorSession = await createEditorOpener({ client: runtime.client, renderer: runtime.renderer, pictures: READ_ONLY }, (b: Uint8Array): Uint8Array => crypto.getRandomValues(b))({ kind: 'snapshot', snapshot });
    try {
      return await replica.encodeDiff(stateVector);
    } finally {
      replica.dispose();
    }
  } finally {
    runtime.client.dispose();
  }
};
