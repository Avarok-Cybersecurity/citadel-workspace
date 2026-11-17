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
import { act, renderHook, type RenderHookResult } from '@testing-library/react';
import type { AppsModalRequest } from '@/lib/citadel-apps/apps-modal-store';

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
      nodeId: 'n1', chatEnabled: false, nodeMetadata: { app_tabs: tabs }, workspaceMetadata: { default_app_tabs: [] },
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
      nodeId: 'n2', chatEnabled: false, nodeMetadata: undefined, workspaceMetadata: { default_app_tabs: [] },
      writer: { writeNodeTabs: (): Promise<void> => Promise.reject(new Error('You may not change this page’s tabs.')), setDefaultAppTabs: async (): Promise<void> => undefined },
    }));
    const nope: AppsModalRequest = addTabRequest('n2', refused.result.current);
    if (nope.kind !== 'tab') throw new Error('"+" did not open the tab view');
    let refusedAdd: boolean = true;
    await act(async (): Promise<void> => { refusedAdd = await nope.target.add('net.avarok.calendar'); });
    expect([refusedAdd, refused.result.current.active]).toEqual([false, 'content']);
  });
});
