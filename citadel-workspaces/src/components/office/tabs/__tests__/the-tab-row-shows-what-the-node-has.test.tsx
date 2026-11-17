/**
 * The node pane's tab row: what it shows and to whom.
 *
 * Real: `useNodeTabs`, the derivation, the row, the menu and the notice. Doubles: the chat and
 * call components (they need a live session and are not what is under test), the permission
 * hook (the answer is the input here; its own fetching is tested in hooks/), and the writer, the
 * I/O boundary, which records what would be sent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { forgetAllTabs, rememberTab } from '@/lib/node-tabs/tab-memory';

const granted: Set<string> = new Set();

vi.mock('../../NodeChat', () => ({ NodeChat: (): JSX.Element => <div data-testid="chat-view" /> }));
vi.mock('@/components/call/GroupCallControls', () => ({ GroupCallControls: (): JSX.Element => <div /> }));
vi.mock('@/components/call/GroupCallDock', () => ({ GroupCallDock: (): JSX.Element => <div /> }));
vi.mock('@/hooks/use-domain-call-members', () => ({ useDomainCallMembers: (): unknown => ({ callable: [], notConnected: [] }) }));
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (_domain: string, permission: string): unknown => ({
    allowed: granted.has(permission), loading: false, unanswered: false, answered: true,
  }),
}));

const { NodeTabs } = await import('../NodeTabs');
const { useNodeTabs } = await import('../use-node-tabs');
type Writer = import('../use-node-tabs').NodeTabsWriter;

const writes: Array<{ node?: string; appIds: readonly string[] | null; everywhere?: true }> = [];
const WRITER: Writer = {
  writeNodeTabs: async (node: string, appIds: readonly string[] | null): Promise<void> => { writes.push({ node, appIds }); },
  setDefaultAppTabs: async (appIds: readonly string[]): Promise<void> => { writes.push({ appIds, everywhere: true }); },
};

function Pane({ node, workspace, chat }: { node?: Record<string, unknown>; workspace?: Record<string, unknown>; chat: boolean }): JSX.Element {
  const model: import('../use-node-tabs').NodeTabsModel = useNodeTabs({ nodeId: 'n1', chatEnabled: chat, nodeMetadata: node, workspaceMetadata: workspace, writer: WRITER });
  return (
    <NodeTabs
      model={model}
      contentView={<div data-testid="the-page" />}
      chatChannelId={chat ? 'ch-1' : null}
      nodeId="n1"
      roomName="Platform"
      currentUserId="1"
      currentUserName="alice"
      currentUserCid={1n}
      rules={null}
      appPanel={(appId: string): JSX.Element => <div data-testid={`panel-${appId}`} />}
      onAdd={model.canConfigure ? (): void => undefined : null}
    />
  );
}

const tabNames = (): string[] => within(screen.getByRole('tablist')).getAllByRole('tab').map((t: HTMLElement): string => t.textContent ?? '');

describe('the tab row of a node', () => {
  beforeEach((): void => { cleanup(); forgetAllTabs(); granted.clear(); writes.length = 0; });

  it('shows the page, chat, then the app tabs, and "+" only to who may add one', () => {
    render(<Pane chat node={{ app_tabs: ['com.acme.kanban', 'net.avarok.calendar'] }} workspace={{ default_app_tabs: [] }} />);
    expect(tabNames()).toEqual(['Page', 'Chat', 'Kanban', 'Calendar']);
    expect(screen.queryByRole('button', { name: 'Add a tab' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tab options' })).toBeNull();
    cleanup();

    granted.add('UpdateNodeSettings');
    render(<Pane chat node={{ app_tabs: ['com.acme.kanban'] }} workspace={{ default_app_tabs: [] }} />);
    const add: HTMLElement = screen.getByRole('button', { name: 'Add a tab' });
    expect(add.className).toContain('h-[44px]');
    expect(add.className).toContain('w-[44px]');
  });

  it('follows the workspace default when the node has no list', () => {
    render(<Pane chat={false} workspace={{ default_app_tabs: ['net.avarok.calendar'] }} />);
    expect(tabNames()).toEqual(['Page', 'Calendar']);
  });

  it('opens an app tab on its own panel', async () => {
    render(<Pane chat={false} node={{ app_tabs: ['com.acme.kanban'] }} workspace={{ default_app_tabs: [] }} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Kanban' }));
    expect(screen.getByTestId('panel-com.acme.kanban')).toBeTruthy();
    expect(screen.queryByTestId('the-page')).toBeNull();
  });

  it('offers reorder and remove for the open app tab, and sends the new order', async () => {
    granted.add('UpdateNodeSettings');
    rememberTab('n1', 'app:com.acme.kanban');
    render(<Pane chat={false} node={{ app_tabs: ['com.acme.kanban', 'net.avarok.calendar'] }} workspace={{ default_app_tabs: [] }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Tab options' }));
    expect(screen.getByRole('menuitem', { name: 'Move Kanban left' }).getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move Kanban right' }));
    expect(writes).toEqual([{ node: 'n1', appIds: ['net.avarok.calendar', 'com.acme.kanban'] }]);
  });

  it('removes a tab by writing the list without it, never the page or chat', async () => {
    granted.add('UpdateNodeSettings');
    rememberTab('n1', 'app:com.acme.kanban');
    render(<Pane chat node={{ app_tabs: ['com.acme.kanban'] }} workspace={{ default_app_tabs: [] }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Tab options' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove the Kanban tab' }));
    expect(writes).toEqual([{ node: 'n1', appIds: [] }]);
  });

  it('tells an administrator the workspace has no default, and no one else', () => {
    render(<Pane chat />);
    expect(screen.queryByTestId('node-tab-notice')).toBeNull();
    cleanup();
    granted.add('EditWorkspaceConfig');
    render(<Pane chat />);
    expect(screen.getByTestId('node-tab-notice').textContent).toContain('no default tabs yet');
  });

  it('makes this page’s tabs every page’s default from the notice', async () => {
    granted.add('EditWorkspaceConfig');
    render(<Pane chat={false} node={{ app_tabs: ['com.acme.kanban'] }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Tab options' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Use these tabs on every page' }));
    expect(writes).toEqual([{ appIds: ['com.acme.kanban'], everywhere: true }]);
  });

  it('moves between tabs with the arrow keys, through the app tabs', async () => {
    render(<Pane chat node={{ app_tabs: ['com.acme.kanban', 'net.avarok.calendar'] }} workspace={{ default_app_tabs: [] }} />);
    screen.getByRole('tab', { name: 'Page' }).focus();
    for (const next of ['Chat', 'Kanban', 'Calendar']) {
      await userEvent.keyboard('{ArrowRight}');
      expect(document.activeElement?.textContent).toBe(next);
      expect(screen.getByRole('tab', { selected: true }).textContent).toBe(next);
    }
  });
});
