/**
 * What a workspace-settings save sends: only the fields the owner changed.
 *
 * Unchanged fields stay out of the request. Sending the name back untouched would overwrite a
 * colleague's rename made while the dialog was open. The icon is checked against the server's
 * limit (citadel-workspace-server-kernel `workspace_logo.rs`), so an oversized one is explained
 * here rather than refused after the upload.
 */
import type { WorkspaceProfileChange } from '@/lib/workspace-service/workspace-profile';
import { avatarToDataUrl } from '@/lib/image-processor';

/** Decoded size the server accepts. */
export const MAX_ICON_BYTES: number = 32 * 1024;
/** The server's name limit (MAX_WORKSPACE_NAME_CHARS). */
export const MAX_NAME_CHARS: number = 64;
/** The server's description limit (MAX_WORKSPACE_DESCRIPTION_CHARS). */
export const MAX_DESCRIPTION_CHARS: number = 500;

export interface ProfileForm {
  name: string;
  description: string;
  /** A data URL or bare base64 (what the uploader emits), or null for no icon. */
  icon: string | null;
}

export type ProfileChangeResult = { ok: true; change: WorkspaceProfileChange | null } | { ok: false; reason: string };

const decodedBytes = (base64: string): number => Math.floor((base64.replace(/=+$/, '').length * 3) / 4);

export function profileChangeFrom(original: ProfileForm, edited: ProfileForm): ProfileChangeResult {
  const change: WorkspaceProfileChange = {};
  const name: string = edited.name.trim();
  if (name !== original.name.trim()) {
    if (name.length === 0) return { ok: false, reason: 'The workspace needs a name.' };
    change.name = name;
  }
  const description: string = edited.description.trim();
  if (description !== original.description.trim()) change.description = description;

  const icon: string | null = edited.icon === null ? null : avatarToDataUrl(edited.icon);
  if (icon !== original.icon) {
    if (icon === null) {
      change.logo = 'Clear';
    } else {
      if (decodedBytes(icon.slice(icon.indexOf(',') + 1)) > MAX_ICON_BYTES) {
        return { ok: false, reason: 'That icon is larger than 32 KB after resizing. Try a simpler image.' };
      }
      change.logo = { Set: { data_url: icon } };
    }
  }
  return { ok: true, change: Object.keys(change).length === 0 ? null : change };
}
