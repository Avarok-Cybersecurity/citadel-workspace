import { TextBubble } from './TextBubble';
import { MarkdownBubble } from './MarkdownBubble';
import { LiveDocumentBubble } from './LiveDocumentBubble';
import { FileTransferBubble } from './FileTransferBubble';
import { SystemNoticeLine } from './SystemNoticeLine';
import { getBubbleContainerStyles } from './types';
import { MESSAGE_ANCHOR_ATTRIBUTE, JUMP_TARGET_CLASSES } from '@/components/chat/shared/jump-to-message';
import type { QuotedMessage } from '@/components/chat/shared/reply-quote';
import type { ChatMessage, PaneMessage } from '@/lib/chat/transport/chat-transport';
import { ServerFileCard } from '@/components/chat/attachments/ServerFileCard';
import { GroupFileShareCard } from '@/components/chat/GroupFileShareCard';
import type { ReactionBinding } from '@/components/chat/shared/reactions/reaction-binding';
import type { ChatDocumentLink } from '../hooks/useP2PTabs';

interface MessageBubbleProps {
  /** A pane message; one that is a peer group's shared file carries its `share`. */
  message: PaneMessage | ChatMessage;
  isOwn: boolean;
  /** What a reply quotes; `null` when this is not a reply or the original is not loaded. */
  quoted: QuotedMessage | null;
  onRetry?: () => void;
  onOpenDocument?: (link: ChatDocumentLink) => void;
  onAcceptTransfer?: (transferId: string) => void;
  onDeclineTransfer?: (transferId: string) => void;
  onCancelTransfer?: (transferId: string) => void;
  onOpenFile?: (transferId: string) => void;

  // Group mode display options
  showSenderName?: boolean;
  showSenderAvatar?: boolean;
  senderName?: string;
  senderUsername?: string;

  // Message actions (group mode)
  onEdit?: () => void;
  onDelete?: () => void;
  onReply?: () => void;
  focusComposer?: () => void;
  reactions?: ReactionBinding;
}

export function MessageBubble({
  message,
  isOwn,
  quoted,
  onRetry,
  onOpenDocument,
  onAcceptTransfer,
  onDeclineTransfer,
  onCancelTransfer,
  onOpenFile,
  showSenderName,
  showSenderAvatar,
  senderName,
  senderUsername,
  onEdit,
  onDelete,
  onReply,
  focusComposer,
  reactions,
}: MessageBubbleProps): JSX.Element {
  const containerStyles: string = getBubbleContainerStyles(isOwn);

  // Common props for all bubble types
  const commonProps: { message: PaneMessage; isOwn: boolean; onRetry: (() => void) | undefined; showSenderName: boolean | undefined; showSenderAvatar: boolean | undefined; senderName: string | undefined; senderUsername: string | undefined; onEdit: (() => void) | undefined; onDelete: (() => void) | undefined; onReply: (() => void) | undefined; focusComposer: (() => void) | undefined; reactions: ReactionBinding | undefined; } = {
    message,
    isOwn,
    onRetry,
    showSenderName,
    showSenderAvatar,
    senderName,
    senderUsername,
    onEdit,
    onDelete,
    onReply,
    focusComposer,
    reactions,
  };

  const renderBubble: () => JSX.Element = (): JSX.Element => {
    if ('attachment' in message && message.attachment !== undefined) {
      return (
        <TextBubble {...commonProps} quoted={quoted}>
          <ServerFileCard file={message.attachment} />
        </TextBubble>
      );
    }
    if ('share' in message && message.share !== null) {
      return (
        <TextBubble {...commonProps} quoted={quoted}>
          <GroupFileShareCard share={message.share} senderName={message.author.name} />
        </TextBubble>
      );
    }
    switch (message.message_type) {
      case 'system_notice':
        return <SystemNoticeLine message={message} />;

      case 'markdown':
        return <MarkdownBubble {...commonProps} quoted={quoted} />;

      case 'live_document':
        return (
          <LiveDocumentBubble
            {...commonProps}
            onOpenDocument={onOpenDocument}
          />
        );

      case 'file_transfer':
        return (
          <FileTransferBubble
            {...commonProps}
            onAccept={onAcceptTransfer}
            onDecline={onDeclineTransfer}
            onCancel={onCancelTransfer}
            onOpen={onOpenFile}
          />
        );

      case 'text':
      default:
        return <TextBubble {...commonProps} quoted={quoted} />;
    }
  };

  return (
    <div className={`${containerStyles} ${JUMP_TARGET_CLASSES}`} {...{ [MESSAGE_ANCHOR_ATTRIBUTE]: message.id }}>
      {renderBubble()}
    </div>
  );
}

// Export all bubble components for direct use if needed
export { TextBubble } from './TextBubble';
export { MarkdownBubble } from './MarkdownBubble';
export { LiveDocumentBubble } from './LiveDocumentBubble';
export { FileTransferBubble } from './FileTransferBubble';
export { BubbleFooter } from './BubbleFooter';
export * from './types';
