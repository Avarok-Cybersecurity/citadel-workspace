/**
 * Waiting for the server's answer to a write, instead of for the frame to leave.
 *
 * `sendProtocolRequest` resolves once the request reaches the local WASM sink.
 * The server answers a refusal as a RESPONSE — `WorkspaceProtocolResponse::Error`
 * — which can never reject that promise. So every write reported success on
 * SEND:
 *
 *   - "Office Deleted — Engineering has been deleted successfully" in green,
 *     the modal closed, the user navigated away from the node;
 *   - five seconds later, a red "Failed to delete node: Permission denied:
 *     EditTreeStructure required" in the opposite corner;
 *   - and the node still in the tree.
 *
 * The careful failure handling downstream was all unreachable as a result.
 * TreeNodesSection's delete dialog closes only on success and renders its own
 * `role="alert"` — but the handler it awaits swallowed its errors and always
 * resolved, so neither could ever fire.
 *
 * KNOWN LIMITATION, recorded rather than hidden: the workspace protocol carries
 * no request id (`grep -c request_id citadel-workspace-types/src/lib.rs` is 0),
 * so responses can only be matched by TYPE. Two writes of the same kind in
 * flight at once could take each other's answer. The UI issues these one at a
 * time from a modal or a confirm dialog, so that is not reachable today — but it
 * is a property of the protocol, not of this module, and the real fix is a
 * request id on the wire.
 */

import { eventEmitter } from '../event-emitter';
import { debugLog } from '@/lib/debug-config';

/** How long to wait before treating silence as a failure. */
export const WRITE_RESPONSE_TIMEOUT_MS: number = 15_000;

/** The response variants that mean a given request succeeded. */
export const SUCCESS_RESPONSES: Record<string, readonly string[]> = {
  CreateNode: ['Node'],
  UpdateNode: ['Node'],
  SetMembersVisible: ['Node'],
  // A workspace's default tabs; answered and broadcast as the workspace record.
  SetDefaultAppTabs: ['Workspace'],
  // The sign-in settings, read and written; both answered with what the server holds.
  // Every telemetry request is answered with a Telemetry response; telemetry-operations picks the kind.
  Telemetry: ['Telemetry'],
  // Likewise MessagingTrust; messaging-trust-operations picks the kind and the peer.
  MessagingTrust: ['MessagingTrust'],
  // And Roles: a List is answered with the table, an edit with RoleChanged; roles-operations matches which.
  Roles: ['Roles'],
  // And SecureLinks: secure-links-operations matches the kind, and the link, to the request.
  SecureLinks: ['SecureLinks'],
  // And Apps: apps-operations matches the kind, and the app or install, to the request.
  Apps: ['Apps'],
  GetSignInSettings: ['SignInSettings'],
  UpdateSignInSettings: ['SignInSettings'],
  DeleteNode: ['NodeDeleted'],
  MoveNode: ['NodeMoved'],

  // Member and permission writes. These were left out when this module was
  // written, so "Member Added — {username} has been added to the workspace as
  // {role}" appeared for a username that does not exist, and "Permissions saved
  // successfully" for permissions the server refused. ACL state the admin
  // believes exists, and does not.
  AddMember: ['Success'],
  RemoveMember: ['Success'],
  UpdateMemberRole: ['MemberRoleUpdated'],
  UpdateMemberPermissions: ['Success'],

  // The theme write, whose UI promises "Every member will see this theme".
  UpdateWorkspaceTheme: ['Workspace'],
  // Name, description and icon; answered and broadcast as the workspace record.
  UpdateWorkspaceProfile: ['Workspace'],

  // The workspace-level writes. GeneralTab awaited updateWorkspace, toasted
  // "updated successfully" and cleared its dirty flag on the SEND — so a
  // refusal (no permission, bad master password) left the admin believing the
  // rename had landed, contradicted seconds later by a disjoint global error
  // toast, with the name unchanged.
  UpdateWorkspace: ['Workspace'],
  // `Workspace`, not `CreateWorkspace`. There is no `CreateWorkspace` RESPONSE
  // variant — it exists as a request only, and the server answers
  // `WorkspaceProtocolResponse::Workspace(workspace)`. `getExpectedResponseTypes`
  // in service.ts has always had this right; two maps for one protocol
  // disagreed, and the write path used the wrong one. Every createWorkspace()
  // would have applied the workspace and THEN rejected 15s later saying the
  // change may not have been saved.
  CreateWorkspace: ['Workspace'],

  // The profile save, whose spinner disables the whole settings form and was
  // cleared only by the success event.
  UpdateUserProfile: ['UserProfileUpdated'],

  // Group message edits and deletes. The edit composer used to close and
  // discard the user's edited text as though it had landed, while the message
  // silently kept its old content.
  // The server answers the SENDER with the same variant it broadcasts to every
  // other member, so this one needs the payload matcher to tell its own answer
  // from someone else's message.
  SendGroupMessage: ['GroupMessageNotification'],
  EditGroupMessage: ['GroupMessageEdited'],
  DeleteGroupMessage: ['GroupMessageDeleted'],
  // A node channel's reaction and read cursor; both answered with the notice they broadcast.
  ReactGroupMessage: ['GroupMessageReacted'],
  MarkGroupRead: ['GroupReadCursorMoved'],
};

