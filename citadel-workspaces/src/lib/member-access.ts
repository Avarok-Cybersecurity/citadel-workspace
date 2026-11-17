/**
 * How each person on a node's member list has access: listed on the node, or
 * through a level above.
 *
 * The server's `Members` reply carries `inherited_from` (member id -> the level
 * whose membership gives them access). An office's list used to show only the
 * people added to that office, while workspace members used its chat through
 * the level above; now everyone with access is listed, and people who come
 * through a level above are marked with it (owner, 2026-09-29).
 *
 * Pure: the level names come from the caller's workspace state.
 */
import type { User as WorkspaceMember } from '@/types/workspace-entities';
import type { MemberActionBlocks } from '@/components/layout/sidebar/member-actions-gate';

/** Each member, with `accessVia` set when a level above gives them access. */
export function withAccess(
  members: readonly WorkspaceMember[],
  inheritedFrom: Readonly<Record<string, string>>,
): WorkspaceMember[] {
  return members.map((member: WorkspaceMember): WorkspaceMember => {
    const via: string | undefined = inheritedFrom[member.id];
    return via === undefined ? member : { ...member, accessVia: via };
  });
}

/**
 * The name to show for a level: a node by its own name, anything else (the
 * workspace, which is not a node) by the workspace's name.
 */
export function levelName(
  levelId: string,
  nodeNames: Readonly<Record<string, string>>,
  workspaceName: string,
): string {
  return nodeNames[levelId] ?? workspaceName;
}

/**
 * The action blocks for one member. Removing someone from a node they reach
 * through a level above cannot take their access away -- the server now refuses
 * it -- so it is offered only for people listed on the node itself.
 */
export function blocksForMember(blocks: MemberActionBlocks, viaName: string | null): MemberActionBlocks {
  if (viaName === null || blocks.remove !== null) return blocks;
  return { ...blocks, remove: inheritedRemoveReason(viaName) };
}

/** Why an inherited member cannot be removed here. One sentence for every surface that offers Remove. */
export function inheritedRemoveReason(viaName: string): string {
  return `Has access through ${viaName} — manage them there.`;
}
