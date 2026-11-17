/**
 * The person you are talking to is drawn with their picture, everywhere a conversation names them.
 *
 * Live (testers, 2026-10-04): "needs your profile picture" on the P2P conversation header, and
 * "it also takes away your profile picture" after clicking a member to open the chat. The
 * sidebar and group messages already resolved pictures through `MemberAvatar`; the P2P header,
 * the conversation list and the P2P bubbles each built a bare initials-only Avatar of their own,
 * so the picture vanished the moment a member was opened as a conversation.
 *
 * The roster key is the USERNAME while the header is given a DISPLAY name, which is why these
 * render a peer whose two differ: matching on the display name would find nothing.
 *
 * No mocks: the context, MemberAvatar and the Radix primitives are the production ones. jsdom
 * never loads images, so the picture is asserted through the source the avatar resolved.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { WorkspaceProvider, type WorkspaceState } from '@/contexts/WorkspaceContext';
import { MessagingLayerType } from '@/types/messaging-layer';
import type { P2PMessage, PeerPresence } from '@/lib/p2p';
import type { User as WorkspaceMember } from '@/types/workspace-entities';
import { P2PChatHeader } from '../P2PChatHeader';
import { ConversationPeerItem } from '../ConversationPeerItem';
import { TextBubble } from '../bubbles/TextBubble';

const PICTURE: string = 'data:image/webp;base64,ADA';
const ADA: WorkspaceMember = { id: 'ada', username: 'ada', displayName: 'Ada Lovelace', role: 'member', isOnline: true, avatarUrl: PICTURE } as WorkspaceMember;
const ONLINE: PeerPresence = { status: MessagingLayerType.Online, lastUpdate: 0 };

function inWorkspace(children: ReactElement, member: WorkspaceMember = ADA): ReactElement {
  const state: WorkspaceState = {
    members: { [member.id]: member }, currentUser: { id: 'me', username: 'me', name: 'Me' },
    nodes: {}, treeSchema: null, loading: { workspace: false, members: false, nodes: false },
  } as unknown as WorkspaceState;
  return <WorkspaceProvider state={state}>{children}</WorkspaceProvider>;
}

const header: ReactElement = (
  <P2PChatHeader peerName="Ada Lovelace" peerUsername="ada" peerPresence={ONLINE} peerTyping={false} paused={false}
    isConnected isRegistered connectionRoute={null} supervisor={null} onSettingsClick={vi.fn()} onOpenFiles={null} />
);

describe('the P2P conversation header', () => {
  it("shows the peer's picture", () => {
    render(inWorkspace(header));
    expect(screen.getByTestId('member-avatar-ada').getAttribute('data-avatar-src')).toBe(PICTURE);
  });

  it('falls back to their initials when they have no picture', () => {
    render(inWorkspace(header, { ...ADA, avatarUrl: undefined }));
    expect(screen.getByTestId('member-avatar-ada').getAttribute('data-avatar-src')).toBe('');
    expect(screen.getByTestId('member-avatar-ada').textContent).toContain('AL');
  });
});

describe('a conversation row', () => {
  it("shows the peer's picture", () => {
    render(inWorkspace(<ConversationPeerItem peer={{ cid: '2', name: 'Ada Lovelace', username: 'ada', isConnected: true, unreadCount: 0 }} isSelected={false} onSelect={vi.fn()} />));
    expect(screen.getByTestId('member-avatar-ada').getAttribute('data-avatar-src')).toBe(PICTURE);
  });
});

describe('a peer bubble that carries an avatar', () => {
  it("shows the sender's picture", () => {
    const message: P2PMessage = { id: 'm1', content: 'hi', senderCid: 2n, recipientCid: 1n, timestamp: 1, index: 0, status: 'delivered', message_type: 'text' };
    render(inWorkspace(<TextBubble message={message} isOwn={false} quoted={null} showSenderAvatar senderName="Ada Lovelace" senderUsername="ada" />));
    expect(screen.getByTestId('member-avatar-ada').getAttribute('data-avatar-src')).toBe(PICTURE);
  });
});
