/**
 * The mobile navigation sheet closes when the page changes.
 *
 * It used to close by accident: every page mounted its own shell, so leaving
 * /workspace for /groups/:id threw the open sheet away with the rest of it.
 * With one shell for every page (WorkspaceShell) nothing did, and a group row
 * tapped in the sheet would open the chat underneath a sheet still covering it.
 * A change of search alone (another node, the file manager) is not a page
 * change and leaves it to the control that made it, as before.
 *
 * No doubles: the real SidebarProvider and router.
 */
import { describe, it, expect } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom';
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar';
import { ROUTER_FUTURE } from '@/app-routes';
import { CloseMobileSidebarOnPageChange } from '../close-mobile-sidebar-on-page-change';

const handles: { navigate: NavigateFunction | null; open: ((open: boolean) => void) | null } = { navigate: null, open: null };

function Probe(): JSX.Element {
  const { openMobile, setOpenMobile } = useSidebar();
  handles.navigate = useNavigate();
  handles.open = setOpenMobile;
  return <output data-testid="sheet">{openMobile ? 'open' : 'closed'}</output>;
}

function renderShell(): void {
  render(
    <MemoryRouter initialEntries={['/workspace?nodeId=a']} future={ROUTER_FUTURE}>
      <SidebarProvider>
        <CloseMobileSidebarOnPageChange />
        <Probe />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

async function go(to: string): Promise<void> {
  await act(async (): Promise<void> => { handles.navigate?.(to); });
}

describe('the mobile navigation sheet', () => {
  it('closes when the page changes', async () => {
    renderShell();
    act((): void => { handles.open?.(true); });
    expect(screen.getByTestId('sheet').textContent).toBe('open');

    await go('/groups/g1');
    expect(screen.getByTestId('sheet').textContent).toBe('closed');
  });

  it('stays as it was when only the search changes', async () => {
    renderShell();
    act((): void => { handles.open?.(true); });

    await go('/workspace?nodeId=b');
    expect(screen.getByTestId('sheet').textContent).toBe('open');
  });
});
