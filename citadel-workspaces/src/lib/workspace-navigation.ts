/**
 * Workspace Navigation Service
 *
 * Builds the `/workspace` route, preserving whatever query parameters the
 * caller already has.
 *
 * It used to stamp `?id=<activeWorkspaceId>` into every path it built. That
 * parameter was read by nobody — the only params anything in the app reads are
 * `nodeId`, `section`, `showP2P`, `channel`, `p2pUser`, `join` and the file
 * manager's own (FILE_MANAGER_KEYS below) — and its
 * value was always the literal string `'root'`, because `setActiveWorkspaceId`
 * had no callers either. Both ends of the feature were absent; only the URL
 * pollution was real.
 *
 * That made every shared link actively wrong: `/workspace?id=root&nodeId=…`
 * looks like it identifies a workspace, so pasting one to a colleague in a
 * DIFFERENT workspace opened THEIR workspace with your node id — a link that
 * appears to address something specific and silently addresses whatever the
 * recipient happens to be in.
 *
 * Removed rather than wired up: a real workspace-scoped link needs the id in
 * the ROUTE and a loader that honours it, which is a routing change, not a
 * query parameter. Leaving a parameter that claims to identify something it
 * does not is worse than having none.
 */

import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';

class WorkspaceNavigation {
  private static instance: WorkspaceNavigation;

  private constructor() {}

  public static getInstance(): WorkspaceNavigation {
    if (!WorkspaceNavigation.instance) {
      WorkspaceNavigation.instance = new WorkspaceNavigation();
    }
    return WorkspaceNavigation.instance;
  }

  /**
   * The workspace route, with any additional query parameters.
   */
  public getWorkspacePath(additionalParams?: Record<string, string>): string {
    const params: URLSearchParams = new URLSearchParams(additionalParams);
    const query: string = params.toString();
    return query ? `/workspace?${query}` : '/workspace';
  }

  /**
   * The workspace route, preserving the caller's existing query parameters.
   */
  public buildWorkspacePath(existingParams?: URLSearchParams): string {
    const params: URLSearchParams = existingParams ? new URLSearchParams(existingParams) : new URLSearchParams();
    // A stale `id` from a link someone shared before this was removed would
    // otherwise ride along forever.
    params.delete('id');
    const query: string = params.toString();
    return query ? `/workspace?${query}` : '/workspace';
  }
}

// Export singleton instance
export const workspaceNavigation: WorkspaceNavigation = WorkspaceNavigation.getInstance();

// Export helper function for convenience
export function getWorkspacePath(additionalParams?: Record<string, string>): string {
  return workspaceNavigation.getWorkspacePath(additionalParams);
}

export function buildWorkspacePath(existingParams?: URLSearchParams): string {
  return workspaceNavigation.buildWorkspacePath(existingParams);
}

/** The `section` value that shows the file manager in place of the workspace view. */
export const FILE_MANAGER_SECTION = 'files' as const;

/**
 * The query keys the file manager owns: whose storage (`peer_id`), which folder
 * (`path`), which item a link points at (`item`), and who copied a peer link
 * (`via`; see file-manager-location.ts). Spelled once, here, so that every way
 * out of the section can drop all of them -- a key one exit forgot would ride
 * along into the next view and come back the next time the file manager opened.
 */
export const FILE_MANAGER_KEYS = ['peer_id', 'path', 'item', 'via'] as const;

/** The keys the workspace view reads, which a section replaces. */
const WORKSPACE_VIEW_KEYS = ['nodeId', 'showP2P', 'channel', 'p2pUser'] as const;

/** Leave whatever `section` is showing, and everything the file manager wrote. */
export function leaveSection(params: URLSearchParams): void {
  params.delete('section');
  for (const key of FILE_MANAGER_KEYS) params.delete(key);
}

/** Show a section instead of the workspace view: the node and any conversation go. */
export function enterSection(params: URLSearchParams, section: typeof FILE_MANAGER_SECTION): void {
  for (const key of WORKSPACE_VIEW_KEYS) params.delete(key);
  params.set('section', section);
}

/**
 * The node a `nodeId` parameter puts on screen; null means the workspace home.
 *
 * The workspace root is a sentinel on the server, never a stored node, so
 * `?nodeId=workspace-root` -- what the sidebar navigates to when the root row
 * is selected, what a call's Return uses for a workspace-level room, and what
 * any bookmark of either holds -- names nothing in `state.nodes`. It read as a
 * deleted page: the home rendered on landing (no nodeId), and the same home,
 * reached again from the sidebar, said "This page is no longer here".
 *
 * The parameter is kept rather than removed on selection: an absent nodeId is
 * also how Office decides to redirect to the default space, so the root row
 * would bounce anyone with a default space straight back out of the home.
 * When a server does send the root as a node, that node is shown as itself.
 */
export function nodeInView(nodeId: string | null | undefined, stored: Readonly<Record<string, unknown>>): string | null {
  if (!nodeId) return null;
  return nodeId === WORKSPACE_ROOT_ID && !(nodeId in stored) ? null : nodeId;
}
