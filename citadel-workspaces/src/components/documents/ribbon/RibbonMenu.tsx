/**
 * A ribbon button that opens a vertical list of choices (Styles, Margins, Size …): one roving
 * toolbar in a popover, closed when a choice is made, after which the document has focus
 * again. The choices are the caller's.
 */
import { useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { PressedState } from './formatting';
import { RIBBON_CONTROL, RibbonButton } from './RibbonButton';
import { RibbonToolbar } from './RibbonToolbar';
import { useRibbon } from './ribbon-context';

export interface RibbonMenuProps {
  readonly testId: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly text: string;
  readonly widthPx: number;
  /** Why the menu cannot open now, beyond the ribbon's own reason. */
  readonly unavailable?: string | null;
  /** The trigger shows as pressed when one of the choices is the current one (Numbering in a numbered list). */
  readonly pressed?: PressedState;
  /** Called each time the menu opens. */
  readonly onOpen?: () => void;
  /** The choices; `close` shuts the menu, before the chosen command runs. */
  readonly children: (close: () => void) => ReactNode;
}

export function RibbonMenu({ testId, label, icon, text, widthPx, unavailable, pressed, onOpen, children }: RibbonMenuProps): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const { returnFocus } = useRibbon();
  return (
    <Popover open={open} onOpenChange={(next: boolean): void => { setOpen(next); if (next) onOpen?.(); }}>
      <PopoverTrigger asChild>
        <RibbonButton testId={`${testId}-open`} label={label} icon={icon} text={text} unavailable={unavailable} pressed={pressed} />
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={16} className="max-h-[min(480px,70vh)] overflow-y-auto p-2" style={{ width: widthPx }}
        // The document, not the trigger, takes focus back, as after any ribbon command.
        onCloseAutoFocus={(e: Event): void => { e.preventDefault(); returnFocus(); }}>
        <RibbonToolbar label={label} testId={testId} vertical>
          {children((): void => setOpen(false))}
        </RibbonToolbar>
      </PopoverContent>
    </Popover>
  );
}

export interface MenuOptionProps {
  readonly testId: string;
  readonly label: string;
  /** What the choice sets, shown under its name. */
  readonly detail: string;
  /** Whether this is the current choice; omitted while the editor has not reported one. */
  readonly pressed?: PressedState;
  readonly onChoose: () => void;
}

/** One choice in a RibbonMenu: its name and what it sets, refused while the ribbon is. */
export function MenuOption({ testId, label, detail, pressed, onChoose }: MenuOptionProps): JSX.Element {
  const { disabledReason, explain } = useRibbon();
  return (
    <button type="button" data-roving-item="" data-testid={testId} aria-pressed={pressed} aria-disabled={disabledReason !== null}
      onClick={(): void => { if (disabledReason === null) onChoose(); else explain(disabledReason); }}
      // Text, so the current choice keeps the foreground colour (primary on its tint fails contrast in dark) and is ringed instead.
      className={cn(RIBBON_CONTROL, 'h-auto min-h-[44px] w-full flex-col items-start justify-center px-3 py-1 text-left aria-[pressed=true]:text-foreground aria-[pressed=true]:ring-2 aria-[pressed=true]:ring-primary')}>
      <span>{label}</span>
      <span className="text-[12px] text-muted-foreground">{detail}</span>
    </button>
  );
}
