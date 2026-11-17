/**
 * MessageList Component
 *
 * The scrollable transcript of any conversation the chat pane shows: a direct chat, a node
 * channel or a peer group. Who wrote each message comes from the message itself (its `author`,
 * stamped by the transport), never from comparing identities here.
 */

import React, { forwardRef, useMemo } from 'react';
import { groupMessagesByDate, quoteP2PReply } from '@/components/chat/shared';
import { DateSeparator } from '@/components/chat/shared/DateSeparator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { MessageBubble } from '@/components/p2p/bubbles';
import { AwaitingAcceptContext } from '@/components/p2p/bubbles/awaiting-accept';
import { reactionChips } from '@/lib/reactions/reaction-state';
import type { ReactionBinding } from '@/components/chat/shared/reactions/reaction-binding';
import type { ChatDocumentLink } from '@/components/p2p/hooks/useP2PTabs';
import type { ChatMessage } from '@/lib/chat/transport/chat-transport';

interface MessageListProps {
  messages: ChatMessage[];
  /** The empty transcript's sentence, as the transport words it. */
  greeting: string;
  /** Each message shows its sender's name and picture (a channel), not a two-party thread. */
  namesSenders: boolean;
  /** The reader's cid, for which reactions are theirs; null before the session has one. */
  selfCid: bigint | null;
  /** A reactor's name; the reader is "You". */
  reactorName: (cid: bigint) => string;
  isLoadingMore: boolean;
  /** True until the stored history has been read; see useP2PMessages. */
  isLoadingHistory: boolean;
  hasMorePages: boolean;
  /** Reads the next older page; see useP2PMessages. */
  onLoadOlder: () => void;
  /** Why the last older page could not be read, or null. */
  olderPagesError: string | null;
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  onRetryMessage: (message: ChatMessage) => void;
  onOpenDocument: (link: ChatDocumentLink) => void;
  onAcceptTransfer: (transferId: string) => Promise<void>;
  onDeclineTransfer: (transferId: string) => Promise<void>;
  onCancelTransfer: (transferId: string) => Promise<void>;
  onOpenFile: (transferId: string) => void;
  /** Null where the conversation's messages cannot be changed once sent. */
  onEditMessage: ((messageId: string, content: string) => void) | null;
  onDeleteMessage: ((messageId: string) => void) | null;
  onReplyMessage: (messageId: string) => void;
  /** Focus the composer after a bubble's Edit or Reply; see chat/shared/menu-focus-handoff. */
  focusComposer: () => void;
  /** Null where the conversation carries no reactions. */
  onReactMessage: ((messageId: string, emoji: string) => void) | null;
  /** The counterpart's name while they have not accepted; their pending bubbles say they are waiting. */
  awaitingAcceptFrom: string | null;
}

const authorOf = (m: ChatMessage): string => m.author.name;

export const MessageList: React.ForwardRefExoticComponent<MessageListProps & React.RefAttributes<HTMLDivElement>> = forwardRef<HTMLDivElement, MessageListProps>(
  function MessageList(
    {
      messages, greeting, namesSenders, selfCid, reactorName,
      isLoadingMore, isLoadingHistory, hasMorePages, onLoadOlder, olderPagesError,
      onScroll, onRetryMessage, onOpenDocument,
      onAcceptTransfer, onDeclineTransfer, onCancelTransfer, onOpenFile,
      onEditMessage, onDeleteMessage, onReplyMessage, focusComposer, onReactMessage,
      awaitingAcceptFrom,
    }: MessageListProps,
    ref: React.ForwardedRef<HTMLDivElement>
  ) {
    // Memoised: the composer's text is lifted above this list, so EVERY keystroke re-renders it,
    // and without the memo that regrouped the whole conversation on each one.
    const messagesByDate: Record<string, ChatMessage[]> = useMemo(() => groupMessagesByDate(messages), [messages]);

    // What each reply quotes, looked up among the messages already loaded.
    const byId: Map<string, ChatMessage> = useMemo(
      () => new Map(messages.map((m: ChatMessage): [string, ChatMessage] => [m.id, m])),
      [messages],
    );
    const reactionsFor = (m: ChatMessage): ReactionBinding | undefined => (
      onReactMessage === null
        ? undefined
        : { chips: reactionChips(m.reactions, selfCid), nameFor: reactorName, onReact: (emoji: string): void => onReactMessage(m.id, emoji) }
    );

    return (
      <AwaitingAcceptContext.Provider value={awaitingAcceptFrom}>
      <ScrollArea className="flex-1 p-4" ref={ref} onScroll={onScroll}>
        {/*
        role="log" carries an implicit aria-live="polite" and aria-relevant="additions", the pattern
        for a running transcript: a message that arrives while you are elsewhere on the page is
        announced instead of sitting there silently. It pre-exists its content on purpose: a live
        region created together with a full back-scroll is either read whole or dropped.
        */}
        <div className="space-y-4" role="log" aria-label="Conversation">
          {isLoadingMore && (
            <div className="flex justify-center py-2">
              <div className="text-sm text-muted-foreground">Loading older messages...</div>
            </div>
          )}
          {/* A control, not only "scroll up": a newest page too short to overflow the view
              cannot be scrolled, and older pages were then out of reach. */}
          {hasMorePages && !isLoadingMore && (
            <div className="flex flex-col items-center gap-1 py-2">
              <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={onLoadOlder}>
                Load older messages
              </Button>
              {olderPagesError && <p className="text-xs text-destructive" role="alert">{olderPagesError}</p>}
            </div>
          )}
          {messages.length === 0 && !isLoadingMore && !isLoadingHistory && (
            // A blank void reads as a screen that failed to load.
            <div className="flex flex-col items-center justify-center gap-1 py-16 text-center">
              <p className="text-sm text-foreground">No messages yet</p>
              <p className="text-xs text-muted-foreground">{greeting}</p>
            </div>
          )}
          {Object.entries(messagesByDate).map(([date, dayMessages]) => (
            <div key={date}>
              <DateSeparator date={date} />
              {/* The rows carry no margin of their own, and `space-y-4` above spaces the DAYS.
                  Without this gap every message sat flush against the one over it -- most
                  visibly a plain message under a live-document bubble, or under a message
                  with reaction chips (see check-chat-polish-geometry). */}
              <div className="flex flex-col gap-3">
              {dayMessages.map((message: ChatMessage) => (
              <MessageBubble
                key={message.id}
                message={message}
                isOwn={message.author.own}
                quoted={message.replyTo ? quoteP2PReply(message.replyTo, byId, authorOf) : null}
                onRetry={() => onRetryMessage(message)}
                onOpenDocument={onOpenDocument}
                onAcceptTransfer={onAcceptTransfer}
                onDeclineTransfer={onDeclineTransfer}
                onCancelTransfer={onCancelTransfer}
                onOpenFile={onOpenFile}
                showSenderName={namesSenders}
                showSenderAvatar={namesSenders}
                senderName={message.author.name}
                senderUsername={message.author.username ?? undefined}
                onEdit={onEditMessage === null ? undefined : (): void => onEditMessage(message.id, message.content)}
                onDelete={onDeleteMessage === null ? undefined : (): void => onDeleteMessage(message.id)}
                onReply={(): void => onReplyMessage(message.id)}
                focusComposer={focusComposer}
                reactions={reactionsFor(message)}
              />
              ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      </AwaitingAcceptContext.Provider>
    );
  }
);
