/**
 * Pure formatting helpers for file transfers.
 *
 * Split out of transfer-lifecycle so that file stays under the 250-line cap
 * once the receiver-side size check landed. These two depend on nothing and
 * are imported by both the lifecycle and the UI, so they belong on their own.
 */

export function getMimeType(fileName: string): string {
  const ext: string = fileName.split('.').pop()?.toLowerCase() || '';
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf', txt: 'text/plain',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    mp3: 'audio/mpeg', mp4: 'video/mp4', zip: 'application/zip',
    json: 'application/json', html: 'text/html', css: 'text/css', js: 'application/javascript',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

export { formatBytes } from '../format-bytes';
