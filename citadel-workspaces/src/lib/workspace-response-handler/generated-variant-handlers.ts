/**
 * Responses that map directly to a generated protocol variant.
 *
 * Split from workspace-handlers so that file keeps the string and type-gap
 * responses, whose shapes are hand-maintained, and these stay together as
 * plain forwarding.
 */

import { eventEmitter } from '@/lib/event-emitter';
import { debugLog } from '@/lib/debug-config';
import { isVariant , type SignInSettings, type WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';
import type { ConnectionInfo } from './workspace-handlers';
import { mapWasmMember } from './member-mapping';
import { membershipChanged } from './membership-change';
import { recordPresenceChoices } from '@/lib/published-presence';
import type { MappedMember } from '@/lib/workspace-response-handler/member-mapping';
import { DOCUMENTS_EVENT, documentsEventOf, type DocumentsEvent } from './documents-event';
import { emitChatAttachments } from './chat-attachments-event';
import { emitMembers } from './members-event';

export function handleGeneratedVariants(
  response: WorkspaceProtocolResponse,
  connectionInfo: ConnectionInfo,
): boolean {
  if (isVariant(response, 'Workspaces')) {
    // Handled, not forwarded. `workspaces:listed` had exactly one subscriber,
    // which wrote the list into `state.workspaces` -- a field nothing in the
    // tree ever read. The subscriber and the field are gone, so emitting to
    // nobody would just be the same dead weight with an extra hop; the guard
    // that flags an unheard emit is what caught it.
    //
    // Still returns true: the variant IS handled, and saying otherwise would
    // make a caller awaiting confirmation wait out its timeout.
    return true;
  }

  if (isVariant(response, 'Workspace')) {
    eventEmitter.emit('workspace:loaded', {
      workspace: {
        id: response.Workspace.id,
        name: response.Workspace.name,
        description: response.Workspace.description,
        metadata: response.Workspace.metadata || [],
      },
      connection: connectionInfo,
    });
    // Someone joined or left: the rosters on screen re-read (membership-change.ts).
    if (membershipChanged(response.Workspace.id, response.Workspace.members)) {
      eventEmitter.emit('members:reload', undefined);
    }
    // Also raw, so a caller awaiting confirmation can see it.
    //
    // `Success` and `Error` emit this; the handled variants did not — they
    // returned true and the response ended there. So every write gated on THIS
    // variant waited out its 15s timeout and told the user "the change may not
    // have been saved", after the same handler had already applied it. The
    // action worked, and the app said it had not.
    eventEmitter.emit('workspace:raw-response', response);
    return true;
  }

  if (emitMembers(response, connectionInfo)) return true;

  // Hidden by an admin ("Members can see each other" off here or above). Its
  // own event: an empty `members:loaded` would render "Nobody else is here yet".
  if (isVariant(response, 'MembersHidden')) {
    eventEmitter.emit('members:hidden', { domainId: response.MembersHidden.domain_id, connection: connectionInfo });
    return true;
  }

  if (isVariant(response, 'Member')) {
    const mappedMember: MappedMember = mapWasmMember(response.Member as Record<string, unknown>);
    recordPresenceChoices([mappedMember]);
    eventEmitter.emit('member:loaded', {
      member: mappedMember, connection: connectionInfo,
    });
    return true;
  }

  if (isVariant(response, 'Success')) {
    eventEmitter.emit('operation:success', connectionInfo);
    if (response.Success.includes('deleted')) {
      eventEmitter.emit('operation:deleted', connectionInfo);
    }
    eventEmitter.emit('workspace:raw-response', response);
    return true;
  }

  if (isVariant(response, 'Error')) {
    eventEmitter.emit('operation:error', { message: response.Error, connection: connectionInfo });
    eventEmitter.emit('workspace:raw-response', response);
    return true;
  }

  if (isVariant(response, 'ServerShutdown')) {
    // Distinct from `Error` so the UI can show a reconnect notice rather
    // than a red toast on a planned restart.
    const { message, drain_seconds } = response.ServerShutdown;
    debugLog('WorkspaceResponseHandler', 'ServerShutdown received', {
      message,
      drain_seconds: drain_seconds.toString(),
    });
    eventEmitter.emit('server:shutdown', {
      message,
      drainSeconds: Number(drain_seconds),
      connection: connectionInfo,
    });
    return true;
  }

  if (isVariant(response, 'UserPermissions')) {
    const { user_id, role, role_id, permissions, domain_id } = response.UserPermissions;
    debugLog('WorkspaceResponseHandler', 'UserPermissions received', { user_id, role_id, domain_id });
    // `?? null`: an absent Option arrives from WASM as undefined, not null.
    eventEmitter.emit('user:permissions:loaded', {
      userId: user_id, role, roleId: role_id ?? null, permissions, domainId: domain_id, connection: connectionInfo,
    });
    return true;
  }

  if (isVariant(response, 'MemberRoleUpdated')) {
    const { user_id, new_role, role_id } = response.MemberRoleUpdated;
    debugLog('WorkspaceResponseHandler', 'MemberRoleUpdated received', { user_id, role_id });
    eventEmitter.emit('member:role-updated', {
      userId: user_id, role: new_role, roleId: role_id ?? null, connection: connectionInfo,
    });
    // Also raw, so a caller awaiting confirmation can see it.
    //
    // `Success` and `Error` emit this; the handled variants did not — they
    // returned true and the response ended there. So every write gated on THIS
    // variant waited out its 15s timeout and told the user "the change may not
    // have been saved", after the same handler had already applied it. The
    // action worked, and the app said it had not.
    eventEmitter.emit('workspace:raw-response', response);
    return true;
  }

  if (isVariant(response, 'UserProfileUpdated')) {
    const user: Extract<WorkspaceProtocolResponse, { UserProfileUpdated: unknown }>['UserProfileUpdated'] = response.UserProfileUpdated;
    debugLog('WorkspaceResponseHandler', 'UserProfileUpdated received', {
      userId: user.id, name: user.name,
    });
    eventEmitter.emit('user:profile-updated', { user, connection: connectionInfo });
    // Raw as well, so a caller awaiting confirmation can see it. A handled
    // variant that returns true without this leaves every write gated on it
    // waiting out the 15s timeout and telling the user the change may not have
    // saved — after this handler already applied it.
    eventEmitter.emit('workspace:raw-response', response);
    return true;
  }

  if (isVariant(response, 'ServerCapabilities')) {
    const caps: Extract<WorkspaceProtocolResponse, { ServerCapabilities: unknown }>['ServerCapabilities'] = response.ServerCapabilities;
    debugLog('WorkspaceResponseHandler', 'ServerCapabilities received', caps);
    eventEmitter.emit('server:capabilities:loaded', {
      allowServerFileTransfer: caps.allow_server_file_transfer,
      allowServerRevfsStorage: caps.allow_server_revfs_storage,
      maxFileTransferSizeMb: Number(caps.max_file_transfer_size_mb),
      revfsStorageQuotaMb: Number(caps.revfs_storage_quota_mb),
      // Absent from the wire arrives as undefined (serde-wasm-bindgen); null here, said once.
      revfsStorageRefusal: caps.revfs_storage_refusal ?? null,
      connection: connectionInfo,
    });
    return true;
  }

  if (isVariant(response, 'SignInSettings')) {
    const settings: SignInSettings = response.SignInSettings;
    debugLog('WorkspaceResponseHandler', 'SignInSettings received', settings);
    eventEmitter.emit('workspace:sign-in-settings', { settings, connection: connectionInfo });
    // Raw too: GetSignInSettings and UpdateSignInSettings are gated on this variant.
    eventEmitter.emit('workspace:raw-response', response);
    return true;
  }

  if (isVariant(response, 'Telemetry')) {
    // Not logged here: its records are other people's diagnostic lines. The requests in
    // telemetry-operations.ts wait on the raw event.
    eventEmitter.emit('workspace:telemetry', { answer: response.Telemetry, connection: connectionInfo });
    eventEmitter.emit('workspace:raw-response', response);
    return true;
  }

  if (isVariant(response, 'MessagingTrust')) {
    // The settings screens follow it (messaging-trust/settings-feed.ts); the requests in
    // messaging-trust-operations.ts wait on the raw event for their own answer.
    eventEmitter.emit('workspace:messaging-trust', { answer: response.MessagingTrust, connection: connectionInfo });
    eventEmitter.emit('workspace:raw-response', response);
    return true;
  }

  const documents: DocumentsEvent | null = documentsEventOf(response);
  if (documents !== null) {
    // Answers and pushes for open documents, pages' and chat documents' (cdoc/collab/documents-transport.ts).
    // Not raw and not logged: no write here waits on a type match, and the bytes are the document.
    eventEmitter.emit(DOCUMENTS_EVENT, documents);
    return true;
  }

  if (emitChatAttachments(response)) return true;

  if (isVariant(response, 'Roles')) {
    // The table, listed or changed: the store replaces its copy (workspace-roles/roles-store.ts),
    // and the requests in roles-operations.ts wait on the raw event for their own answer.
    eventEmitter.emit('workspace:roles', { answer: response.Roles, connection: connectionInfo });
    eventEmitter.emit('workspace:raw-response', response);
    return true;
  }

  if (isVariant(response, 'SecureLinks')) {
    // Not logged: a Created or Regenerated answer carries the only copy of a link's token.
    // The Security list follows it (share/use-secure-links.ts); secure-links-operations.ts waits
    // on the raw event for its own answer.
    eventEmitter.emit('workspace:secure-links', { answer: response.SecureLinks });
    eventEmitter.emit('workspace:raw-response', response);
    return true;
  }

  return false;
}
