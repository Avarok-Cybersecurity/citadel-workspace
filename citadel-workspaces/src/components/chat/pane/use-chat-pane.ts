/**
 * Everything the chat pane holds, over one transport: the tabs and their documents, the
 * transcript, the composer, scroll-following and read-on-catch-up, and how files leave.
 *
 * These are the direct chat's hooks, unchanged in what they do; only their wiring moved here
 * from P2PChat, so a node channel and a peer group run the same code.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MutableRefObject, type RefObject } from 'react';
import { useP2PMessages, useP2PTabs } from '@/components/p2p/hooks';
import { useP2PCompose } from '@/components/p2p/hooks/useP2PCompose';
import { useCatchUpRead } from '@/components/p2p/hooks/use-catch-up-read';
import { useChatFileSend, type ChatFileSend } from '@/components/p2p/hooks/use-chat-file-send';
import { useStickToBottom, type StickToBottom } from '@/components/chat/use-stick-to-bottom';
import type { P2PTabs } from '@/components/p2p/hooks/useP2PTabs';
import type { UseP2PMessagesReturn } from '@/components/p2p/hooks/useP2PMessages-types';
import type { PauseView } from '@/components/p2p/hooks/use-peer-pause';
import type { GroupRestriction } from '@/components/chat/group-restriction';
import type { ChatMessage, ChatTransport } from '@/lib/chat/transport/chat-transport';

export interface ChatPaneModel {
  scrollRef: RefObject<HTMLDivElement>;
  tabs: P2PTabs;
  messages: UseP2PMessagesReturn;
  compose: ReturnType<typeof useP2PCompose>;
  stick: StickToBottom;
  fileSend: ChatFileSend;
  paused: boolean;
  sendGate: GroupRestriction;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
}

const isOwn = (m: ChatMessage): boolean => m.author.own;

export function useChatPane(transport: ChatTransport, pause: PauseView | null): ChatPaneModel {
  const scrollRef: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const pinnedRef: MutableRefObject<boolean> = useRef<boolean>(true); // the reader is at the bottom
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);

  const tabs: P2PTabs = useP2PTabs({ documents: transport.documents, currentUserCid: transport.self?.cid });
  const { setMessagesHasUnread, activeTabIdRef } = tabs;
  const messages: UseP2PMessagesReturn = useP2PMessages({
    transport, activeTabIdRef, scrollRef, pinnedRef,
    onUnreadMessage: useCallback((): void => setMessagesHasUnread(true), [setMessagesHasUnread]),
  });
  const compose: ReturnType<typeof useP2PCompose> = useP2PCompose({
    transport, messages: messages.messages, editMessage: messages.handleEditMessage, createDocument: tabs.handleCreateDocument,
  });

  const onCaughtUp: () => void = useCatchUpRead(transport.history, activeTabIdRef, pinnedRef);
  const stick: StickToBottom = useStickToBottom(scrollRef, messages.messages, `Messages with ${transport.counterpart.name}`, isOwn, { pinnedRef, onCaughtUp });

  // Paused: the link is down on purpose. Messages still send and queue; files need the live link.
  const paused: boolean = pause === 'paused';
  const fileSend: ChatFileSend = useChatFileSend({
    files: transport.files, recipient: transport.counterpart.name, viewingDocument: tabs.activeTab?.type === 'live_document', paused,
  });

  // Notifications for this conversation are read while its messages are in front.
  const { history } = transport;
  useEffect((): void => { if (tabs.activeTabId === 'messages') history.clearNotices(); }, [history, tabs.activeTabId]);

  const sendGate: GroupRestriction = useSyncExternalStore(transport.sendGate.subscribe, transport.sendGate.get);

  return { scrollRef, tabs, messages, compose, stick, fileSend, paused, sendGate, settingsOpen, setSettingsOpen };
}
