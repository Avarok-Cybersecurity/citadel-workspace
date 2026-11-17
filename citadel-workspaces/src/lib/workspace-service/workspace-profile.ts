/**
 * Rename the workspace, describe it, or change its icon.
 *
 * Not UpdateWorkspace: that requires the workspace master password, the credential that also
 * claims and deletes the workspace. This is gated on Permission::UpdateWorkspace, so an owner or
 * admin can edit the workspace's settings without holding it.
 */
import type { WorkspaceLogoChange } from 'citadel-workspace-client-ts';
import type { WorkspaceProtocolRequestTS } from '@/types/workspace-protocol';
import type { ProtocolSender } from './workspace-operations';
import { awaitWriteResponse } from './await-write-response';
import { workspaceProfileIs } from './response-matchers';

/** What to change. An absent field is left as it is. */
export interface WorkspaceProfileChange {
  name?: string;
  description?: string;
  logo?: WorkspaceLogoChange;
}

export async function updateWorkspaceProfile(
  sender: ProtocolSender,
  workspaceId: string,
  change: WorkspaceProfileChange,
): Promise<void> {
  const requestPart: WorkspaceProtocolRequestTS = {
    UpdateWorkspaceProfile: { workspace_id: workspaceId, ...change },
  };
  // Resolves when the SERVER accepts it; a refusal rejects with the server's reason.
  return awaitWriteResponse(
    'UpdateWorkspaceProfile',
    () => sender.sendProtocolRequest(requestPart),
    workspaceProfileIs(workspaceId, change),
  );
}
