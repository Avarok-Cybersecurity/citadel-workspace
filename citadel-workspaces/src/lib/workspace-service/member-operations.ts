/**
 * Workspace Service - Member Operations
 *
 * Methods for member management: add, get, update, remove, list,
 * and permission management.
 */

import type { Permission, UpdateOperation, WorkspaceProtocolRequest } from 'citadel-workspace-client-ts';
import { workspaceResponseHandler } from '@/lib/workspace-response-handler';
import type { ProtocolSender } from './workspace-operations';
import { aboutMember } from './response-matchers';
import { awaitWriteResponse } from './await-write-response';
import { eventEmitter } from '@/lib/event-emitter';

/**
 * Tell the members surfaces to reload, once the server has actually accepted.
 *
 * `members:reload` used to be emitted only from response handlers for
 * `AddMember`, `RemoveMember` and `UpdateMemberRole` — response variants the
 * protocol does not have. They exist as REQUESTS only; the server answers with
 * `Success` and `MemberRoleUpdated`. So those branches were unreachable, and the
 * members list simply never refreshed after an admin added a member, removed
 * one, or changed a role.
 *
 * Emitted here instead, after `awaitWriteResponse` resolves — which is the point
 * at which the change is known to have happened, and the only place that knows
 * it.
 */
async function afterMemberWrite<T>(write: Promise<T>): Promise<T> {
  const result: T = await write;
  eventEmitter.emit('members:reload', undefined);
  return result;
}

/**
 * Add a member to a domain node
 */
export async function addMember(
  sender: ProtocolSender,
  userId: string,
  /** The id of a role in the workspace's table. */
  role: string,
  domainId?: string,
  metadata?: Uint8Array
): Promise<void> {
  const requestPart: WorkspaceProtocolRequest = {
    AddMember: {
      user_id: userId,
      domain_id: domainId ?? null,
      role,
      metadata: metadata ? Array.from(metadata) : null
    }
  };
  // Resolves when the SERVER accepts it. A refusal arrives as a response,
  // which cannot reject a send-only promise — so this used to report success
  // for writes the server was about to refuse.
  return afterMemberWrite(
    awaitWriteResponse('AddMember', sender, requestPart),
  );
}

/**
 * Get a member by ID
 */
export async function getMember(sender: ProtocolSender, userId: string): Promise<void> {
  const requestPart: WorkspaceProtocolRequest = {
    GetMember: { user_id: userId }
  };
  return sender.sendProtocolRequest(requestPart, null);
}

/**
 * Update a member's role
 */
export async function updateMemberRole(
  sender: ProtocolSender,
  userId: string,
  /** The id of a role in the workspace's table. */
  role: string,
  /**
   * Accepted, transmitted, and DISCARDED by the server.
   *
   * `update_workspace_member_role` in async_domain_server_ops.rs ends with
   * `if let Some(_metadata_bytes) = metadata { // TODO: Handle metadata updates
   * when needed }` — the bytes arrive and nothing reads them. No caller passes
   * this today, which is the only reason it has cost nothing.
   *
   * Left in place rather than removed because the protocol type carries it, but
   * said here so that passing it is a decision rather than an assumption: a
   * caller who supplies metadata gets a success response and no stored data.
   */
  metadata?: Uint8Array
): Promise<unknown> {
  const requestPart: WorkspaceProtocolRequest = {
    UpdateMemberRole: {
      user_id: userId,
      role,
      metadata: metadata ? Array.from(metadata) : null
    }
  };
  // Resolves when the SERVER accepts it. A refusal arrives as a response,
  // which cannot reject a send-only promise — so this used to report success
  // for writes the server was about to refuse.
  return afterMemberWrite(
    awaitWriteResponse(
      'UpdateMemberRole',
      sender, requestPart,
      aboutMember(userId),
    ),
  );
}

/**
 * Update a member's permissions
 */
export async function updateMemberPermissions(
  sender: ProtocolSender,
  userId: string,
  domainId: string,
  permissions: Permission[],
  operation: UpdateOperation
): Promise<void> {
  const requestPart: WorkspaceProtocolRequest = {
    UpdateMemberPermissions: {
      user_id: userId,
      domain_id: domainId ?? null,
      permissions,
      operation
    }
  };
  // Resolves when the SERVER accepts it. A refusal arrives as a response,
  // which cannot reject a send-only promise — so this used to report success
  // for writes the server was about to refuse.
  return awaitWriteResponse('UpdateMemberPermissions', sender, requestPart);
}

/**
 * Ban a member from the workspace, or lift their ban. Both are announced to the
 * workspace, so the answer is matched to the member it names.
 */
export async function setBanned(sender: ProtocolSender, userId: string, banned: boolean): Promise<unknown> {
  const requestPart: WorkspaceProtocolRequest = banned ? { Ban: { user_id: userId } } : { Unban: { user_id: userId } };
  return afterMemberWrite(
    awaitWriteResponse(banned ? 'Ban' : 'Unban', sender, requestPart, aboutMember(userId)),
  );
}

/**
 * Remove a member from a domain node
 */
export async function removeMember(
  sender: ProtocolSender,
  userId: string,
  domainId?: string
): Promise<void> {
  const requestPart: WorkspaceProtocolRequest = {
    RemoveMember: {
      user_id: userId,
      domain_id: domainId ?? null
    }
  };
  // Resolves when the SERVER accepts it. A refusal arrives as a response,
  // which cannot reject a send-only promise — so this used to report success
  // for writes the server was about to refuse.
  return afterMemberWrite(
    awaitWriteResponse('RemoveMember', sender, requestPart),
  );
}

/**
 * List members in a workspace or domain node
 */
export async function listMembers(sender: ProtocolSender, domainId?: string): Promise<void> {
  // Same dead-flag problem as ListNodes: nothing ever emitted 'members:loading',
  // so every member list rendered its empty state as a statement of fact while
  // the request was still on the wire.
  workspaceResponseHandler.emitLoadingEvent('members:loading', { domainId });
  const requestPart: WorkspaceProtocolRequest = {
    ListMembers: { domain_id: domainId ?? null }
  };
  return sender.sendProtocolRequest(requestPart, null);
}

/** Ask for every banned account; the answer arrives as `members:banned-loaded`. */
export async function listBanned(sender: ProtocolSender): Promise<void> {
  const requestPart: WorkspaceProtocolRequest = 'ListBanned';
  return sender.sendProtocolRequest(requestPart, null);
}

/**
 * Get a user's permissions for a specific domain
 */
export async function getUserPermissions(
  sender: ProtocolSender,
  userId: string,
  domainId: string
): Promise<void> {
  const requestPart: WorkspaceProtocolRequest = {
    GetUserPermissions: {
      user_id: userId,
      domain_id: domainId
    }
  };
  return sender.sendProtocolRequest(requestPart, null);
}
