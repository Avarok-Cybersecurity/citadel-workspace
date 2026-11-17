/** The one line a shared file reads as wherever a message is shown as text: previews, notifications. */
import { formatBytes } from '@/lib/format-bytes';
import type { GroupFileInfo } from '@/types/group-file-share';

export function sharedFileText(file: GroupFileInfo): string {
  return `Shared a file: ${file.name} (${formatBytes(file.size)})`;
}
