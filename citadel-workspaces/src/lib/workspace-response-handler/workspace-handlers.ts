/**
 * Workspace / member response handlers: workspace CRUD, members, permissions,
 * success/error and server capabilities. Tree nodes go to node-handlers.ts.
 */

import { eventEmitter } from '@/lib/event-emitter';
import { handleGeneratedVariants } from './generated-variant-handlers';
import { debugLog } from '@/lib/debug-config';
import type { WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';

import { handleNodeVariants } from './node-handlers';

// Re-exported for callers that import via this module's public surface.
export { mapWasmMember, type MappedMember } from './member-mapping';

/** Minimal connection context attached to every emitted event. */
export interface ConnectionInfo {
  cid: number;
  request_id: string;
}


export function buildConnectionInfo(): ConnectionInfo {
  return {
    cid: 0,
    request_id: crypto.randomUUID(),
  };
}

/**
 * Try to handle workspace, member, node, permission, success/error, and
 * server-capabilities response variants.
 *
 * Returns `true` if the response was handled.
 */
export function handleWorkspaceVariants(
  response: WorkspaceProtocolResponse,
  connectionInfo: ConnectionInfo,
): boolean {
  // --- String literal responses (e.g. "WorkspaceNotInitialized") ---
  if (typeof response === 'string') {
    return handleStringResponse(response, connectionInfo);
  }

  // Generated-type variants checked via isVariant()
  if (handleGeneratedVariants(response, connectionInfo)) return true;

  // Tree node variants (delegated)
  if (handleNodeVariants(response, connectionInfo)) return true;

  // Citadel Apps, read by key: the kernel's `WorkspaceProtocolResponse::Apps` arrives with its apps
  // handler, before the generated type names it. apps-operations.ts waits on the raw event for its
  // own answer and reads it strictly (citadel-apps/wire/apps-answer.ts); `workspace:apps` carries
  // the answer, unread, for whatever follows installs as they change.
  if ('Apps' in response) {
    eventEmitter.emit('workspace:apps', { answer: (response as { Apps: unknown }).Apps });
    eventEmitter.emit('workspace:raw-response', response);
    return true;
  }

  return false;
}

// ─── String Literals ────────────────────────────────────────────────

function handleStringResponse(response: string, connectionInfo: ConnectionInfo): boolean {
  if (response === 'WorkspaceNotInitialized') {
    debugLog('WorkspaceResponseHandler', 'Workspace not initialized (string literal)');
    eventEmitter.emit('workspace:not-initialized', connectionInfo);
  } else {
    debugLog('WorkspaceResponseHandler', 'Unhandled string response:', response);
  }
  return true;
}

// ─── Removed: the TYPE-GAP variants ─────────────────────────────────
//
// This block handled `CreateWorkspace`, `AddMember`, `UpdateMemberRole`,
// `RemoveMember` and `WorkspaceError` as "runtime-only response variants".
// There are no such responses. All five exist in the protocol as REQUESTS
// only, and the server never constructs them as answers — it replies with
// `Success`, `MemberRoleUpdated`, `Workspace` and `Error`.
//
// So every branch was unreachable, and everything they emitted was dead:
// `members:reload`, `member:added` and `member:removed` had listeners that
// could never fire, which is why the members list never refreshed after an
// admin added a member, removed one, or changed a role. `members:reload` is
// now emitted from `member-operations`, once `awaitWriteResponse` confirms the
// server accepted the change.
//
// Worth noting how it survived: the listener-emitter CI guard is a text scan,
// so an emit inside an unreachable branch counts as an emitter. A guard cannot
// see reachability, and this was a live instance sitting inside its blind spot.

// ─── Generated-type Variants (via isVariant) ────────────────────────
