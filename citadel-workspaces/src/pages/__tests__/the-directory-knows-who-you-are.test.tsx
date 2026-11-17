/**
 * The directory offered you a connection request to yourself.
 *
 * Live 09-26, Hana High's own row read "Presence not known" with "Send a
 * connection request to Hana High" and "Message Hana High"; selecting it showed
 * "Not Connected -- Send Connection Request". The search box beside it already
 * excluded the reader; the list and the profile card did not.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemberListItem, type MemberDisplay } from '../MemberListItem';
import { UserProfileCard } from '../UserProfileCard';
import type { UserData } from '@/components/user/user-search-types';

afterEach(cleanup);

const me: MemberDisplay = { id: 'hana', displayName: 'Hana High', isOnline: true, isSelf: true, isContact: false };
const other: MemberDisplay = { id: 'nia', displayName: 'Nia Newcomer', isOnline: true, isSelf: false, isContact: false };

function row(member: MemberDisplay): void {
  render(<MemberListItem member={member} variant="all" onSendMessage={vi.fn()} onInvite={vi.fn()} onSelect={vi.fn()} />);
}

describe('your own directory row', () => {
  it('says it is you and offers nothing to do to yourself', () => {
    row(me);
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connection request/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Message/ })).toBeNull();
  });

  it("still offers both actions on someone else's row", () => {
    row(other);
    expect(screen.queryByText('You')).toBeNull();
    expect(screen.getByRole('button', { name: 'Send a connection request to Nia Newcomer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Message Nia Newcomer' })).toBeInTheDocument();
  });
});

describe('your own profile card', () => {
  const user: UserData = { id: 'hana', displayName: 'Hana High', isOnline: true };

  it('does not ask you to connect to yourself', () => {
    render(<UserProfileCard selectedUser={user} isSelf isConnected={false} onClose={vi.fn()} onSendMessage={vi.fn()} onInvite={vi.fn()} />);
    expect(screen.getByText('This is you')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Send Connection Request/ })).toBeNull();
  });
});
