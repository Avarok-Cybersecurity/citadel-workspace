/**
 * The ports only a first-party glue app gets answer from what the page holds: `nodes.read` within
 * the install's reach and nowhere beyond it (the same answer as a node that does not exist),
 * `members.list` in a stable order with unknown presence never reported as online, and a
 * notification always badged with the app's name.
 */
import { describe, expect, it } from 'vitest';
import type { InstallScope } from 'citadel-workspace-client-ts';
import { badgedNotifyPort, rosterMembersPort, type AppNotice } from '../first-party-ports';
import { treeNodesPort, type TreeNode } from '../nodes-port';
import type { MembersPort, NodesPort, NotifyPort } from '@/lib/citadel-apps/host/ports';

const TREE: Record<string, TreeNode> = {
  root: { id: 'root', name: 'Company', parent_id: null, children: ['eng', 'sales'] },
  eng: { id: 'eng', name: 'Engineering', parent_id: 'root', children: ['platform'] },
  platform: { id: 'platform', name: 'Platform', parent_id: 'eng', children: [] },
  sales: { id: 'sales', name: 'Sales', parent_id: 'root', children: [] },
};

const nodes = (scope: InstallScope): NodesPort => treeNodesPort(scope, () => TREE);
const NOT_FOUND: { refused: { unavailable: string; }; } = { refused: { unavailable: 'not_found' } };

describe('nodes.read for a glue app', () => {
  it('answers a node and its children for a workspace install', () => {
    expect(nodes('Workspace').NodeGet({ node_id: 'eng' })).toEqual({ ok: { node_id: 'eng', name: 'Engineering', parent_id: 'root', has_children: true } });
    expect(nodes('Workspace').NodeChildren({ node_id: 'root' })).toEqual({ ok: { nodes: [
      { node_id: 'eng', name: 'Engineering', parent_id: 'root', has_children: true },
      { node_id: 'sales', name: 'Sales', parent_id: 'root', has_children: false },
    ] } });
  });

  it('keeps a subtree install inside its subtree, as the kernel keeps its storage', () => {
    const port: NodesPort = nodes({ NodeTree: 'eng' });
    expect(port.NodeGet({ node_id: 'platform' })).toMatchObject({ ok: { node_id: 'platform' } });
    expect(port.NodeGet({ node_id: 'sales' })).toEqual(NOT_FOUND);
    expect(port.NodeGet({ node_id: 'root' })).toEqual(NOT_FOUND);
    expect(port.NodeChildren({ node_id: 'root' })).toEqual(NOT_FOUND);
  });

  it('keeps a node install on its node', () => {
    const port: NodesPort = nodes({ Node: 'eng' });
    expect(port.NodeGet({ node_id: 'eng' })).toMatchObject({ ok: { node_id: 'eng' } });
    expect(port.NodeGet({ node_id: 'platform' })).toEqual(NOT_FOUND);
    expect(port.NodeChildren({ node_id: 'eng' })).toEqual({ ok: { nodes: [] } });
  });

  it('answers a missing node as it answers one out of reach, and offers no writes', () => {
    expect(nodes('Workspace').NodeGet({ node_id: 'gone' })).toEqual(NOT_FOUND);
    expect(nodes('Workspace').NodeCreate({ parent_id: 'root', name: 'x' })).toEqual({ refused: { unavailable: 'nodes' } });
  });
});

describe('members.list and notifications for a glue app', () => {
  it('lists the roster by username and never calls unknown presence online', () => {
    const port: MembersPort = rosterMembersPort(() => [
      { username: 'zoe', displayName: 'Zoe', isOnline: true },
      { username: 'amy', displayName: 'Amy', isOnline: null },
      { username: 'bob', displayName: 'Bob', isOnline: false },
    ]);
    expect(port.MembersList({})).toEqual({ ok: { members: [
      { username: 'amy', display_name: 'Amy', online: false },
      { username: 'bob', display_name: 'Bob', online: false },
      { username: 'zoe', display_name: 'Zoe', online: true },
    ] } });
  });

  it("badges every notification with the app's name", () => {
    const seen: AppNotice[] = [];
    const port: NotifyPort = badgedNotifyPort({ id: 'net.avarok.calendar', name: 'Calendar' }, (n: AppNotice): void => { seen.push(n); });
    expect(port.Notify({ title: 'Standup in 10 minutes', body: 'Platform, 9:00 AM' })).toEqual({ ok: null });
    expect(seen).toEqual([{ from: 'Calendar', appId: 'net.avarok.calendar', title: 'Standup in 10 minutes', body: 'Platform, 9:00 AM' }]);
  });
});
