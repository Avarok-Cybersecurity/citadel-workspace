/**
 * The message list's props for a direct chat between the reader (cid 1, "me") and alice (cid 2),
 * and messages stamped with their author by the production adapter's own function, so a list test
 * sees exactly what the pane would hand it.
 */
import { vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { MessageList } from '../../MessageList';
import { authored } from '@/lib/chat/transport/peer-history';
import type { ChatMessage, ChatSelf } from '@/lib/chat/transport/chat-transport';
import type { ChatPeer } from '@/lib/cdoc/chat/chat-app-ports';
import type { P2PMessage } from '@/lib/p2p/p2p-types';

export const SELF: ChatSelf = { cid: 1n, username: 'me', displayName: 'me' };
export const ALICE: ChatPeer = { cid: 2n, name: 'alice', username: 'alice' };

export type ListProps = Omit<ComponentProps<typeof MessageList>, 'ref'>;

export function listProps(messages: ChatMessage[]): ListProps {
  return {
    messages,
    greeting: 'Say hello to alice. Messages are end-to-end encrypted.',
    namesSenders: false,
    selfCid: SELF.cid,
    reactorName: (cid: bigint): string => (cid === SELF.cid ? 'You' : ALICE.name),
    isLoadingMore: false,
    isLoadingHistory: false,
    hasMorePages: false,
    onLoadOlder: (): void => {},
    olderPagesError: null,
    onScroll: vi.fn(),
    onRetryMessage: vi.fn(),
    onOpenDocument: vi.fn(),
    onAcceptTransfer: vi.fn(),
    onDeclineTransfer: vi.fn(),
    onCancelTransfer: vi.fn(),
    onOpenFile: vi.fn(),
    onEditMessage: vi.fn(),
    onDeleteMessage: vi.fn(),
    onReplyMessage: vi.fn(),
    focusComposer: vi.fn(),
    onReactMessage: null,
    awaitingAcceptFrom: null,
  };
}

/** A direct-chat message as the peer adapter delivers it. */
export function between(message: P2PMessage): ChatMessage {
  return authored(message, SELF, ALICE);
}
