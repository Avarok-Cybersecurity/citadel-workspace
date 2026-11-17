/**
 * A file on its way to the workspace server, as the person follows it: how much the server has
 * stored, then shared or refused. The progress comes from the server's chunk acknowledgements
 * (attachment-wire), never a timer, and a screen reader hears it in quarters, not per chunk.
 */
export type ServerUpload =
  | UploadingFile
  | { readonly kind: 'shared'; readonly name: string }
  | { readonly kind: 'refused'; readonly name: string; readonly reason: string };

export interface UploadingFile { readonly kind: 'uploading'; readonly name: string; readonly storedBytes: number; readonly totalBytes: number }

/** How often, in percent, an upload's progress is announced. */
const ANNOUNCE_EVERY_PERCENT: number = 25;

export function uploadPercent(upload: UploadingFile): number {
  return upload.totalBytes === 0 ? 100 : Math.floor((upload.storedBytes / upload.totalBytes) * 100);
}

function step(upload: UploadingFile): number {
  return Math.floor(uploadPercent(upload) / ANNOUNCE_EVERY_PERCENT) * ANNOUNCE_EVERY_PERCENT;
}

/** What to announce on moving from `previous` to `next`, or null when nothing worth saying changed. */
export function announcement(previous: ServerUpload | null, next: ServerUpload): string | null {
  if (next.kind === 'shared') return `${next.name} is shared with the channel`;
  if (next.kind === 'refused') return `${next.name} was not shared. ${next.reason}`;
  const reached: number = step(next);
  if (previous?.kind === 'uploading' && previous.name === next.name && previous.storedBytes <= next.storedBytes) {
    // All stored is not yet shared: the share that follows is the one announced.
    return reached === step(previous) || reached === 100 ? null : `${next.name}: ${reached} percent uploaded`;
  }
  return `Uploading ${next.name}`;
}
