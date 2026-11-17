/**
 * Payload checks that tell OUR answer apart from someone else's broadcast.
 *
 * The workspace protocol carries no request id, so `awaitWriteResponse` matches
 * responses by type. That was safe while those variants were only ever sent to
 * the client that asked — and stopped being safe when the server began
 * broadcasting `Node`, `NodeDeleted` and `NodeMoved` to every other member so
 * their trees would update live.
 *
 * The consequence is worse than a mismatched toast. Alice saves a document and
 * the server is about to refuse it; Bob renames any node in the same 15-second
 * window; his broadcast `Node` resolves Alice's pending write; the editor closes
 * on "success" and reloads the stored copy over her buffer. Her text is gone
 * under a green toast — the exact data loss the write gate was built to end.
 *
 * These are narrowing checks, not identity: without a request id, two writes to
 * the SAME node in flight at once still cannot be told apart. That remains a
 * property of the protocol, and is recorded in await-write-response.
 */
import type { WorkspaceLogoChange } from 'citadel-workspace-client-ts';
import { workspaceLogoOf } from '@/lib/workspace-metadata/workspace-logo';
import type { MetadataSource } from '@/lib/workspace-metadata/metadata-document';

function field(payload: unknown, key: string): unknown {
  if (!payload || typeof payload !== 'object') return undefined;
  return (payload as Record<string, unknown>)[key];
}

/** `Node(DomainNode)` — the node itself, so its own `id`. */
export function nodeWithId(nodeId: string) {
  return (payload: unknown): boolean => field(payload, 'id') === nodeId;
}

/** `NodeDeleted` / `NodeMoved` — both name the node they are about. */
export function aboutNode(nodeId: string) {
  return (payload: unknown): boolean => field(payload, 'node_id') === nodeId;
}

/**
 * Creation is the awkward one: the client does not know the new node's id, so
 * it matches on what it does know. Two members creating a same-named sibling
 * simultaneously could still cross, which is strictly better than any `Node` at
 * all resolving the write.
 */
export function newChildOf(parentId: string | null, name: string) {
  return (payload: unknown): boolean =>
    field(payload, 'name') === name && (field(payload, 'parent_id') ?? null) === parentId;
}

/**
 * `MemberRoleUpdated` — names the member whose role changed.
 *
 * This variant became a broadcast when demotions were made to reach the
 * demoted user's own client. Before that it went only to the acting admin, so
 * matching by type alone was safe; now another admin's role change in the same
 * 15s window would resolve this one.
 */
export function aboutMember(userId: string) {
  return (payload: unknown): boolean => field(payload, 'user_id') === userId;
}

/**
 * `Workspace(Workspace)` — the record itself, so its own `id`.
 *
 * The last variant to need one, and it needed one for two independent reasons.
 * `GetWorkspace` answers `Workspace`, so a concurrent read in the SAME tab
 * resolves a pending rename; and `UpdateWorkspace` / `UpdateWorkspaceTheme`
 * broadcast `Workspace` to the other members, so a colleague's theme change
 * resolves it too.
 *
 * The consequence is the one this file exists to stop, in the settings form:
 * the admin renames the workspace, the server is about to refuse it — no
 * permission, or a wrong master password — and something else's `Workspace`
 * arrives first. The form toasts "updated successfully", clears its dirty flag
 * and closes. The real `Error` arrives after the handler has unsubscribed, so
 * it surfaces as a disjoint global toast if at all, and the name is unchanged.
 *
 * Matching on `id` does not separate two writes to the SAME workspace in
 * flight at once; nothing can, without a request id. It does separate this
 * workspace's answer from another's, and a write from a concurrent read of a
 * different workspace, which is what the multi-workspace server made possible.
 */
export function workspaceWithId(workspaceId: string) {
  return (payload: unknown): boolean => field(payload, 'id') === workspaceId;
}

/**
 * The same idea where no id is available.
 *
 * `UpdateWorkspace` names no workspace — it acts on the current one — so there
 * is no id to match. It does say what it is CHANGING, and that is a real
 * discriminator: a concurrent `GetWorkspace` answers with the workspace as it
 * is NOW, which is precisely the value the rename is replacing. So the answer
 * carrying the new name is ours; the one carrying the old name is not.
 *
 * Same shape as `newChildOf`, for the same reason: match on what the caller
 * knows. Returns `undefined` when the caller knows nothing to match on — a
 * request that sets only `metadata`, say — so behaviour there is exactly what
 * it was rather than a matcher that silently accepts everything.
 */
export function workspaceChangedTo(
  fields: { name?: string; description?: string },
): ((payload: unknown) => boolean) | undefined {
  const checks: Array<(payload: unknown) => boolean> = [];
  if (fields.name !== undefined) checks.push((p) => field(p, 'name') === fields.name);
  if (fields.description !== undefined) {
    checks.push((p) => field(p, 'description') === fields.description);
  }
  if (checks.length === 0) return undefined;
  return (payload: unknown): boolean => checks.every((check) => check(payload));
}

/**
 * `Workspace` after an UpdateWorkspaceProfile: the record carrying every change the request
 * made. The icon is compared as `workspaceLogoOf` reads it, so a clear matches the record whose
 * logo is gone. Unlike `workspaceChangedTo`, never undefined: a profile request always changes
 * something the answer shows.
 */
export function workspaceProfileIs(
  workspaceId: string,
  change: { name?: string; description?: string; logo?: WorkspaceLogoChange },
): (payload: unknown) => boolean {
  const expectedLogo: string | null | undefined =
    change.logo === undefined ? undefined : change.logo === 'Clear' ? null : change.logo.Set.data_url;
  return (payload: unknown): boolean =>
    field(payload, 'id') === workspaceId &&
    (change.name === undefined || field(payload, 'name') === change.name.trim()) &&
    (change.description === undefined || field(payload, 'description') === change.description.trim()) &&
    (expectedLogo === undefined || workspaceLogoOf(field(payload, 'metadata') as MetadataSource) === expectedLogo);
}

