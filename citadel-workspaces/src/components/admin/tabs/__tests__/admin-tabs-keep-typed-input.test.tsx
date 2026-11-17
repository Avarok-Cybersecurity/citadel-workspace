/**
 * `state.nodes` is re-minted by ANY node event in the workspace — a teammate
 * saving an unrelated document is enough. Both admin tabs re-seeded their form
 * fields on every such change, replacing whatever was being typed AND resetting
 * the originals, so `hasChanges` flipped false and Save greyed out.
 *
 * These drive the real components through the exact churn: a new `state.nodes`
 * object whose contents for THIS node are unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor , type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceContext , type WorkspaceState } from '@/contexts/WorkspaceContext';
import { GeneralTab } from '../GeneralTab';
import type { UserEvent } from '@testing-library/user-event';

vi.mock('@/lib/workspace-service', () => ({
  default: { updateWorkspace: vi.fn(), updateNode: vi.fn() },
}));

const node: { id: string; name: string; description: string; } = { id: 'n1', name: 'Design', description: 'The design office' };

// Only the pieces GeneralTab reads; the real context type is far larger.
const ctx = (nodes: Record<string, unknown>): { state: WorkspaceState; } =>
  ({ state: { workspace: null, nodes } }) as unknown as React.ComponentProps<
    typeof WorkspaceContext.Provider
  >['value'];

function renderTab(nodes: Record<string, unknown>): RenderResult {
  return render(
    <WorkspaceContext.Provider value={ctx(nodes)}>
      <GeneralTab entityType="office" entityId="n1" onClose={() => {}} />
    </WorkspaceContext.Provider>,
  );
}

describe('GeneralTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps typed input when an unrelated node event re-mints state.nodes', async () => {
    const user: UserEvent = userEvent.setup();
    const { rerender } = renderTab({ n1: node });

    const nameInput: HTMLElement = await screen.findByDisplayValue('Design');
    await user.clear(nameInput);
    await user.type(nameInput, 'Design Ops');
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled();

    // A teammate saves a different document: same data for n1, new object identity.
    rerender(
      <WorkspaceContext.Provider value={ctx({ n1: { ...node }, other: { id: 'x' } })}>
        <GeneralTab entityType="office" entityId="n1" onClose={() => {}} />
      </WorkspaceContext.Provider>,
    );

    // The edit survives, and Save stays reachable — losing either is the defect.
    expect(screen.getByDisplayValue('Design Ops')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled();
  });

  it('still follows the store when the form has NOT been touched', async () => {
    const { rerender } = renderTab({ n1: node });
    await screen.findByDisplayValue('Design');

    rerender(
      <WorkspaceContext.Provider value={ctx({ n1: { ...node, name: 'Design (renamed)' } })}>
        <GeneralTab entityType="office" entityId="n1" onClose={() => {}} />
      </WorkspaceContext.Provider>,
    );

    // Protecting unsaved edits must not freeze an untouched form.
    await waitFor(() =>
      expect(screen.getByDisplayValue('Design (renamed)')).toBeInTheDocument(),
    );
  });

  it('re-seeds when the admin switches to a different entity', async () => {
    const user: UserEvent = userEvent.setup();
    const nodes: { n1: { id: string; name: string; description: string; }; n2: { id: string; name: string; description: string; }; } = { n1: node, n2: { id: 'n2', name: 'Legal', description: '' } };
    const { rerender } = render(
      <WorkspaceContext.Provider value={ctx(nodes)}>
        <GeneralTab entityType="office" entityId="n1" onClose={() => {}} />
      </WorkspaceContext.Provider>,
    );

    await user.type(await screen.findByDisplayValue('Design'), ' edited');

    rerender(
      <WorkspaceContext.Provider value={ctx(nodes)}>
        <GeneralTab entityType="office" entityId="n2" onClose={() => {}} />
      </WorkspaceContext.Provider>,
    );

    // A dirty form must not leak its text onto the next entity.
    await waitFor(() => expect(screen.getByDisplayValue('Legal')).toBeInTheDocument());
  });
});
