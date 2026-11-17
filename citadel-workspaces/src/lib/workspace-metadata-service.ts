/**
 * WorkspaceMetadataService
 * Handles extraction and processing of workspace metadata including logos
 */

import type { WorkspaceIcon } from '@/lib/theme/theme-types';
import { initialsOf } from '@/lib/initials';

// Interface for workspace logo information
export interface WorkspaceLogo {
  /** The uploaded icon, else the theme's emoji, else initials derived from the name. */
  type: 'image' | 'emoji' | 'initials';
  data: string;
}

/**
 * The workspace's logo: its uploaded icon (`workspaceLogoOf` the metadata), the theme's emoji, or
 * initials as a fallback -- in that order.
 */
export function getWorkspaceLogo(workspaceName: string, icon: WorkspaceIcon | undefined, image: string | null): WorkspaceLogo {
  if (image) return { type: 'image', data: image };
  if (icon?.emoji) return { type: 'emoji', data: icon.emoji };
  return { type: 'initials', data: getWorkspaceInitials(workspaceName) };
}

/**
 * Generate initials from workspace name
 * @param workspaceName The name of the workspace
 * @returns String containing the initials (1-2 characters)
 */
export function getWorkspaceInitials(workspaceName: string): string {
  return initialsOf(workspaceName);
}

/**
 * Generate initials from user's full name
 * @param fullName The full name of the user
 * @returns String containing the initials (1-2 characters)
 */
export function getUserInitials(fullName: string): string {
  return initialsOf(fullName);
}
