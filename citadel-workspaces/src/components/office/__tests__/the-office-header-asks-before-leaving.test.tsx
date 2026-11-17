/**
 * The office header's own ways out ask before discarding an open edit.
 *
 * The Messages icon and the title's "go up" called `navigate` directly. Both
 * unmount the editor -- `/messages` is another page, and dropping `nodeId`
 * renders the workspace root -- so twenty minutes of writing went with one
 * click on the chrome right above it, while every sidebar control asked. The
 * title is breadcrumbs now; going up is the workspace crumb, through the
 * sidebar's own select.
 *
 * Renders the REAL BaseOffice and OfficeLayout. Mocked, as in
 * editor-buffer-guard.test.tsx: MDX compilation (does not run under jsdom), and
 * the workspace store and permission hook (both need a live session). The
 * guard, the confirm dialog and the router are real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter, useLocation, type Location } from 'react-router-dom';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { clearUnsavedEditsForTests } from '@/lib/unsaved-edits';

vi.mock('@mdx-js/mdx', () => ({
  evaluate: async (): Promise<{ default: () => null; }> => ({ default: (): null => null }),
}));
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (): { allowed: boolean; reason: null; } => ({ allowed: true, reason: null }),
}));
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: (): { state: { nodes: Record<string, { id: string; name: string; mdx_content: string; }>; loading: { nodes: boolean; }; currentUser: { id: string; }; }; setState: () => void; } => ({
    state: { nodes: { n1: { id: 'n1', name: 'Engineering', mdx_content: '# Saved body' } }, loading: { nodes: false }, currentUser: { id: 'u1' } },
    setState: (): void => {},
  }),
}));

import { BaseOffice } from '../BaseOffice';

const START: string = '/workspace?nodeId=n1';

function Where(): JSX.Element {
  const location: Location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

async function editSomething(user: UserEvent): Promise<HTMLElement> {
  render(
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={[START]}>
        <Where />
        <BaseOffice title="Engineering" getInitialContent={(): string => '# Template'} nodeId="n1" />
      </MemoryRouter>
    </ConfirmDialogProvider>,
  );
  await user.click(await screen.findByRole('button', { name: /edit/i }));
  const textarea: HTMLElement = await screen.findByRole('textbox');
  await user.type(textarea, ' and unsaved work');
  return textarea;
}

describe('leaving a dirty document from the office header', () => {
  beforeEach(() => clearUnsavedEditsForTests());

  it.each([
    ['the Messages icon', (): HTMLElement => screen.getByTitle('Messages')],
    ['the workspace breadcrumb', (): HTMLElement => screen.getByRole('button', { name: 'Your workspace' })],
  ])('%s asks, and "keep editing" stays put with the buffer intact', async (_name: string, control: () => HTMLElement) => {
    const user: UserEvent = userEvent.setup();
    const textarea: HTMLElement = await editSomething(user);

    await user.click(control());

    expect(await screen.findByText('Discard your changes?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.getByTestId('where')).toHaveTextContent(START);
    expect(textarea).toHaveValue('# Saved body and unsaved work');
  });

  it('the Messages icon still goes once the user agrees to discard', async () => {
    const user: UserEvent = userEvent.setup();
    await editSomething(user);

    await user.click(screen.getByTitle('Messages'));
    await user.click(await screen.findByRole('button', { name: 'Discard' }));

    expect(screen.getByTestId('where')).toHaveTextContent(/^\/messages$/);
  });
});
