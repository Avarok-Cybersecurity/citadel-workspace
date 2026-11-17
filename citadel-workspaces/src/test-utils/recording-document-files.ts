/**
 * DocumentFiles for tests. The one double of the document view's I/O: jsdom has no Blob URLs
 * and no downloads, so `save` records what the browser adapter would have been handed (bytes,
 * MIME, name) instead of clicking an anchor. The clock is a fixed instant, stated.
 */
import type { DocumentFiles, SavedFile } from '@/lib/document-files';

export interface RecordingDocumentFiles extends DocumentFiles {
  readonly saved: SavedFile[];
}

export function recordingDocumentFiles(nowRfc3339: string): RecordingDocumentFiles {
  const saved: SavedFile[] = [];
  return {
    saved,
    save: (file: SavedFile): void => { saved.push(file); },
    nowRfc3339: (): string => nowRfc3339,
  };
}
