import ReactMarkdown, { type Components } from 'react-markdown';
import { memo , type ReactNode , type NamedExoticComponent } from 'react';
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
import { documentAnchor } from '@/components/shared/DocumentLink';
import { useMenuFocusHandoff, type MenuFocusHandoff } from '@/components/chat/shared/menu-focus-handoff';

/**
 * The markdown parse, memoized on the text alone.
 *
 * The composer's value lives in the chat root, so every keystroke re-renders
 * the whole loaded history — and each markdown bubble ran a full remark parse
 * again, for text that had not changed. The cost grows with how far back the
 * user has scrolled, which is exactly the class that looks fine on a fresh
 * account and janks after a month.
 *
 * `content` is a string, so this memo holds even while the surrounding bubble
 * re-renders with fresh inline callbacks — no change to the bubble's API.
 */
const RenderedMarkdown: NamedExoticComponent<{ content: string; }> = memo(function RenderedMarkdown({ content }: { content: string }): JSX.Element {
  return <ReactMarkdown components={markdownComponents}>{content}</ReactMarkdown>;
});

type ChildrenProps = { children?: ReactNode };

// Custom components for markdown rendering in chat bubbles
const markdownComponents: Components = {
  // Headers - smaller for chat context
  h1: ({ children }: ChildrenProps): JSX.Element => <h1 className="text-lg font-bold mb-2">{children}</h1>,
  h2: ({ children }: ChildrenProps): JSX.Element => <h2 className="text-base font-semibold mb-1.5">{children}</h2>,
  h3: ({ children }: ChildrenProps): JSX.Element => <h3 className="text-sm font-semibold mb-1">{children}</h3>,

  // Paragraphs
  p: ({ children }: ChildrenProps): JSX.Element => <p className="text-sm mb-2 last:mb-0">{children}</p>,

  // Lists
  ul: ({ children }: ChildrenProps): JSX.Element => <ul className="list-disc list-inside text-sm mb-2 pl-2">{children}</ul>,
  ol: ({ children }: ChildrenProps): JSX.Element => <ol className="list-decimal list-inside text-sm mb-2 pl-2">{children}</ol>,
  li: ({ children }: ChildrenProps): JSX.Element => <li className="mb-0.5">{children}</li>,

  // Links. This used to force target="_blank" on everything, which meant a peer
  // linking you to a page in your own workspace opened a SECOND copy of the app
  // in a new tab — a fresh WASM client and a fresh agent connection — rather
  // than moving you there. DocumentLink sends internal links to the router and
  // keeps the new tab (and its noopener) for links that really do leave.
  a: documentAnchor,

  // Code. Every `code` is styled as a span, and the <pre> of a fenced block
  // undoes that for the code inside it. This branched on an `inline` prop,
  // which react-markdown 9 no longer passes -- so every inline span took the
  // block branch and sat on a line of its own.
  code: ({ children }: ChildrenProps): JSX.Element => (
    <code className="bg-black/30 px-1 py-0.5 rounded text-xs font-mono">{children}</code>
  ),
  pre: ({ children }: ChildrenProps): JSX.Element => (
    <pre className="bg-black/30 p-2 rounded text-xs font-mono overflow-x-auto whitespace-pre-wrap mb-2 [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </pre>
  ),

  // Block quotes
  blockquote: ({ children }: ChildrenProps): JSX.Element => (
    <blockquote className="border-l-2 border-primary-accent/50 pl-2 italic text-sm opacity-90 mb-2">
      {children}
    </blockquote>
  ),

  // Horizontal rule
  hr: (): JSX.Element => <hr className="border-t border-border my-2" />,

  // Bold and italic (handled automatically by markdown)
  strong: ({ children }: ChildrenProps): JSX.Element => <strong className="font-bold">{children}</strong>,
  em: ({ children }: ChildrenProps): JSX.Element => <em className="italic">{children}</em>,

  // Strikethrough
  del: ({ children }: ChildrenProps): JSX.Element => <del className="line-through opacity-70">{children}</del>,
};

export function MarkdownBubble({
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
}: ReplyableBubbleProps): JSX.Element {
  const handoff: MenuFocusHandoff = useMenuFocusHandoff(focusComposer);
  const isFailed: boolean = message.status === 'failed';
  const bubbleStyles: string = getBubbleStyles(isOwn, isFailed);
  const displayName: string = senderName || 'Unknown';
  const hasActions: boolean = Boolean(onEdit || onDelete || onReply || reactions);

  // Show avatar only for non-own messages in group mode
  const shouldShowAvatar: boolean | undefined = showSenderAvatar && !isOwn;

  // min-w-0 down the chain — the fix TextBubble documents in detail and does
  // not itself need, because TextBubble renders plain text. THIS is the bubble
  // that renders <pre>, and an unbreakable code line widened the whole row past
  // the message list, with the pre's own overflow-x-auto inert because nothing
  // constrained its width.
  return (
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
          {/* Own bubbles invert UNCONDITIONALLY, because they are dark in both
              themes: `bg-primary text-primary-foreground`, and --primary is a
              dark purple in light mode too. `dark:prose-invert` alone meant that
              in light mode the typography plugin painted its own
              `color: hsl(var(--foreground))` — near-black — onto that dark
              purple, and links got `hsl(var(--primary))`, i.e. the bubble's own
              colour. Your own markdown messages were barely legible and their
              links were invisible, on the light theme only. Peer bubbles sit on
              `bg-surface` and correctly follow the theme.
              The typography plugin also paints a literal backtick either side
              of every `code`; in a chat bubble that is the markup showing, so
              it is switched off for both. */}
          <div
            className={`prose prose-sm max-w-none prose-code:before:content-none prose-code:after:content-none ${isOwn ? 'prose-invert own-bubble-prose' : 'dark:prose-invert'}`}
          >
            <RenderedMarkdown content={message.content} />
          </div>
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
