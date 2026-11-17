/**
 * Beside a long name, the NAME truncates and the role badge stays whole.
 *
 * Live at a 280px sidebar the badge read "Mer": every box between the row and
 * the badge was a flex child at `min-width: auto`, so none could be narrower
 * than the name, and the menu button's `overflow-hidden` cut the badge off
 * instead. jsdom has no layout, so this pins the classes that make the chain
 * shrinkable; the geometric check is in the round's browser verification.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MemberListItems } from '../MemberListItems';
import type { User as WorkspaceMember } from '@/types/workspace-entities';

const LONG: string = 'Maximilian Alexander Featherstonehaugh-Wolfeschlegel';

function renderRow(): HTMLElement {
  const member: WorkspaceMember = { id: 'max0924', username: 'max0924', displayName: LONG, role: 'member', isOnline: true } as WorkspaceMember;
  render(
    <SidebarProvider>
      <TooltipProvider>
        <MemberListItems members={[member]} blocks={{ managePermissions: null, changeRole: null, remove: null }} nameOfLevel={(id: string): string => id} currentUsername="alice0924" onEditMember={vi.fn()} openFilesOf={() => null} openChatWith={(): null => null} onRemoveMember={vi.fn()} onManagePermissions={vi.fn()} onShowAllMembers={vi.fn()} />
      </TooltipProvider>
    </SidebarProvider>,
  );
  return screen.getByRole('img', { name: 'Member' });
}

describe('a sidebar member row', () => {
  it('never lets the role icon shrink', () => {
    expect(renderRow().className).toMatch(/\bshrink-0\b/);
  });

  it('lets every box from the row down to the name shrink below its content', () => {
    const badge: HTMLElement = renderRow();
    const name: HTMLElement = screen.getByText(LONG);
    expect(name.className).toMatch(/\bmin-w-0\b/);
    expect(name.className).toMatch(/\btruncate\b/);
    // Every ancestor up to the row that is a flex item must be allowed below its content width.
    let box: HTMLElement | null = badge.parentElement;
    const chain: string[] = [];
    while (box && box.tagName !== 'LI') {
      chain.push(box.className);
      box = box.parentElement;
    }
    expect(chain.length).toBeGreaterThanOrEqual(3);
    for (const cls of chain) expect(cls, `a box in the chain cannot shrink: "${cls}"`).toMatch(/\bmin-w-0\b/);
  });
});
