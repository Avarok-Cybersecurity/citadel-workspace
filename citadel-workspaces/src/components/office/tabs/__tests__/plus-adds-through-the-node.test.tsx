/**
 * What "+" opens: the marketplace for a tab on this node, offered the node's current app tabs,
 * whose add appends through the pane's own write (UpdateNode.metadata, node-tabs-operations.ts)
 * and opens the new tab once the server's answer lists it.
 *
 * Real: useNodeTabs and addTabRequest. Doubles: the permission hook (its answer is the input), the
 * toast (a refusal's words are use-node-tabs' own test's subject) and the writer, the I/O boundary,
 * which records what would be sent.
 */
import { describe, expect, it, vi } from 'vitest';
// Installs not known: every stored tab shows (installed-tabs.ts); these are about the stored list.
import { INSTALLS_UNKNOWN } from '@/lib/node-tabs/installed-tabs';
import { act, renderHook, type RenderHookResult } from '@testing-library/react';
import type { AppsModalRequest } from '@/lib/citadel-apps/apps-modal-store';
import { appIdsOf, ownTabsSource } from '@/lib/node-tabs/tab-list';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';

vi.mock('@/hooks/use-permission', () => ({ usePermission: (): unknown => ({ allowed: true, loading: false, unanswered: false, answered: true }) }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));

const { useNodeTabs } = await import('../use-node-tabs');
const { addTabRequest } = await import('../NodePane');
type Model = import('../use-node-tabs').NodeTabsModel;

describe('"+" on a node', () => {
  it('offers the node’s tabs and appends the chosen app through its write, then opens it (control: a refused write adds nothing)', async () => {
    const writes: Array<readonly string[] | null> = [];
    // The node as the server last broadcast it: rerendered with the answer to the write.
    const { result, rerender } = renderHook(({ tabs }: { tabs: string[] }): Model => useNodeTabs({
      nodeId: 'n1', chatEnabled: false, nodeMetadata: { app_tabs: tabs }, workspaceMetadata: { default_app_tabs: [] }, here: INSTALLS_UNKNOWN,
      writer: { writeNodeTabs: async (_n: string, appIds: readonly string[] | null): Promise<void> => { writes.push(appIds); }, setDefaultAppTabs: async (): Promise<void> => undefined },
    }), { initialProps: { tabs: ['com.acme.kanban'] } });
    const request: AppsModalRequest = addTabRequest('n1', result.current);
    if (request.kind !== 'tab') throw new Error('"+" did not open the tab view');
    expect([request.target.nodeId, request.target.tabs]).toEqual(['n1', ['com.acme.kanban']]);
    let added: boolean = false;
    await act(async (): Promise<void> => { added = await request.target.add('net.avarok.calendar'); });
    expect([added, writes]).toEqual([true, [['com.acme.kanban', 'net.avarok.calendar']]]);
    rerender({ tabs: ['com.acme.kanban', 'net.avarok.calendar'] });
    expect(result.current.active).toBe('app:net.avarok.calendar');

    const refused: RenderHookResult<Model, unknown> = renderHook((): Model => useNodeTabs({
      nodeId: 'n2', chatEnabled: false, nodeMetadata: undefined, workspaceMetadata: { default_app_tabs: [] }, here: INSTALLS_UNKNOWN,
      writer: { writeNodeTabs: (): Promise<void> => Promise.reject(new Error('You may not change this page’s tabs.')), setDefaultAppTabs: async (): Promise<void> => undefined },
    }));
    const nope: AppsModalRequest = addTabRequest('n2', refused.result.current);
    if (nope.kind !== 'tab') throw new Error('"+" did not open the tab view');
    let refusedAdd: boolean = true;
    await act(async (): Promise<void> => { refusedAdd = await nope.target.add('net.avarok.calendar'); });
    expect([refusedAdd, refused.result.current.active]).toEqual([false, 'content']);
  });

  it('on the workspace home, reads the home’s own list from the workspace record and appends to it', async () => {
    const writes: Array<[string, readonly string[] | null]> = [];
    const workspace: Record<string, unknown> = { default_app_tabs: ['net.avarok.calendar'], app_tabs: ['com.acme.kanban'] };
    const { result } = renderHook((): Model => useNodeTabs({
      nodeId: WORKSPACE_ROOT_ID, chatEnabled: false, nodeMetadata: ownTabsSource(WORKSPACE_ROOT_ID, undefined, workspace), workspaceMetadata: workspace, here: INSTALLS_UNKNOWN,
      writer: { writeNodeTabs: async (n: string, appIds: readonly string[] | null): Promise<void> => { writes.push([n, appIds]); }, setDefaultAppTabs: async (): Promise<void> => undefined },
    }));
    expect(appIdsOf(result.current.list)).toEqual(['com.acme.kanban']);
    const request: AppsModalRequest = addTabRequest(WORKSPACE_ROOT_ID, result.current);
    if (request.kind !== 'tab') throw new Error('"+" did not open the tab view');
    await act(async (): Promise<void> => { await request.target.add('work.synchronized.app'); });
    expect(writes).toEqual([[WORKSPACE_ROOT_ID, ['com.acme.kanban', 'work.synchronized.app']]]);
  });

  it('control: a stored node reads its own metadata, not the workspace record', () => {
    expect(ownTabsSource('n1', { app_tabs: [] }, { app_tabs: ['x.y.z'] })).toEqual({ app_tabs: [] });
  });
});
