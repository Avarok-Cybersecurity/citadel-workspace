/**
 * The admin Chat tab shows the node's stored chat setting, and nothing until it has one.
 *
 * With the node not yet in the workspace store, the tab rendered its switch ON
 * (`node ? node.chat_enabled : true`): a guess shown as fact, and a Save pressed then would
 * write the guess. Now that new nodes really are created with chat on, the guess would usually
 * be right, which is exactly how it would stop being noticed.
 *
 * No mocks: the tab and the context are production code; only the store's contents are chosen.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkspaceContext } from '@/contexts/WorkspaceContext';
import { ChatSettingsTab } from '../ChatSettingsTab';
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';

type ContextValue = React.ContextType<typeof WorkspaceContext>;

function renderWith(nodes: Record<string, DomainNode>, entityType: 'office' | 'workspace' = 'office'): void {
  const value: ContextValue = { state: { nodes } } as unknown as ContextValue;
  render(
    <WorkspaceContext.Provider value={value}>
      <ChatSettingsTab entityType={entityType} entityId="o1" onClose={(): void => {}} />
    </WorkspaceContext.Provider>,
  );
}

describe('the admin chat switch', () => {
  // Caught by CI (test:admin-modal): the workspace root is never a node in the store, so a tab
  // waiting for one spun for ever and never said where chat is configured.
  it("at the workspace level says where chat is set, with no node to wait for", () => {
    renderWith({}, 'workspace');
    expect(screen.getByTestId('chat-tab-workspace-message')).toBeTruthy();
    expect(screen.queryByTestId('chat-tab-loading')).toBeNull();
  });

  it('waits for the node rather than guessing chat is on', () => {
    renderWith({});
    expect(screen.getByTestId('chat-tab-loading')).toBeTruthy();
    expect(screen.queryByTestId('chat-enabled-toggle')).toBeNull();
  });

  it('shows chat off for a node stored with chat off', () => {
    renderWith({ o1: { id: 'o1', chat_enabled: false, rules: null } as unknown as DomainNode });
    expect(screen.getByTestId('chat-enabled-toggle').getAttribute('aria-checked')).toBe('false');
  });

  it('shows chat on for a node stored with chat on', () => {
    renderWith({ o1: { id: 'o1', chat_enabled: true, rules: null } as unknown as DomainNode });
    expect(screen.getByTestId('chat-enabled-toggle').getAttribute('aria-checked')).toBe('true');
  });
});