function describeFailure(response: Record<string, unknown>): string {
  const detail: unknown = response.Error;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object') {
    const [variant, value] = Object.entries(detail)[0] ?? [];
    return typeof value === 'string' ? `${variant}: ${value}` : String(variant);
  }
  return 'The server rejected the request.';
}

/**
 * Send a write and resolve only when the server has accepted it.
 *
 * Rejects on `Error`, and on silence past the timeout. Callers already treat a
 * rejection as failure — that is the path their toasts and dialogs were written
 * for and could never reach.
 */
export async function awaitWriteResponse(
  requestType: keyof typeof SUCCESS_RESPONSES,
  send: () => Promise<void>,
  /**
   * Optional payload check, for variants that are ALSO broadcast to other
   * members. `GroupMessageNotification` is both this sender's response and
   * everyone else's copy of every message, so type alone would let another
   * member's message resolve this write. Matching on the payload narrows the
   * window the missing request-id leaves open.
   */
  matches?: (payload: unknown) => boolean
): Promise<void> {
  const accepted: readonly string[] = SUCCESS_RESPONSES[requestType];
  if (!accepted) {
    // An unmapped write would wait for a response that never matches and then
    // fail a correct operation, which is worse than the original defect.
    await send();
    return;
  }

  // Held out here so a send that fails can stand the wait down. It used to leave the timer and
  // the listener behind, and the timer then rejected a promise nobody held, 15s later.
  let standDown: () => void = (): void => {};
  const settled: Promise<void> = new Promise<void>((resolve, reject) => {
    const timeoutId: NodeJS.Timeout = setTimeout((): void => {
      eventEmitter.off('workspace:raw-response', handler);
      reject(
        new Error(
          `The server did not answer within ${WRITE_RESPONSE_TIMEOUT_MS / 1000}s. ` +
            'The change may not have been saved.'
        )
      );
    }, WRITE_RESPONSE_TIMEOUT_MS);

    const handler = (response: unknown): void => {
      if (!response || typeof response !== 'object') return;
      const responseType: string = Object.keys(response)[0];
      if (responseType === undefined) return;

      if (responseType === 'Error') {
        clearTimeout(timeoutId);
        eventEmitter.off('workspace:raw-response', handler);
        reject(new Error(describeFailure(response as Record<string, unknown>)));
        return;
      }
      if (accepted.includes(responseType)) {
        // A broadcast of the same variant from another member is not our answer.
        if (matches && !matches((response as Record<string, unknown>)[responseType])) return;
        clearTimeout(timeoutId);
        eventEmitter.off('workspace:raw-response', handler);
        resolve();
      }
    };

    eventEmitter.on('workspace:raw-response', handler);
    standDown = (): void => {
      clearTimeout(timeoutId);
      eventEmitter.off('workspace:raw-response', handler);
    };
  });

  // Subscribe BEFORE sending. The response can arrive within the same tick on a
  // warm local socket, and a listener attached afterwards would miss it and then
  // time out a write that actually succeeded.
  try {
    await send();
  } catch (sendError) {
    debugLog('WorkspaceService', `${requestType} failed to send`, sendError);
    standDown();
    throw sendError;
  }

  return settled;
}
