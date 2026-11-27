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
 * Which answer is ours: against a server that pairs answers with request ids, the one named for
 * this request (answers/answer-pairing.ts); against an older one, the next answer of the right
 * type that the optional payload check lets through (answers/answer-waits.ts). Every write goes
 * through here, so every write is paired the moment the server can pair it.
 */

import type { WorkspaceProtocolRequest } from 'citadel-workspace-client-ts';
import { debugLog } from '@/lib/debug-config';
import type { ProtocolSender } from './workspace-operations';
import { answerPairing, newRequestId } from './answers/answer-pairing';
import { waitForNextAnswer, waitForPairedAnswer, type AnswerWait } from './answers/answer-waits';

export { WRITE_RESPONSE_TIMEOUT_MS, WriteResponseTimeout, WriteAnswerUnfit } from './answers/answer-waits';

/** The response variants that mean a given request succeeded. */
export const SUCCESS_RESPONSES: Record<string, readonly string[]> = {
  CreateNode: ['Node'],
  UpdateNode: ['Node'],
  // UpdateNode naming the workspace root: the home's own tabs, kept in and answered as the workspace record.
  UpdateHomeTabs: ['Workspace'],
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
  // Plan & billing over the session; a refusal is an Error answer.
  OpenBillingPortal: ['BillingPortal'],
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
  Ban: ['MemberBanned'],
  Unban: ['MemberUnbanned'],
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

/**
 * Send `request` and resolve only when the server has accepted it.
 *
 * Rejects on the server's refusal, and on silence past the timeout. Callers already treat a
 * rejection as failure -- that is the path their toasts and dialogs were written for.
 */
export async function awaitWriteResponse(
  requestType: keyof typeof SUCCESS_RESPONSES,
  sender: ProtocolSender,
  request: WorkspaceProtocolRequest,
  /**
   * Optional payload check. Against a server that pairs answers it judges the paired answer;
   * against an older one it is what tells this write's answer from another member's broadcast of
   * the same variant (`GroupMessageNotification` is both this sender's response and everyone
   * else's copy of every message).
   */
  matches?: (payload: unknown) => boolean
): Promise<void> {
  const accepted: readonly string[] = SUCCESS_RESPONSES[requestType];
  if (!accepted) {
    // An unmapped write would wait for a response that never matches and then
    // fail a correct operation, which is worse than the original defect.
    await sender.sendProtocolRequest(request, null);
    return;
  }

  // Subscribed BEFORE sending: on a warm local socket the answer can arrive in the same tick.
  const requestId: bigint | null = answerPairing.serverPairs() ? newRequestId() : null;
  const wait: AnswerWait = requestId === null ? waitForNextAnswer(accepted, matches) : waitForPairedAnswer(requestId, accepted, matches);
  try {
    await sender.sendProtocolRequest(request, requestId);
  } catch (sendError) {
    // A send that failed stands the wait down; its timer used to reject a promise nobody held.
    debugLog('WorkspaceService', `${requestType} failed to send`, sendError);
    wait.standDown();
    throw sendError;
  }
  return wait.settled;
}

/**
 * Against a server that does not pair answers: wait, sending nothing, for the next answer of
 * `requestType` that `matches` lets through (or an Error), as a request that timed out still owes.
 */
export function awaitLateAnswer(requestType: keyof typeof SUCCESS_RESPONSES, matches: (payload: unknown) => boolean): Promise<void> {
  return waitForNextAnswer(SUCCESS_RESPONSES[requestType], matches).settled;
}
