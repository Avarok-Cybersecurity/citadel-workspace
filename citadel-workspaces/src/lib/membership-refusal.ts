/**
 * The server's word that this account is not in the workspace.
 *
 * An administrator's removal is kept: the kernel no longer re-enrols a removed account at its
 * next connect (a_removed_member_does_not_re_enrol.rs), and every account that never joined is
 * enrolled at connect. So after sign-in, this refusal means the account was removed.
 *
 * The protocol has no variant for it. GetWorkspace answers a non-member of the root with
 * `WorkspaceNotInitialized` (kernel workspace_lookup.rs says why, and that it is wrong), so the
 * workspace record never arrives and the loader waited for it for ever: "Workspace data is taking
 * longer than expected..." to a person the server had already turned away. The node list's
 * refusal is the one unambiguous signal, as `Failed to list nodes: <NOT_A_MEMBER>`.
 *
 * Copied from citadel-workspace-server-kernel/src/handlers/domain/workspace_errors.rs; the test
 * beside this module reads the kernel's sources, so a rewording there fails here.
 */
export const NOT_A_MEMBER: string = 'Permission denied: Not a member of this workspace';

/** True when `message` is the kernel's NOT_A_MEMBER, bare or as the reason after a request's own prefix. */
export function isMembershipRefusal(message: string): boolean {
  return message === NOT_A_MEMBER || message.endsWith(`: ${NOT_A_MEMBER}`);
}
