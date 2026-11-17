import { cn } from '@/lib/utils';
import { jumpToMessage } from './jump-to-message';
import type { QuotedMessage } from './reply-quote';

interface ReplyQuoteProps {
  /** `null` when the original is not among the loaded messages. */
  quoted: QuotedMessage | null;
  /**
   * Own bubbles are `bg-primary` in both themes, so muted grey text there is
   * unreadable; they take the bubble's own foreground instead.
   */
  isOwn: boolean;
}

/**
 * The compact quote above a reply: who wrote the original and its first line.
 * A button when the original is loaded (it jumps there), plain text when not.
 */
export function ReplyQuote({ quoted, isOwn }: ReplyQuoteProps): JSX.Element {
  const frame: string = cn(
    'mb-1.5 block w-full min-w-0 rounded-sm border-l-2 py-0.5 pl-2 pr-1 text-left text-xs',
    isOwn ? 'border-primary-foreground/70 text-primary-foreground' : 'border-primary-accent text-foreground',
  );
  const secondary: string = isOwn ? 'text-primary-foreground' : 'text-muted-foreground';

  if (quoted === null) {
    return (
      <div className={frame} data-testid="reply-quote-missing">
        <span className={cn('italic', secondary)}>Original message not loaded</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      className={cn(
        frame,
        'hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
      data-testid="reply-quote"
      onClick={(): void => { jumpToMessage(quoted.id, document); }}
    >
      <span className="sr-only">Replying to </span>
      <span className="line-clamp-1 font-semibold [overflow-wrap:anywhere]">{quoted.authorName}</span>
      <span className={cn('line-clamp-1 [overflow-wrap:anywhere]', secondary)}>{quoted.excerpt || '(no text)'}</span>
    </button>
  );
}
