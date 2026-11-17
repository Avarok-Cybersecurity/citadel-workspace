/**
 * The "?" beside a field, and the sentence it holds.
 *
 * It was a bare icon inside a hover tooltip, drawn ON TOP of the field's own control: a touch user
 * could not open it, a keyboard user could not focus it, and a click aimed at the select it covered
 * landed on the icon. It is a button now, placed beside the label, that opens a popover on a press,
 * a tap or Enter.
 */
import type { ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface HelpHintProps {
  /** What the help is about, e.g. "Security mode"; the button's name. */
  topic: string;
  children: ReactNode;
}

export function HelpHint({ topic, children }: HelpHintProps): JSX.Element {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`About ${topic}`}
          className="tap-target inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <HelpCircle className="h-4 w-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" collisionPadding={8} className="w-auto max-w-[min(20rem,calc(100vw-2rem))] bg-card border-primary-accent/30 p-3 text-sm text-foreground">
        {children}
      </PopoverContent>
    </Popover>
  );
}
