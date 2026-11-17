/**
 * The account list, the directory row, the profile card and the notification each drew an
 * initials-only circle of their own, so Ada had a photo in the sidebar and a grey "A" beside them.
 * They name the person now and `MemberAvatar` asks the roster for the picture.
 *
 * No mocks: the context, MemberAvatar and the Radix primitives are the production ones. jsdom never
 * loads images, so the picture is asserted through the source the avatar resolved.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { WorkspaceProvider, type WorkspaceState } from '@/contexts/WorkspaceContext';
import { AccountRow } from '@/components/AccountRows';
import { MemberListItem } from '@/pages/MemberListItem';
import { UserProfileCard } from '@/pages/UserProfileCard';
import NotificationItem from '@/components/notification/NotificationItem';
import { NotificationPriority, NotificationType } from '@/lib/notification-service/types';
import { MemberAvatar } from '../MemberAvatar';

const PICTURE: string = 'data:image/webp;base64,ADA';
const ADA: Record<string, unknown> = { id: 'ada', username: 'ada', displayName: 'Ada Lovelace', role: 'member', isOnline: true, avatarUrl: PICTURE };
const STATE: WorkspaceState = {
  members: { ada: ADA }, currentUser: { id: 'me', username: 'me', name: 'Me' },
  nodes: {}, treeSchema: null, loading: { workspace: false, members: false, nodes: false },
} as unknown as WorkspaceState;
const NOTHING = (): void => {};

function inWorkspace(children: ReactElement): ReactElement {
  return <WorkspaceProvider state={STATE}>{children}</WorkspaceProvider>;
}

describe('a person is drawn with their picture wherever they are named', () => {
  it.each<[string, ReactElement]>([
    ['the account list', <AccountRow key="a" username="ada" host="h" current={false} live lastConnected={null} signedOut={null} onSwitch={NOTHING} onDelete={null} />],
    ['the directory row', <MemberListItem key="m" member={{ ...ADA, isSelf: false, isContact: false } as never} variant="all" onSendMessage={NOTHING} onInvite={NOTHING} onSelect={NOTHING} />],
    ['the profile card', <UserProfileCard key="p" selectedUser={ADA as never} isSelf={false} isConnected={false} onClose={NOTHING} onSendMessage={NOTHING} onInvite={NOTHING} />],
    ['the notification', <NotificationItem key="n" notification={{ id: 'n', type: NotificationType.MESSAGE, title: 't', content: 'c', senderName: 'ada', priority: NotificationPriority.NORMAL, read: true, timestamp: 1 }} />],
  ])('%s', (_where, view) => {
    render(inWorkspace(view));
    expect(screen.getByTestId('member-avatar-ada').getAttribute('data-avatar-src')).toBe(PICTURE);
  });

  it('draws the presence dot beside the avatar, outside the clip that rounds it', () => {
    render(inWorkspace(<MemberAvatar username="ada" name="Ada Lovelace" online />));
    const dot: HTMLElement = screen.getByTestId('member-presence-ada');
    expect(screen.getByTestId('member-avatar-ada').contains(dot)).toBe(false);
  });

  it('draws no dot unless the person is online', () => {
    render(inWorkspace(<MemberAvatar username="ada" name="Ada Lovelace" />));
    expect(screen.queryByTestId('member-presence-ada')).toBeNull();
  });
});
