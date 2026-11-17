import { X, Reply, Pencil, type LucideIcon } from 'lucide-react';
import type { PaneMessage } from '@/lib/chat/transport/chat-transport';

interface ComposeContextBannerProps {
  replyingTo: PaneMessage | null;
  editingMessage: PaneMessage | null;
  onCancel: () => void;
}

/**
 * Shows what the composer is about to do when it is not simply sending a new
 * message. Without it, replying and editing look identical to typing normally —
 * the user has no way to tell an edit will overwrite rather than send, and no
 * way to back out.
 */
export function ComposeContextBanner({ replyingTo, editingMessage, onCancel }: ComposeContextBannerProps): JSX.Element | null {
  const active: PaneMessage | null = editingMessage ?? replyingTo;
  if (!active) return null;

  const isEditing: boolean = editingMessage !== null;
  const Icon: LucideIcon = isEditing ? Pencil : Reply;

  return (
    <div
      className="flex items-center gap-2 px-4 py-2 border-t border-surface bg-card/60"
      data-testid={isEditing ? 'compose-editing-banner' : 'compose-replying-banner'}
    >
      <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground">
          {isEditing ? 'Editing message' : 'Replying to message'}
        </p>
        {/* Truncated so a long message cannot push the cancel control off a
            narrow viewport. */}
        <p className="truncate text-xs text-muted-foreground">{active.content}</p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        aria-label={isEditing ? 'Cancel editing' : 'Cancel reply'}
        data-testid="compose-context-cancel"
        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
