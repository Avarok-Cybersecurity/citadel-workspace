/**
 * On a phone the sidebar is a dialog, and a dialog needs a name.
 *
 * Found live (2026-09-29, 390 px): opening the navigation drawer logged Radix's
 * "DialogContent requires a DialogTitle" -- a screen reader announced an
 * unnamed dialog. Real: the sidebar and its sheet; only the width is set.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Sidebar, SidebarProvider, useSidebar } from '@/components/ui/sidebar';

function Opener(): JSX.Element {
  const { toggleSidebar } = useSidebar();
  return <button type="button" onClick={toggleSidebar}>open</button>;
}

beforeEach((): void => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 }); });

describe('the sidebar at phone width', () => {
  it('opens as a dialog named for what it is', async () => {
    render(<SidebarProvider><Opener /><Sidebar><p>tree</p></Sidebar></SidebarProvider>);
    await act(async (): Promise<void> => { screen.getByText('open').click(); });
    expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeInTheDocument();
  });
});
