/**
 * Keyboard focus on the workspace shell survives moving between its routes.
 *
 * Every signed-in page wrapped itself in its own `<AppLayout>`, so going from
 * /directory to /workspace unmounted the whole shell -- skip link, top bar,
 * sidebar -- and mounted an identical one. Navigation is a transition
 * (`v7_startTransition`), so the outgoing shell stays on screen until the
 * incoming route has rendered. A Tab pressed in that window focused the
 * outgoing shell's skip link; the commit then removed it and focus fell to
 * <body>. That is production run 44137617709's first attempt at "the workspace
 * can be entered without tabbing through the sidebar": every landmark it waited
 * for was already attached (they were the old route's), the Tab landed, and the
 * skip link it then asked about was a different element that never had focus.
 *
 * The incoming route is HELD here (its page suspends until released), which
 * makes the window as wide as needed instead of as wide as CI happens to be.
 *
 * Driven for real: the route table, react-router with the app's own flags, the
 * shell and its skip link. Doubles, all agent-bound and none deciding where the
 * shell lives: the loader's connection gate (passthrough), the pages' bodies,
 * and the shell's sidebar sections, top bar and background hooks.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom';
import type { ReactNode } from 'react';

interface Hold { state: { released: boolean; promise: Promise<void> }; release: () => void }

const hold: Hold = vi.hoisted((): Hold => {
  let release: () => void = (): void => {};
  const state: Hold['state'] = { released: false, promise: new Promise<void>((resolve) => { release = resolve; }) };
  return {
    state,
    release: (): void => { state.released = true; release(); },
  };
});

vi.mock('@/components/ui/workspace-loader', () => ({
  WorkspaceLoader: ({ children }: { children: ReactNode }): JSX.Element => <>{children}</>,
}));
vi.mock('@/components/Office', () => ({
  Office: (): JSX.Element => {
    if (!hold.state.released) throw hold.state.promise;
    return <h1>Office page</h1>;
  },
}));
vi.mock('@/pages/UserDirectory', () => ({ default: (): JSX.Element => <h1>Directory page</h1> }));
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

describe('the workspace shell across a route change', () => {
  it('keeps focus on the skip link a Tab reached while the next route was still rendering', async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/directory']} future={ROUTER_FUTURE}>
        <CaptureNavigate />
        <AppRoutes />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'Directory page' });

    // The test's own move: navigate, then Tab while the incoming route has not committed.
    await act(async (): Promise<void> => { navigateRef.current?.('/workspace'); });
    expect(screen.getByRole('heading', { name: 'Directory page' }), 'the hold must keep the outgoing route on screen').toBeTruthy();

    await user.tab();
    const reached: Element | null = document.activeElement;
    expect(reached, 'the first Tab stop is the skip link').toBe(screen.getByRole('link', { name: /skip to main content/i }));

    await act(async (): Promise<void> => { hold.release(); });
    await screen.findByRole('heading', { name: 'Office page' });

    const skip: HTMLElement = screen.getByRole('link', { name: /skip to main content/i });
    expect(skip, 'the skip link the Tab reached is the one on screen now').toBe(reached);
    expect(skip).toHaveFocus();
  });
});
