/**
 * The messaging trust requests bound to this tab's workspace session. Components and hooks
 * import this rather than the sender-taking operations, so a test replaces the one I/O boundary.
 */
import WorkspaceService from '@/lib/workspace-service';
import * as ops from '@/lib/workspace-service/messaging-trust-operations';

/** An operation with its first argument, the session's sender, already supplied. */
type Bound<F> = F extends (sender: never, ...rest: infer A) => infer R ? (...args: A) => R : never;

export interface MessagingTrustApi {
  getSettings: Bound<typeof ops.getMessagingTrustSettings>;
  setWorkspacePolicy: Bound<typeof ops.setWorkspaceMessagingTrust>;
  setMyPolicy: Bound<typeof ops.setMyMessagingTrust>;
  checkPeer: Bound<typeof ops.checkMessagingTrust>;
  /** The session these requests are sent as; null before one is selected. */
  sessionCid: () => bigint | null;
}

export const messagingTrustApi: MessagingTrustApi = {
  getSettings: () => ops.getMessagingTrustSettings(WorkspaceService),
  setWorkspacePolicy: (policy: Parameters<typeof ops.setWorkspaceMessagingTrust>[1]) => ops.setWorkspaceMessagingTrust(WorkspaceService, policy),
  setMyPolicy: (policy: Parameters<typeof ops.setMyMessagingTrust>[1]) => ops.setMyMessagingTrust(WorkspaceService, policy),
  checkPeer: (peerUsername: string) => ops.checkMessagingTrust(WorkspaceService, peerUsername),
  sessionCid: (): bigint | null => WorkspaceService.currentCid,
};
