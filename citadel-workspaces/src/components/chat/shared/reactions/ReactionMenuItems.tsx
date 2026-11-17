/**
 * The reaction picker, as items in a message's action menu.
 *
 * In the menu rather than in a hover bar of its own: the menu's trigger already
 * uses `reveal-on-hover`, which is always visible where there is no hover and
 * appears on keyboard focus, so the picker is reachable on touch and from the
 * keyboard without a second reveal to get wrong.
 */
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { REACTION_EMOJIS } from '@/lib/reactions/reaction-state';

interface ReactionMenuItemsProps {
  onReact: (emoji: string) => void;
}

export function ReactionMenuItems({ onReact }: ReactionMenuItemsProps): JSX.Element {
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-xs text-muted-foreground">React</DropdownMenuLabel>
      <div role="group" aria-label="React" className="flex flex-wrap gap-0.5 px-1 pb-1">
        {REACTION_EMOJIS.map((emoji: string): JSX.Element => (
          <DropdownMenuItem
            key={emoji}
            onSelect={(): void => onReact(emoji)}
            aria-label={`React with ${emoji}`}
            data-testid="reaction-pick"
            className="tap-target justify-center px-1.5 text-base"
          >
            {emoji}
          </DropdownMenuItem>
        ))}
      </div>
    </>
  );
}
