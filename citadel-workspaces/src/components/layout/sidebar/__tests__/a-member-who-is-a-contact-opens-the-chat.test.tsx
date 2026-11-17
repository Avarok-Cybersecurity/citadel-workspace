/**
 * Clicking a member who is also a contact opens the conversation.
 *
 * Found in #182's CI and then as a UX problem (2026-09-29): a node's member list
 * now lists everyone who can use the node, so the same person shows as a member
 * and as a contact, and the member row did nothing when clicked. Real: the row
 * component; the chat opener is the prop MemberListBody passes.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MemberListItems } from '../MemberListItems';
import type { User as WorkspaceMember } from '@/types/workspace-entities';

afterEach(cleanup);

const member = (username: string): WorkspaceMember =>
  ({ id: username, username, displayName: username, isOnline: null, role: 'member' }) as WorkspaceMember;

describe('a member row', () => {
  it('runs the opener it is given, and is inert where it is given none', () => {
    const opened: string[] = [];
    const openChatWith = (m: WorkspaceMember): (() => void) | null =>
      m.username === 'thomas' ? (): void => { opened.push(m.username); } : null;
    render(
      <SidebarProvider><TooltipProvider>
        <MemberListItems members={[member('thomas'), member('stranger')]} blocks={{ managePermissions: null, changeRole: null, remove: null }}
          nameOfLevel={(id: string): string => id} openFilesOf={() => null} openChatWith={openChatWith} currentUsername="me"
          onEditMember={vi.fn()} onRemoveMember={vi.fn()} onManagePermissions={vi.fn()} onShowAllMembers={vi.fn()} />
      </TooltipProvider></SidebarProvider>,
    );
    fireEvent.click(screen.getByTestId('member-row-thomas'));
    fireEvent.click(screen.getByTestId('member-row-stranger'));
    expect(opened).toEqual(['thomas']);
  });
});
