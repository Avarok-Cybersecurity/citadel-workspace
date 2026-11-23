/**
 * What sits above the scratchpad, where a direct chat has its peer's header: a notebook, not a
 * person; whose it is and who can see it; where it is kept. No presence, typing, connection,
 * call or share control, because nobody is at the other end (lib/scratchpad).
 */
import { Lock, NotebookPen } from 'lucide-react';
import { SCRATCHPAD_LINE, SCRATCHPAD_STORED, SCRATCHPAD_TITLE } from '@/lib/scratchpad/self-conversation';

export function ScratchpadHeader(): JSX.Element {
  return (
    <div className="border-b border-surface/50 bg-background p-4" data-testid="scratchpad-header">
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary-accent">
          <NotebookPen className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-foreground" data-testid="scratchpad-title">{SCRATCHPAD_TITLE}</h3>
          <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]" data-testid="scratchpad-line">{SCRATCHPAD_LINE}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground" data-testid="scratchpad-stored">
            <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
            {SCRATCHPAD_STORED}
          </p>
        </div>
      </div>
    </div>
  );
}
