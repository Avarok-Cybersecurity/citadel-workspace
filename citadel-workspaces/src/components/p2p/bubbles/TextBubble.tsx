import type { ReactNode } from 'react';
import { AlertCircle, MoreVertical, Edit2, Trash2 } from 'lucide-react';
import { MemberAvatar } from '@/components/shared/MemberAvatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { getBubbleStyles, BUBBLE_MAX_WIDTH , type ReplyableBubbleProps } from './types';
import { ReplyQuote } from '@/components/chat/shared/ReplyQuote';
import { ReplyMenuItem } from '@/components/chat/shared/ReplyMenuItem';
import { BubbleFooter } from './BubbleFooter';
import { ReactionChips } from '@/components/chat/shared/reactions/ReactionChips';
import { ReactionMenuItems } from '@/components/chat/shared/reactions/ReactionMenuItems';
import { useMenuFocusHandoff, type MenuFocusHandoff } from '@/components/chat/shared/menu-focus-handoff';

export function TextBubble({
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
  quoted,
  reactions,
  children,
}: ReplyableBubbleProps & { children?: ReactNode }): JSX.Element {
  const handoff: MenuFocusHandoff = useMenuFocusHandoff(focusComposer);
  const isFailed: boolean = message.status === 'failed';
  const bubbleStyles: string = getBubbleStyles(isOwn, isFailed);
  const displayName: string = senderName || 'Unknown';
  const hasActions: boolean = Boolean(onEdit || onDelete || onReply || reactions);

  // Show avatar only for non-own messages in group mode
  const shouldShowAvatar: boolean | undefined = showSenderAvatar && !isOwn;

  return (
    // min-w-0 here and on the column below, or max-w-[80%] does not hold. A flex
    // item defaults to min-width:auto, and per spec min-width beats max-width —
    // so one unbreakable child (a <pre> of code, which does not wrap) widens the
    // whole row past the message list. Measured before the fix: a single long
    // code line produced a 762px bubble inside a 600px list, with the pre's
    // overflow-x-auto inert because nothing constrained its width.
    <div className={`group flex min-w-0 gap-2 ${BUBBLE_MAX_WIDTH} ${isOwn ? 'flex-row-reverse' : ''}`}>
      {/* Avatar for non-own messages */}
      {shouldShowAvatar && (
        <MemberAvatar username={senderUsername ?? displayName} name={displayName} className="h-8 w-8" />
      )}

      <div className={`flex min-w-0 flex-col ${isOwn ? 'items-end' : ''}`}>
        {/* Sender name (group mode) */}
        {showSenderName && !isOwn && (
          <span className="text-xs text-muted-foreground mb-1 px-1">
            {displayName}
          </span>
        )}

        <div className={`min-w-0 rounded-lg px-3 py-2 ${bubbleStyles}`}>
          {message.replyTo && <ReplyQuote quoted={quoted} isOwn={isOwn} />}
          {/* break-words, like the group bubble beside it. `pre-wrap` only
              wraps at EXISTING opportunities, and a pasted URL or path has
              none — so it painted outside the bubble and was cut at the panel
              edge, unreadable and unselectable. The most common long string a
              chat user produces. */}
          {/* What the message carries instead of text (a shared file's card) replaces the text. */}
          {children ?? <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>}
          {/* Inline failure indicator */}
          {isOwn && isFailed && (
            <div className="flex items-center gap-1 mt-1.5 text-xs text-destructive-emphasis">
              <AlertCircle className="h-3 w-3" />
              <span>Failed to send</span>
            </div>
          )}
          <BubbleFooter message={message} isOwn={isOwn} onRetry={onRetry} />
        </div>
        {reactions && <ReactionChips binding={reactions} isOwn={isOwn} />}
      </div>

      {/* Message Actions Dropdown */}
      {hasActions && (
        <div className="reveal-on-hover flex-shrink-0 self-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="tap-target h-6 w-6" aria-label="Message actions">
                <MoreVertical className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={isOwn ? 'start' : 'end'} onCloseAutoFocus={handoff.onCloseAutoFocus}>
              {onReply && <ReplyMenuItem onSelect={handoff.toComposer(onReply)} />}
              {isOwn && onEdit && (
                <DropdownMenuItem onClick={handoff.toComposer(onEdit)}>
                  <Edit2 className="h-4 w-4 mr-2" />
                  Edit
                </DropdownMenuItem>
              )}
              {isOwn && onDelete && (
                <DropdownMenuItem
                  onClick={onDelete}
                  className="text-destructive-emphasis focus:text-destructive-emphasis"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              )}
              {reactions && <ReactionMenuItems onReact={reactions.onReact} />}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
