/**
 * Reaction chips under a bubble: the emoji and its count, the viewer's own
 * highlighted (and `aria-pressed`), each one a toggle.
 *
 * Who reacted is in the tooltip AND in the chip's accessible name. A tooltip
 * alone opens on hover or focus, which a touch screen and a screen reader do
 * not reliably give it.
 */
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ReactionChip } from '@/lib/reactions/reaction-state';
import { reactorsLabel, type ReactionBinding } from './reaction-binding';

interface ReactionChipsProps {
  binding: ReactionBinding;
  isOwn: boolean;
}

export function ReactionChips({ binding, isOwn }: ReactionChipsProps): JSX.Element | null {
  if (binding.chips.length === 0) return null;
  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn('mt-1 flex flex-wrap gap-1', isOwn && 'justify-end')} data-testid="reaction-chips">
        {binding.chips.map((chip: ReactionChip): JSX.Element => {
          const label: string = reactorsLabel(chip, binding.nameFor);
          return (
            <Tooltip key={chip.emoji}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(): void => binding.onReact(chip.emoji)}
                  aria-pressed={chip.mine}
                  aria-label={label}
                  data-testid="reaction-chip"
                  className={cn(
                    'tap-target inline-flex items-center gap-1 rounded-full border px-2 text-xs transition-colors',
                    chip.mine
                      ? 'border-primary bg-primary/20 text-foreground'
                      : 'border-border bg-surface text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span aria-hidden="true">{chip.emoji}</span>
                  <span className="tabular-nums" aria-hidden="true">{chip.count}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
