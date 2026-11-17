import { useEffect } from 'react';
import { warnLog } from '@/lib/debug-config';

/**
 * Runs the chat-document migration's background sweep while a signed-in layout is mounted.
 * The migration loads by dynamic import, after first paint, so none of it is on any page's
 * critical path; unmounting stops the sweep between documents.
 */
export function useLiveDocMigrationSweep(): void {
  useEffect((): (() => void) => {
    let live: boolean = true;
    let stop: (() => void) | null = null;
    import('@/lib/live-doc-migration/boot')
      .then(({ chatDocumentMigration }: typeof import('@/lib/live-doc-migration/boot')): void => {
        if (live) stop = chatDocumentMigration.startSweep();
      })
      .catch((error: unknown): void => warnLog('LiveDocMigration', 'The migration could not load.', error));
    return (): void => {
      live = false;
      stop?.();
    };
  }, []);
}
