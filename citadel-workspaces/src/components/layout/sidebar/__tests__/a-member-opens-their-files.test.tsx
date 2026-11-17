/**
 * A member's menu opens the storage you share with them, and right-clicking the
 * row opens that same menu.
 *
 * Owner (2026-10-16): "right-clicking another user opens their storage". Real:
 * the row and its menu; the opener is the prop MemberListBody passes, whose
 * address is pinned in a-file-manager-link-says-whose-files-and-where.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MemberListItems } from '../MemberListItems';
import type { User as WorkspaceMember } from '@/types/workspace-entities';

afterEach(cleanup);

const member = (username: string): WorkspaceMember =>
  ({ id: username, username, displayName: username, isOnline: null, role: 'member' }) as WorkspaceMember;

function list(opened: string[]): void {
  const openFilesOf = (m: WorkspaceMember): (() => void) | null =>
    m.username === 'me' ? null : (): void => { opened.push(m.username); };
  render(
    <SidebarProvider><TooltipProvider>
      <MemberListItems members={[member('thomas'), member('me')]} blocks={{ managePermissions: null, changeRole: null, remove: null }}
        nameOfLevel={(id: string): string => id} openChatWith={() => null} openFilesOf={openFilesOf} currentUsername="me"
        onEditMember={vi.fn()} onRemoveMember={vi.fn()} onManagePermissions={vi.fn()} onShowAllMembers={vi.fn()} />
    </TooltipProvider></SidebarProvider>,
  );
}

describe("a member's files", () => {
  it('open from the ⋯ menu', async () => {
    const opened: string[] = [];
    list(opened);
    await userEvent.click(screen.getByRole('button', { name: 'Actions for thomas' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Open their files' }));
    expect(opened).toEqual(['thomas']);
  });

  it('open from a right-click on the row, which raises the same menu', async () => {
    const opened: string[] = [];
    list(opened);
    fireEvent.contextMenu(screen.getByTestId('member-row-thomas'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Open their files' }));
    expect(opened).toEqual(['thomas']);
  });

  it('are not offered on your own row, which has no storage shared with yourself', () => {
    list([]);
    fireEvent.contextMenu(screen.getByTestId('member-row-me'));
    expect(screen.queryByRole('menuitem', { name: 'Open their files' })).toBeNull();
  });
});
