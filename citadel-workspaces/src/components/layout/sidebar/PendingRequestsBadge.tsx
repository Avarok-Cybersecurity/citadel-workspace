/**
 * The count of connection requests waiting for an answer.
 *
 * A real button, not a clickable Badge: Badge renders a div, so this was
 * invisible to the keyboard and announced as nothing — and it is one of only
 * two ways to open the pending-requests modal (the other is a click-only
 * notification card), which made that whole surface unreachable without a
 * mouse.
 *
 * The destructive variant, not a raw red: `bg-red-500` with `text-foreground`
 * is about 3.9:1 in dark mode — below AA at this size — and a raw hex is
 * invisible to the workspace theme.
 */

import { Badge } from '@/components/ui/badge';

interface PendingRequestsBadgeProps {
  count: number;
  onOpen: () => void;
}

export function PendingRequestsBadge({ count, onOpen }: PendingRequestsBadgeProps): JSX.Element | null {
  if (count === 0) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      aria-label={`Review ${count} pending connection request${count > 1 ? 's' : ''}`}
      // shrink-0, with MembersSection's label truncating instead: "OFFICE MEMBERS" alone filled the
      // header row, so this badge slid under the "Find people" button and could not be clicked
      // (CI test:chat-settings on PR #60).
      className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Badge
        variant="destructive"
        data-testid="pending-requests-badge"
        className="h-5 min-w-[20px] px-1.5 transition-colors"
      >
        {count}
      </Badge>
    </button>
  );
}
