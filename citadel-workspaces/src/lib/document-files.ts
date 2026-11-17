/**
 * The I/O a document view does on the person's behalf, as one port: handing them a file to
 * save, and the time a written file records. The browser adapter is the only implementation
 * in the product; the bytes go into a Blob as they are, never through a string.
 */
export interface SavedFile {
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly name: string;
}

export interface DocumentFiles {
  /** Offers `file` to the person as a download. */
  save(file: SavedFile): void;
  /** Now, as RFC 3339, for formats that record when they were written (PDF). */
  nowRfc3339(): string;
}

/**
 * How long a download's object URL outlives the click. Revoking it at once can cancel the
 * download in WebKit; FileSaver.js settled on 40 s for the same reason.
 */
const OBJECT_URL_LIFETIME_MS: number = 40_000;

/** Offers `blob` to the person as a download named `name`: the app's one download anchor. */
export function downloadBlob(blob: Blob, name: string): void {
  const url: string = URL.createObjectURL(blob);
  const anchor: HTMLAnchorElement = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout((): void => URL.revokeObjectURL(url), OBJECT_URL_LIFETIME_MS);
}

export const browserDocumentFiles: DocumentFiles = {
  save(file: SavedFile): void {
    downloadBlob(new Blob([file.bytes.slice().buffer], { type: file.mime }), file.name);
  },
  nowRfc3339(): string {
    return new Date().toISOString();
  },
};
