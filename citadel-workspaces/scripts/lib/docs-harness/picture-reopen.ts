/**
 * `?pictures=reopen`: the owner's scenario on the shipped host. The document is kept as a
 * snapshot in this page's memory when it closes, and its pictures in an in-memory store, so
 * `window.docsHarnessReopen()` closes the document and opens it again in a fresh editor whose
 * image library is empty; `window.docsHarnessPictures` holds, fails or releases the store's
 * reads, so a check can see the loading and the not-available boxes (check-docs-pane-states.mjs).
 */
import type { EditorSession } from '@/lib/cdoc/editor/editor-session';
import type { EditorOrigin } from '@/lib/cdoc/editor/controller';
import type { ReplicaKeeper } from '@/components/documents/use-docs-document';
import type { PictureFailure } from '@/lib/cdoc/pictures/picture-port';
import type { MemoryPictures } from '@/lib/cdoc/pictures/__tests__/doubles/memory-pictures';

export interface HarnessPictures {
  hold(): void;
  release(): void;
  fail(failure: PictureFailure | null): void;
}

declare global {
  interface Window {
    docsHarnessReopen?: () => void;
    docsHarnessPictures?: HarnessPictures;
  }
}

/** A keeper that reopens from the snapshot its last close took (blank the first time), once that close is done. */
export function snapshotKeeper(): ReplicaKeeper {
  let kept: Uint8Array | null = null;
  let closed: Promise<void> = Promise.resolve();
  return (open: (from: EditorOrigin) => Promise<EditorSession>, show: (editor: EditorSession) => void, fail: (error: unknown) => void): (() => Promise<void>) => {
    let live: boolean = true;
    let held: EditorSession | null = null;
    closed.then(() => open(kept === null ? { kind: 'blank' } : { kind: 'snapshot', snapshot: kept })).then(
      (editor: EditorSession): void => {
        if (!live) return editor.dispose();
        held = editor;
        show(editor);
      },
      (error: unknown): void => { if (live) fail(error); },
    );
    return (): Promise<void> => {
      live = false;
      const editor: EditorSession | null = held;
      closed = (async (): Promise<void> => {
        if (editor === null) return;
        kept = await editor.snapshot();
        editor.dispose();
      })();
      return closed;
    };
  };
}

export function exposePictures(store: MemoryPictures): void {
  let release: (() => void) | null = null;
  window.docsHarnessPictures = {
    hold: (): void => { release = store.hold(); },
    release: (): void => { release?.(); release = null; },
    fail: (failure: PictureFailure | null): void => store.fail(failure),
  };
}
