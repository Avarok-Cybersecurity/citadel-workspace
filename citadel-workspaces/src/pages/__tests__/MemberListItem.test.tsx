import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemberListItem, type MemberDisplay } from '../MemberListItem';

/**
 * This row was a div with an onClick and no role, so the profile panel beside it
 * — which says "Click on a user or search to view their profile" — could only be
 * filled from the search box. Making the whole row role="button" then created a
 * second problem: a control containing two more controls, which screen readers
 * do not present consistently.
 *
 * The shape that works is one button for the identity and the actions as its
 * siblings. That is a structural property, so it is worth asserting structurally
 * rather than by driving a browser.
 */
const member: MemberDisplay = {
  id: 'member-1',
  displayName: 'Ada Lovelace',
  isOnline: true,
  isSelf: false,
  isContact: false,
};

function renderRow(overrides: Partial<Parameters<typeof MemberListItem>[0]> = {}): Parameters<typeof MemberListItem>[0] {
  const props: Parameters<typeof MemberListItem>[0] = {
    member,
    variant: 'all' as const,
    onSendMessage: vi.fn(),
    onInvite: vi.fn(),
    onSelect: vi.fn(),
    ...overrides,
  };
  render(<MemberListItem {...props} />);
  return props;
}

afterEach(cleanup);

describe('a row for someone who is already a contact', () => {
  // Found live (2026-09-29): Thomas Braun's row offered "Send a connection
  // request" while his card beside it said he was already a contact.
  it('offers a message, not another connection request', () => {
    renderRow({ member: { ...member, isContact: true } });
    expect(screen.queryByRole('button', { name: 'Send a connection request to Ada Lovelace' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Message Ada Lovelace' })).toBeInTheDocument();
  });

  it('still offers the request to someone who is not', () => {
    renderRow();
    expect(screen.getByRole('button', { name: 'Send a connection request to Ada Lovelace' })).toBeInTheDocument();
  });
});

describe('MemberListItem', () => {
  it('exposes the row as a named control that selects the member', () => {
    const { onSelect } = renderRow();

    const row: HTMLElement = screen.getByRole('button', { name: 'View profile for Ada Lovelace' });
    row.click();

    expect(onSelect).toHaveBeenCalledWith('member-1');
  });

  it('keeps the action buttons outside the row control', () => {
    renderRow();

    const row: HTMLElement = screen.getByRole('button', { name: 'View profile for Ada Lovelace' });
    const message: HTMLElement = screen.getByRole('button', { name: 'Message Ada Lovelace' });

    // The regression this guards: if the actions end up INSIDE the row button,
    // the row claims to be one control while containing others, and which one a
    // keyboard reaches is up to the browser.
    expect(row.contains(message)).toBe(false);
  });

  it('names every icon-only action for screen readers', () => {
    renderRow();

    // These were three buttons announced as "button", indistinguishable.
    expect(screen.getByRole('button', { name: /Message Ada Lovelace/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /connection request to Ada Lovelace/ })).toBeInTheDocument();
  });

  it('invites without also selecting the row', () => {
    const { onInvite, onSelect } = renderRow();

    screen.getByRole('button', { name: /connection request to Ada Lovelace/ }).click();

    expect(onInvite).toHaveBeenCalledWith('member-1');
    // Siblings rather than nested, so there is no bubbling to suppress — and no
    // stopPropagation to forget.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('says it does not know the last-seen time rather than inventing one', () => {
    renderRow({ member: { ...member, isOnline: false, lastActive: undefined } });

    // presence used to be Math.random() and lastActive a random offset, a
    // literal 0 (rendered as 1970) or `?? Date.now()` ("just now").
    expect(screen.getByText('Last seen unknown')).toBeInTheDocument();
  });
});
