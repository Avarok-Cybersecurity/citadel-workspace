/**
 * Workspace Service - Workspace Operations
 *
 * Methods for workspace CRUD: load, get, list, create, update.
 */

import { workspaceWithId, workspaceChangedTo } from './response-matchers';
import type { WorkspaceProtocolRequest } from 'citadel-workspace-client-ts';
import { workspaceResponseHandler } from '@/lib/workspace-response-handler';
import { debugLog } from '@/lib/debug-config';
import { awaitWriteResponse } from './await-write-response';

/** Interface matching WorkspaceService's protocol-send method */
export interface ProtocolSender {
  sendProtocolRequest(request: WorkspaceProtocolRequest): Promise<void>;
  readonly currentCid: bigint | null;
}

/**
 * Load workspace data.
 * Triggers a workspace:loaded event when complete.
 */
export async function loadWorkspace(sender: ProtocolSender): Promise<void> {
  debugLog('WorkspaceService', '[WorkspaceService] loadWorkspace called with CID:', sender.currentCid?.toString());
  workspaceResponseHandler.emitLoadingEvent('workspace:loading');
  const requestPart: WorkspaceProtocolRequest = { GetWorkspace: { workspace_id: null } };
  debugLog('WorkspaceService', '[WorkspaceService] Sending GetWorkspace request');
  return sender.sendProtocolRequest(requestPart);
}

/**
 * Get a workspace by ID (defaults to sentinel root workspace)
 */
export async function getWorkspace(sender: ProtocolSender, workspaceId?: string): Promise<void> {
  const requestPart: WorkspaceProtocolRequest = {
    GetWorkspace: { workspace_id: workspaceId ?? null }
  };
  return sender.sendProtocolRequest(requestPart);
}

/**
 * List all workspaces the current user has access to
 */
export async function listWorkspaces(sender: ProtocolSender): Promise<void> {
  const requestPart: WorkspaceProtocolRequest = 'ListWorkspaces';
  return sender.sendProtocolRequest(requestPart);
}

/**
 * Create a new workspace
 */
export async function createWorkspace(
  sender: ProtocolSender,
  name: string,
  description: string,
  masterPassword: string,
  metadata?: Uint8Array
): Promise<void> {
  const requestPart: WorkspaceProtocolRequest = {
    CreateWorkspace: {
      name,
      description,
      workspace_master_password: masterPassword,
      metadata: metadata ?? null
    }
  };
  // Same reasoning as updateWorkspace: a refusal arrives as a response and
  // cannot reject a send-only promise.
  // The new workspace's id is not known yet, so this matches the name it is
  // being created with -- the same compromise `newChildOf` makes for nodes.
  return awaitWriteResponse(
    'CreateWorkspace',
    () => sender.sendProtocolRequest(requestPart),
    workspaceChangedTo({ name }),
  );
}

/**
 * Update an existing workspace
 */
/**
 * Set the workspace theme.
 *
 * Deliberately NOT UpdateWorkspace: that requires the workspace master password,
 * which is the right gate for renaming or deleting a workspace and the wrong one
 * for changing a colour. This is gated on Permission::Themes, so an authorised
 * member can restyle the workspace without holding the credential that lets them
 * destroy it.
 */
export async function updateWorkspaceTheme(
  sender: ProtocolSender,
  theme: Uint8Array,
  workspaceId?: string,
): Promise<void> {
  const requestPart: WorkspaceProtocolRequest = {
    UpdateWorkspaceTheme: {
      workspace_id: workspaceId ?? null,
      theme,
    },
  };
  // Resolves when the SERVER accepts it. A refusal arrives as a response,
  // which cannot reject a send-only promise — so this used to report success
  // for writes the server was about to refuse.
  // Narrowed by id where one was given: `Workspace` is answered by
  // `GetWorkspace` and broadcast to the other members, so without this a
  // concurrent read or a colleague's save resolves this write.
  return awaitWriteResponse(
    'UpdateWorkspaceTheme',
    () => sender.sendProtocolRequest(requestPart),
    workspaceId === undefined ? undefined : workspaceWithId(workspaceId),
  );
}

export async function updateWorkspace(
  sender: ProtocolSender,
  name: string | undefined,
  description: string | undefined,
  masterPassword: string,
  metadata?: Uint8Array
): Promise<void> {
  const requestPart: WorkspaceProtocolRequest = {
    UpdateWorkspace: {
      workspace_id: null,
      name: name ?? null,
      description: description ?? null,
      workspace_master_password: masterPassword,
      metadata: metadata ?? null
    }
  };
  // A refusal (no permission, wrong master password) arrives as a response,
  // which cannot reject a send-only promise — so GeneralTab toasted "updated
  // successfully" and cleared its dirty flag for a rename the server rejected.
  // Narrowed by what this request CHANGES. A concurrent `GetWorkspace` answers
  // with the workspace as it is now -- the value being replaced -- so the
  // answer carrying the new name is ours and the one carrying the old name is
  // not. See `workspaceChangedTo`.
  return awaitWriteResponse(
    'UpdateWorkspace',
    () => sender.sendProtocolRequest(requestPart),
    workspaceChangedTo({ name, description }),
  );
}
