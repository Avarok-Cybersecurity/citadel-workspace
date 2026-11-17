/**
 * The keeper for a document with no collaboration session: one blank replica, opened once and
 * disposed on teardown (or on arrival, when the page has gone first). Types only from cdoc, so
 * DocumentHost can pass it without pulling cdoc into the shell's bundle.
 */
import type { EditorSession } from '@/lib/cdoc/editor/editor-session';
import type { ReplicaKeeper } from './use-docs-document';

export const keepBlankReplica: ReplicaKeeper = (open, show, fail): (() => Promise<void>) => {
  let live: boolean = true;
  let held: EditorSession | null = null;
  open({ kind: 'blank' }).then(
    (editor: EditorSession): void => {
      if (!live) return editor.dispose();
      held = editor;
      show(editor);
    },
    (error: unknown): void => {
      if (live) fail(error);
    },
  );
  return async (): Promise<void> => {
    live = false;
    held?.dispose();
  };
};
