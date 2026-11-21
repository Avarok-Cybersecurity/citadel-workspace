/**
 * After a page change that took focus with it, the next Tab reaches the skip link.
 *
 * One shell spans every signed-in page, so moving from /directory to /workspace
 * swaps only what is inside <main>. The directory focuses its search box on
 * mount; the change removes it and focus falls to <body>. Chromium keeps its
 * Tab starting point where the removed box was, so the next Tab went into the
 * new page's content, past the skip link and the whole sidebar: CI run
 * 44190289145, "the workspace can be entered without tabbing through the
 * sidebar", 3 of 3 attempts, with the breadcrumb inside <main> holding focus.
 *
 * jsdom has no starting point -- a Tab from <body> goes to the first tabbable
 * element whatever was removed -- so a Tab here cannot see the defect. What is
 * asserted is the mechanism Chromium needs: focus is ON the shell's first
 * element, which sits before the skip link with nothing tabbable between.
 *
 * Driven for real: the route table, react-router with the app's own flags and
 * the shell. Doubles, all agent-bound: the loader's connection gate
 * (passthrough), the pages' bodies, the top bar, the sidebar sections and the
 * shell's background hooks.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('@/components/ui/workspace-loader', () => ({
  WorkspaceLoader: ({ children }: { children: ReactNode }): JSX.Element => <>{children}</>,
}));
vi.mock('@/components/Office', () => ({ Office: (): JSX.Element => <h1>Office page</h1> }));
// The directory's own behaviour that matters here: its search box takes focus on
// mount, by ref in an effect as UserSearch does it.
vi.mock('@/pages/UserDirectory', async () => {
  const { useEffect, useRef } = await import('react');
  function DirectoryPage(): JSX.Element {
    const search: React.RefObject<HTMLInputElement> = useRef<HTMLInputElement>(null);
    useEffect((): void => { search.current?.focus(); }, []);
    return (
      <>
        <h1>Directory page</h1>
        <input ref={search} aria-label="Search users" />
      </>
    );
  }
  return { default: DirectoryPage };
});
vi.mock('@/components/layout/sidebar/TopBar', () => ({
  TopBar: (): JSX.Element => <header><button type="button">Toggle sidebar</button></header>,
}));
vi.mock('@/components/layout/sidebar/HierarchySidebar', () => ({ HierarchySidebar: (): JSX.Element => <button type="button">Root Workspace</button> }));
vi.mock('@/components/layout/sidebar/MembersSection', () => ({ MembersSection: (): null => null }));
vi.mock('@/components/layout/sidebar/FilesSection', () => ({ FilesSection: (): null => null }));
vi.mock('@/components/layout/sidebar/AdminSettingsSection', () => ({ AdminSettingsSection: (): null => null }));
vi.mock('@/components/terms/TermsGate', () => ({ TermsGate: (): null => null }));
vi.mock('@/components/calendar/background/CalendarInBackground', () => ({ CalendarInBackground: (): null => null }));
vi.mock('@/components/layout/use-remember-location', () => ({ useRememberLocation: (): void => {} }));

import { AppRoutes, ROUTER_FUTURE } from '@/app-routes';

const navigateRef: { current: NavigateFunction | null } = { current: null };
function CaptureNavigate(): null {
  navigateRef.current = useNavigate();
  return null;
}

async function renderAtDirectory(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/directory']} future={ROUTER_FUTURE}>
      <CaptureNavigate />
      <AppRoutes />
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { name: 'Directory page' });
}

async function goToWorkspace(): Promise<void> {
  await act(async (): Promise<void> => { navigateRef.current?.('/workspace'); });
  await screen.findByRole('heading', { name: 'Office page' });
}

describe('a page change inside the workspace shell', () => {
  it('restarts focus before the skip link when the outgoing page held it', async () => {
    await renderAtDirectory();
    const search: HTMLElement = screen.getByRole('textbox', { name: 'Search users' });
    // Waited for: the page is revealed by Suspense outside act, so its mount
    // effect (the focus) can run after the heading is found.
    await waitFor((): void => { expect(search, 'premise: the outgoing page holds focus').toHaveFocus(); });

    await goToWorkspace();
    expect(search.isConnected, 'premise: the change removed the focused element').toBe(false);

    const shell: HTMLElement = screen.getByTestId('app-shell');
    const active: Element | null = document.activeElement;
    expect(active, 'focus must not be left on <body>, where Chromium resumes from the removed box').not.toBe(document.body);
    expect(active, 'focus restarts on the shell\'s first element').toBe(shell.firstElementChild);

    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    await user.tab();
    expect(screen.getByRole('link', { name: /skip to main content/i })).toHaveFocus();
  });

  it('leaves focus alone when it is on a control that outlives the change', async () => {
    await renderAtDirectory();
    const sidebarControl: HTMLElement = screen.getByRole('button', { name: 'Root Workspace' });
    act((): void => { sidebarControl.focus(); });

    await goToWorkspace();
    expect(sidebarControl).toHaveFocus();
  });
});
