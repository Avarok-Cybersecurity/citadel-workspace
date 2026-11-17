/**
 * A member in the sidebar is shown with their circular avatar, from the one avatar source.
 *
 * Live (owner, 2026-09-27): the OFFICE MEMBERS rows showed a shield icon, the name and the role
 * badge -- no avatar -- and messages showed none either, while the top bar did. Every avatar now
 * resolves through `useAvatarUrl` (the workspace state), so a picture set in profile settings
 * appears everywhere at once.
 *
 * No mocks: the list, the avatar, the context and the Radix primitives are the production ones.
 * jsdom never loads images, so Radix keeps the fallback mounted; the image's presence is asserted
 * through the source the avatar resolved, which is the part this defect was missing.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WorkspaceProvider, type WorkspaceState } from '@/contexts/WorkspaceContext';
import { MemberListItems } from '@/components/layout/sidebar/MemberListItems';
import type { User as WorkspaceMember } from '@/types/workspace-entities';

const THOMAS: WorkspaceMember = { id: 'thomas', username: 'thomas', displayName: 'Thomas Braun', role: 'admin', isOnline: true } as WorkspaceMember;

function stateWith(member: WorkspaceMember, currentUserAvatar?: string): WorkspaceState {
  return {
    members: { [member.id]: member },
    currentUser: { id: 'thomas', username: 'thomas', name: 'Thomas Braun', avatarUrl: currentUserAvatar },
    nodes: {}, treeSchema: null, loading: { workspace: false, members: false, nodes: false },
  } as unknown as WorkspaceState;
}

function ui(state: WorkspaceState, members: WorkspaceMember[]): JSX.Element {
  return (
    <WorkspaceProvider state={state}><TooltipProvider><SidebarProvider>
      <MemberListItems members={members} blocks={{ managePermissions: null, changeRole: null, remove: null }} nameOfLevel={(id: string): string => id} currentUsername="thomas" onEditMember={(): void => {}} openFilesOf={() => null} openChatWith={(): null => null}
        onRemoveMember={(): void => {}} onManagePermissions={(): void => {}} onShowAllMembers={(): void => {}} />
    </SidebarProvider></TooltipProvider></WorkspaceProvider>
  );
}

describe('a sidebar member row', () => {
  it('renders the member avatar with their picture as its source', () => {
    const m: WorkspaceMember = { ...THOMAS, avatarUrl: 'data:image/webp;base64,ROSTER' };
    render(ui(stateWith(m), [m]));
    expect(screen.getByTestId('member-avatar-thomas').getAttribute('data-avatar-src')).toBe('data:image/webp;base64,ROSTER');
  });

  it('falls back to the member initials when there is no picture', () => {
    render(ui(stateWith(THOMAS), [THOMAS]));
    expect(screen.getByTestId('member-avatar-thomas').textContent).toContain('TB');
  });

  it("shows your own freshest picture (the profile's) over a stale roster copy", () => {
    const m: WorkspaceMember = { ...THOMAS, avatarUrl: 'data:image/webp;base64,OLD' };
    render(ui(stateWith(m, 'data:image/webp;base64,NEW'), [m]));
    expect(screen.getByTestId('member-avatar-thomas').getAttribute('data-avatar-src')).toBe('data:image/webp;base64,NEW');
  });

  it('follows the store: a changed picture reaches an already-rendered row', () => {
    const { rerender } = render(ui(stateWith(THOMAS), [THOMAS]));
    expect(screen.getByTestId('member-avatar-thomas').getAttribute('data-avatar-src')).toBe('');
    rerender(ui(stateWith(THOMAS, 'data:image/webp;base64,SET'), [THOMAS]));
    expect(screen.getByTestId('member-avatar-thomas').getAttribute('data-avatar-src')).toBe('data:image/webp;base64,SET');
  });
});
