/**
 * Under your own name in a members list: what pressing it opens. Visible rather than a hover
 * card, so it says the same on a phone; your row alone carries it.
 */
import { NotebookPen } from 'lucide-react';

export function OwnScratchpadHint(): JSX.Element {
  return (
    <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground" data-testid="own-scratchpad-hint">
      <NotebookPen className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">Your scratchpad</span>
    </span>
  );
}
