import { Reply } from 'lucide-react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';

/**
 * The one "Reply" a message's action menu offers.
 *
 * Three menus (P2P text, P2P markdown, group) each declared their own icon + label, so "how
 * many Replies does a message have, and what are they called" had three answers to keep in step.
 * `a-message-offers-reply-once` pins the count at one per menu.
 */
export function ReplyMenuItem({ onSelect }: { onSelect: () => void }): JSX.Element {
  return (
    <DropdownMenuItem onClick={onSelect}>
      <Reply className="h-4 w-4 mr-2" aria-hidden="true" />
      Reply
    </DropdownMenuItem>
  );
}
