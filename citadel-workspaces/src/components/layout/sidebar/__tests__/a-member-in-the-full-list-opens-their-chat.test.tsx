/**
 * The sidebar shows the first few members and then "View all N members". Clicking a member opens
 * the chat with them (owner, 2026-10-15) -- in the sidebar it did, in the full list it did not:
 * the rows there had only an actions menu, so anyone past the first few could not be messaged
 * from the members list at all.
 */
import { describe, it, expect, vi, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AllMembersRow } from '../AllMembersRow';
import type { MemberActionBlocks } from '../member-actions-gate';
import type { User as WorkspaceMember } from '@/types/workspace-entities';

const member: WorkspaceMember = { id: 'bob', username: 'bob', displayName: 'Bob', role: 'member' } as WorkspaceMember;
const NO_BLOCKS: MemberActionBlocks = { managePermissions: null, changeRole: null, remove: null };
const noop = (): void => {};

function renderRow(onOpenChat: (() => void) | null, currentUsername: string): void {
  render(
    <AllMembersRow member={member} currentUsername={currentUsername} blocks={NO_BLOCKS} nameOfLevel={(id: string): string => id}
      onManagePermissions={noop} onEditMember={noop} onRemoveMember={noop} onOpenFiles={null} onOpenChat={onOpenChat} />,
  );
}

describe('a member in the "all members" list', () => {
  it('opens the chat with them when clicked', async () => {
    const open: Mock<() => void> = vi.fn();
    renderRow(open, 'alice');
    await userEvent.click(screen.getByRole('button', { name: 'Message Bob' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('is not a way to message yourself', () => {
    renderRow(null, 'bob');
    expect(screen.getByTestId('all-members-open-bob')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Message Bob' })).toBeNull();
  });
});
