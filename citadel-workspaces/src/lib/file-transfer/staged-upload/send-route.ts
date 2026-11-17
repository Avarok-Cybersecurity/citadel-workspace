/**
 * How a browser file reaches the agent, and the one ceiling that follows. Pure.
 *
 * An agent that stages uploads (its greeting says `stages_uploads`) takes the file in
 * acknowledged chunks, up to 2 GB. An older one takes it only inline, in one frame, up
 * to 16 MiB. Either way it is then sent over the Citadel file transfer. The dialog
 * shows `browserSendCeiling`, and nothing larger is ever announced or sent.
 */
import { formatBytes } from '@/lib/format-bytes';
import { MAX_BYTE_CONTENTS_BYTES } from '../server-upload';
import { STAGED_UPLOAD_CEILING_BYTES } from './chunk-plan';

export type BrowserSendRoute = 'staged' | 'inline';

export function browserSendRoute(stagesUploads: boolean): BrowserSendRoute {
  return stagesUploads ? 'staged' : 'inline';
}

export function browserSendCeiling(stagesUploads: boolean): number {
  return stagesUploads ? STAGED_UPLOAD_CEILING_BYTES : MAX_BYTE_CONTENTS_BYTES;
}

/**
 * Why `file` cannot be sent from this browser, or null when it can. Browse Files is
 * named only when `pickerAvailable` -- pointing at a button the dialog hides is a
 * dead end (UX review, finding 2).
 */
export function browserSendRefusal(file: Pick<File, 'name' | 'size'>, stagesUploads: boolean, pickerAvailable: boolean): string | null {
  if (file.size <= 0) return `"${file.name}" is empty. Files with no contents cannot be sent.`;
  const ceiling: number = browserSendCeiling(stagesUploads);
  if (file.size <= ceiling) return null;
  const update: string = stagesUploads ? '' : ' Updating your Citadel agent raises this to 2 GB.';
  const picker: string = pickerAvailable
    ? ' Larger files can be sent with Browse Files, which reads them from disk; they may need to raise "Max file size to accept" in their chat settings.'
    : '';
  return `"${file.name}" is ${formatBytes(file.size)}; files sent from the browser can be up to ${formatBytes(ceiling)}.${update}${picker}`;
}
