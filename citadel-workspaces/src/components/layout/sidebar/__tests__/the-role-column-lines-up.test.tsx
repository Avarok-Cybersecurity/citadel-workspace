/**
 * Every sidebar row ends in the same column: role icon, then a 24px actions slot.
 *
 * Live, an "Admin" pill sat left of a "Member" pill. The actions button was not
 * rendered on your own row, so every OTHER row carried 24px more at its right
 * edge and its badge was pushed in by that much. jsdom has no layout, so this
 * pins the structure that makes the widths equal: the trailing box exists on
 * every row and has the same sizing classes. The geometric check is the
 * round's browser verification.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MemberListItems } from '../MemberListItems';
import type { User as WorkspaceMember } from '@/types/workspace-entities';

const SIZING: readonly string[] = ['tap-target', 'h-6', 'w-6', 'shrink-0'];

function member(username: string, role: string): WorkspaceMember {
  return { id: username, username, displayName: username, role, isOnline: true } as WorkspaceMember;
}

function renderRows(members: WorkspaceMember[], currentUsername: string): void {
  render(
    <SidebarProvider>
      <TooltipProvider>
        <MemberListItems members={members} blocks={{ managePermissions: null, changeRole: null, remove: null }} nameOfLevel={(id: string): string => id} currentUsername={currentUsername} onEditMember={vi.fn()} openFilesOf={() => null} openChatWith={(): null => null} onRemoveMember={vi.fn()} onManagePermissions={vi.fn()} onShowAllMembers={vi.fn()} />
      </TooltipProvider>
    </SidebarProvider>,
  );
}

function trailingBox(username: string): Element {
  const row: Element | null = screen.getByTestId(`member-row-${username}`).parentElement;
  if (!row?.lastElementChild) throw new Error(`row for ${username} has no trailing box`);
  return row.lastElementChild;
}

describe('the sidebar member list', () => {
  it('ends your own row in a slot the same size as everyone else’s actions button', () => {
    renderRows([member('thomas', 'admin'), member('johndoe', 'member')], 'johndoe');
    const own: Element = trailingBox('johndoe');
    const other: Element = trailingBox('thomas');
    expect(own.getAttribute('data-testid')).toBe('member-actions-slot');
    expect(other.tagName).toBe('BUTTON');
    for (const cls of SIZING) {
      expect(own.classList.contains(cls), `own row slot lacks ${cls}`).toBe(true);
      expect(other.classList.contains(cls), `actions button lacks ${cls}`).toBe(true);
    }
  });

  it('shows each role as a named icon, not as text', () => {
    renderRows([member('o', 'owner'), member('a', 'admin'), member('m', 'member'), member('g', 'guest')], 'o');
    const icons: Record<string, string> = { Owner: 'lucide-crown', Admin: 'lucide-shield-check', Member: 'lucide-user', Guest: 'lucide-ticket' };
    for (const [name, icon] of Object.entries(icons)) {
      const chip: HTMLElement = screen.getByRole('img', { name });
      expect(chip.querySelector('svg')?.classList.contains(icon), `${name} should draw ${icon}`).toBe(true);
      expect(screen.queryByText(name)).toBeNull();
    }
  });
});
