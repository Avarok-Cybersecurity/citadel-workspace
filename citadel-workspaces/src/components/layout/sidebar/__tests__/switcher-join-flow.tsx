/**
 * Drives the workspace switcher's "Join New Workspace" wizard for real, from the
 * menu to a submitted profile.
 *
 * Shared by the specs about that flow. The mocks each spec needs stay in the
 * spec, because vi.mock is hoisted per file.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { WorkspaceSwitcher } from '../WorkspaceSwitcher';

// jsdom has no layout, so no scrollIntoView; Radix Select calls it on the
// highlighted option when the list opens. A no-op: nothing here is about scroll.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}

export const JOIN_ADDRESS: string = 'two.example.com:12349';
export const JOIN_USERNAME: string = 'grace';

export async function renderSwitcher(): Promise<void> {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <MemoryRouter initialEntries={['/workspace?nodeId=n1']}>
          <ConfirmDialogProvider>
            <WorkspaceSwitcher workspaceName="Root Workspace" />
          </ConfirmDialogProvider>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

/** Menu → server → security (at `level`) → a filled-in profile, submitted. */
export async function joinFromTheSwitcher(level: string): Promise<void> {
  await userEvent.click(await screen.findByTestId('workspace-switcher'));
  await userEvent.click(await screen.findByText('Join New Workspace'));
  await userEvent.type(await screen.findByTestId('server-address-input'), JOIN_ADDRESS);
  await userEvent.click(screen.getByTestId('wizard-next'));

  await screen.findByText('Security Settings');
  await userEvent.click(screen.getByRole('combobox', { name: 'Security Level' }));
  await userEvent.click(await screen.findByRole('option', { name: level }));
  await userEvent.click(screen.getByTestId('wizard-next'));

  await screen.findByText('Create Your Profile');
  await userEvent.type(screen.getByLabelText(/full name/i), 'Grace Hopper');
  await userEvent.type(document.getElementById('username') as HTMLElement, JOIN_USERNAME);
  await userEvent.type(document.getElementById('password') as HTMLElement, 'cobol-1959-nav');
  await userEvent.type(document.getElementById('confirmPassword') as HTMLElement, 'cobol-1959-nav');
  await userEvent.click(screen.getByTestId('join-submit'));
}
