/**
 * Post-Auth Setup — Single source of truth for workspace initialization after authentication.
 *
 * Consolidates the duplicated setConnectionId → loadWorkspace → listNodes → getTreeSchema
 * pattern that was previously scattered across 5+ files.
 *
 * All callers (login, join, workspace-loader, workspace-switcher, session-redirect)
 * should use this function instead of manually orchestrating these steps.
 */

import WorkspaceService from '@/lib/workspace-service';
import { instanceManager } from '@/lib/multi-instance';
import { debugLog, errorLog } from '@/lib/debug-config';
import { reloadRoles } from '@/lib/workspace-roles/roles-store';
import { rolesApi } from '@/lib/workspace-roles/roles-api';

/**
 * Performs the complete post-authentication workspace setup sequence.
 *
 * @param cid - The connection ID (CID) from the authenticated session.
 * @param options - Optional configuration.
 * @param options.skipTreeSchema - If true, skip fetching tree schema (used by callers that don't need it).
 * @throws If any step fails. Callers should handle errors and display appropriate UI.
 */
export async function postAuthSetup(
  cid: bigint,
  options?: { skipTreeSchema?: boolean }
): Promise<void> {
  debugLog('PostAuthSetup', 'Starting workspace setup for CID:', cid.toString());

  // Step 0: Anchor the multi-instance manager to this CID. This must happen
  // before any P2P notification can arrive — the inbound router's CID-based
  // routing (PeerRegisterNotification, MessageNotification, PeerConnectNotification)
  // depends on instanceManager.findInstanceByCid resolving for both leader and
  // follower tabs. Setting it here also triggers the cid-update broadcast so
  // the leader's view of the follower's CID is populated.
  if (instanceManager.cid !== cid) {
    instanceManager.setCid(cid);
  }

  // Step 1: Set the connection ID on the workspace service
  WorkspaceService.setConnectionId(cid);

  // Step 2: Load workspace metadata
  await WorkspaceService.loadWorkspace();

  // Step 3: Load the node hierarchy
  await WorkspaceService.listNodes();

  // Step 4: Load the tree schema (defines entity types and nesting rules)
  if (!options?.skipTreeSchema) {
    await WorkspaceService.getTreeSchema();
  }

  // Step 5: Ask the server who the members are, which is how this client learns
  // its OWN role.
  //
  // `state.currentUser.role` was read from the locally stored session record --
  // written once when the session was created and never refreshed. The server is
  // the authority: it promotes the first account to Admin on connect, and the
  // client never heard about it. Measured in CI, from the server's own log:
  //
  //   [ASYNC_KERNEL] User pw_admin_… is the first workspace member; promoted to Admin
  //
  // while the browser showed no ADMIN SETTINGS section, global-setup concluded
  // "a workspace already existed; this account is a member", and every spec
  // needing edit rights skipped or failed behind that.
  //
  // The machinery to correct it already existed: `members:loaded` finds this
  // user in the list, updates the role and persists it to the stored session.
  // Nothing asked for the list at boot -- it was requested only when the members
  // panel was opened, so an administrator who never opened that panel was shown
  // a member's app.
  await WorkspaceService.listMembers();

  // Step 6: The role table, read again. The store asks for it once per session, so after a
  // reconnect or a claim of the same session it kept the table it had, and an edit made while
  // this tab was not listening (its RoleChanged went nowhere) showed only after a session change.
  // Never thrown: an account that holds no role yet (awaiting initialisation) is refused the list,
  // and that must not fail its sign-in.
  await reloadRoles(rolesApi.list, (reason: string): void => {
    errorLog('PostAuthSetup', 'The role table could not be read again; showing the one from before:', reason);
  });

  debugLog('PostAuthSetup', 'Workspace setup complete for CID:', cid.toString());
}
