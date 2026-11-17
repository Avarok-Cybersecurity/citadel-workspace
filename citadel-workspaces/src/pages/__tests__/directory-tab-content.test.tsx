/**
 * What the directory says when a tab has nobody in it.
 *
 * It rendered zero rows and nothing else, and the Online tab is commonly empty
 * — so the most likely first visit to this page was a blank panel. "Nobody is
 * online" and "nobody is here at all" are different facts and the user can act
 * on exactly one of them.
 */

import type { ComponentProps } from 'react';
import { describe, it, expect, vi  } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DirectoryTabContent } from '../DirectoryTabContent';
import type { MemberDisplay } from '../MemberListItem';

const member = (id: string, isOnline: boolean): MemberDisplay =>
  ({ id, displayName: `User ${id}`, isOnline, isSelf: false, isContact: false });

const noop: ReturnType<typeof vi.fn> = vi.fn();
const handlers: Pick<ComponentProps<typeof DirectoryTabContent>, 'onSendMessage' | 'onInvite' | 'onSelect'> =
  { onSendMessage: noop, onInvite: noop, onSelect: noop };

describe('an empty directory tab', () => {
  it('says nobody is online when the workspace has offline members', () => {
    render(
      <DirectoryTabContent tab="online" members={[]} totalMembers={3} presenceUnknown={0} loading={false} unavailable={false} {...handlers} />,
    );

    expect(screen.getByText(/nobody is online/i)).toBeInTheDocument();
    expect(screen.getByText(/currently offline/i)).toBeInTheDocument();
  });

  it('does not call members offline when their presence is not known', () => {
    render(
      <DirectoryTabContent tab="online" members={[]} totalMembers={5} presenceUnknown={5} loading={false} unavailable={false} {...handlers} />,
    );

    // Live: a member with no contacts saw "Everyone ... is currently offline"
    // while three of the five were online. Not knowing is not offline.
    expect(screen.queryByText(/currently offline/i)).not.toBeInTheDocument();
    expect(screen.getByText(/presence isn't known yet for 5 of 5/i)).toBeInTheDocument();
  });

  it('distinguishes an empty workspace from an all-offline one', () => {
    render(
      <DirectoryTabContent tab="online" members={[]} totalMembers={0} presenceUnknown={0} loading={false} unavailable={false} {...handlers} />,
    );

    // Telling a lone user "everyone is offline" would be a lie about people
    // who do not exist, and points them at waiting instead of inviting.
    expect(screen.queryByText(/currently offline/i)).not.toBeInTheDocument();
    expect(screen.getByText(/nobody in this workspace yet/i)).toBeInTheDocument();
  });

  it('tells a user with no members what to do about it', () => {
    render(<DirectoryTabContent tab="all" members={[]} totalMembers={0} presenceUnknown={0} loading={false} unavailable={false} {...handlers} />);

    expect(screen.getByText(/no members yet/i)).toBeInTheDocument();
    expect(screen.getByText(/invite someone/i)).toBeInTheDocument();
  });

  it('renders the members and no empty state when there are any', () => {
    render(
      <DirectoryTabContent
        tab="all"
        members={[member('1', true), member('2', false)]}
        totalMembers={2}
        presenceUnknown={0}
        loading={false} unavailable={false} {...handlers}
      />,
    );

    expect(screen.getByText('User 1')).toBeInTheDocument();
    expect(screen.getByText('User 2')).toBeInTheDocument();
    expect(screen.queryByText(/no members yet/i)).not.toBeInTheDocument();
  });
});

describe('a directory tab before the member list has answered', () => {
  it('says it is loading, not that nobody is here', () => {
    render(<DirectoryTabContent tab="all" members={[]} totalMembers={0} presenceUnknown={0} loading unavailable={false} {...handlers} />);

    // `listMembers` resolves when the request is SENT; the empty state is a statement of fact.
    expect(screen.getByTestId('directory-loading')).toBeInTheDocument();
    expect(screen.queryByText(/no members yet/i)).not.toBeInTheDocument();
  });

  it('says the list could not be loaded when nothing answered, instead of calling the workspace empty', () => {
    render(<DirectoryTabContent tab="all" members={[]} totalMembers={0} presenceUnknown={0} loading={false} unavailable {...handlers} />);

    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/no members yet/i)).not.toBeInTheDocument();
  });

  it('still shows the members it has while a refresh is in flight', () => {
    render(<DirectoryTabContent tab="all" members={[member('a', true)]} totalMembers={1} presenceUnknown={0} loading unavailable={false} {...handlers} />);

    expect(screen.getByText('User a')).toBeInTheDocument();
    expect(screen.queryByTestId('directory-loading')).not.toBeInTheDocument();
  });
});
