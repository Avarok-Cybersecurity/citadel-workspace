/**
 * The messaging trust settings as the two settings screens offer them, and the nodes a picker
 * may offer. Pure.
 *
 * The server decides and enforces everything here; this only maps its policy to choices and
 * back, and keeps a member's picker to the nodes the server would accept. Nodes are named from
 * the live tree and their level from the live schema (`levelLabel`), never from a type name.
 */
import type { DomainNode, MessagingTrustPolicy } from 'citadel-workspace-client-ts';

/** The workspace's: nobody, everyone, or one node and below. */
export type WorkspaceTrustChoice = 'Strict' | 'AllTrusted' | 'NodeLevelTrusted';
/** A member's own: the workspace's, one node inside it, or nobody. */
export type PersonalTrustChoice = 'follow' | 'node' | 'ask';

export function workspaceChoiceOf(policy: MessagingTrustPolicy): WorkspaceTrustChoice {
  if (policy === 'Strict' || policy === 'AllTrusted') return policy;
  return 'NodeLevelTrusted';
}

/** The node a policy names; null for every other policy. */
export function trustedNodeOf(policy: MessagingTrustPolicy | null): string | null {
  return policy !== null && typeof policy === 'object' ? policy.NodeLevelTrusted.node_id : null;
}

/** `nodeId` is required for the node choice and ignored otherwise; null when it is missing. */
export function workspacePolicyOf(choice: WorkspaceTrustChoice, nodeId: string | null): MessagingTrustPolicy | null {
  if (choice !== 'NodeLevelTrusted') return choice;
  return nodeId === null ? null : { NodeLevelTrusted: { node_id: nodeId } };
}

/** `AllTrusted` as one's own can only equal an AllTrusted workspace, so it reads as following it. */
export function personalChoiceOf(mine: MessagingTrustPolicy | null): PersonalTrustChoice {
  if (mine === null || mine === 'AllTrusted') return 'follow';
  return mine === 'Strict' ? 'ask' : 'node';
}

/** `undefined` when the node choice has no node yet: there is nothing to send. */
export function personalPolicyOf(choice: PersonalTrustChoice, nodeId: string | null): MessagingTrustPolicy | null | undefined {
  if (choice === 'follow') return null;
  if (choice === 'ask') return 'Strict';
  return nodeId === null ? undefined : { NodeLevelTrusted: { node_id: nodeId } };
}

function within(nodes: Record<string, DomainNode>, nodeId: string, ancestor: string): boolean {
  const seen: Set<string> = new Set<string>();
  let current: string | null = nodeId;
  while (current !== null && !seen.has(current)) {
    if (current === ancestor) return true;
    seen.add(current);
    current = nodes[current]?.parent_id ?? null;
  }
  return false;
}

/** Whether a member's own node choice stays inside the workspace's policy. */
export function inWorkspaceScope(nodes: Record<string, DomainNode>, policy: MessagingTrustPolicy, nodeId: string): boolean {
  if (policy === 'Strict') return false;
  if (policy === 'AllTrusted') return true;
  return within(nodes, nodeId, policy.NodeLevelTrusted.node_id);
}

export interface TrustNodeOption {
  id: string;
  /** "Engineering › Backend · Team": the path from the top, and the node's level. */
  label: string;
}

function pathOf(nodes: Record<string, DomainNode>, node: DomainNode): string {
  const names: string[] = [];
  const seen: Set<string> = new Set<string>();
  let current: DomainNode | undefined = node;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parent_id === null ? undefined : nodes[current.parent_id];
  }
  return names.join(' › ');
}

/** The nodes a picker offers, in path order, limited to those `include` admits. */
export function trustNodeOptions(
  nodes: Record<string, DomainNode>,
  include: (nodeId: string) => boolean,
  levelLabel: (node: DomainNode) => string,
): TrustNodeOption[] {
  return Object.values(nodes)
    .filter((node: DomainNode): boolean => include(node.id))
    .map((node: DomainNode): TrustNodeOption => ({ id: node.id, label: `${pathOf(nodes, node)} · ${levelLabel(node)}` }))
    .sort((a: TrustNodeOption, b: TrustNodeOption): number => a.label.localeCompare(b.label));
}
