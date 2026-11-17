/**
 * One ribbon button: a 44px target (px, not rem: the root is 14px), named for assistive tech,
 * a tooltip with its shortcut, `aria-pressed` when it is a toggle ("mixed" when the caret's
 * formatting is not known). Disabled is `aria-disabled`, not `disabled`, so the button stays
 * in the roving order and its tooltip can say why.
 */
import { forwardRef, useState, type ComponentPropsWithoutRef, type ForwardedRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { isEnterCommit } from '@/lib/keyboard-commit';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { PressedState } from './formatting';
import { useRibbon } from './ribbon-context';
import type { RibbonEnvironment } from './ribbon-environment';

export interface Shortcut {
  readonly key: string;
  readonly shift?: boolean;
}

export function shortcutLabel(shortcut: Shortcut, environment: RibbonEnvironment): string {
  const parts: string[] = [environment.modifier, ...(shortcut.shift === true ? ['Shift'] : []), shortcut.key];
  return environment.modifier === '⌘' ? parts.join('') : parts.join('+');
}

export const RIBBON_CONTROL: string = 'inline-flex h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1 rounded-md px-2 text-[14px] text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-[pressed=true]:bg-primary/15 aria-[pressed=true]:text-primary aria-[pressed=mixed]:border aria-[pressed=mixed]:border-dashed aria-[pressed=mixed]:border-muted-foreground';

/** The tooltip around any ribbon control: what it does and its shortcut, or why it cannot. */
export function RibbonTip({ label, shortcut, reason, suppressed, children }: { label: string; shortcut?: Shortcut; reason: string | null; suppressed?: boolean; children: ReactNode }): JSX.Element {
  const { environment } = useRibbon();
  const [open, setOpen] = useState<boolean>(false);
  const text: string = reason ?? (shortcut === undefined ? label : `${label} (${shortcutLabel(shortcut, environment)})`);
  return (
    // `suppressed`: something more important (a field's error) is showing where the tip would.
    <Tooltip open={open && suppressed !== true} onOpenChange={setOpen}>
      {/* Activating the control closes its tip, so the dialog it opens gets the next Escape. */}
      <TooltipTrigger asChild onKeyDown={(e: KeyboardEvent<HTMLElement>): void => { if (isEnterCommit(e) || e.key === ' ') setOpen(false); }}>{children}</TooltipTrigger>
      {/* Never wider than a phone: a refusal's reason wraps instead of running off the screen. */}
      <TooltipContent side="bottom" collisionPadding={16} className="max-w-[calc(100vw-32px)] whitespace-normal">{text}</TooltipContent>
    </Tooltip>
  );
}

export interface RibbonButtonProps extends Omit<ComponentPropsWithoutRef<'button'>, 'type' | 'disabled'> {
  readonly testId: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly shortcut?: Shortcut;
  readonly pressed?: PressedState;
  /** Why this one cannot run, beyond the ribbon's own reason. */
  readonly unavailable?: string | null;
  /** Shown beside the icon; the icon alone otherwise. */
  readonly text?: string;
  /** What a press does; a trigger (popover, dialog) leaves it out and its `onClick` opens it. */
  readonly onPress?: () => void;
  /** It only reads the document (Copy), so it stays usable where editing is not allowed. */
  readonly reads?: boolean;
}

function RibbonButtonImpl(
  { testId, label, icon: Icon, shortcut, pressed, unavailable, text, onPress, reads, onClick, className, ...rest }: RibbonButtonProps,
  ref: ForwardedRef<HTMLButtonElement>,
): JSX.Element {
  const { disabledReason, readReason, explain } = useRibbon();
  const reason: string | null = (reads === true ? readReason : disabledReason) ?? unavailable ?? null;
  return (
    <RibbonTip label={label} shortcut={shortcut} reason={reason}>
      <button
        {...rest}
        ref={ref}
        type="button"
        data-roving-item=""
        data-testid={testId}
        aria-label={label}
        aria-pressed={pressed}
        aria-disabled={reason !== null}
        className={cn(RIBBON_CONTROL, className)}
        onClick={(event: MouseEvent<HTMLButtonElement>): void => {
          if (reason !== null) {
            event.preventDefault();
            return explain(reason);
          }
          onPress?.();
          onClick?.(event);
        }}
      >
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
        {text !== undefined && <span className="whitespace-nowrap">{text}</span>}
      </button>
    </RibbonTip>
  );
}

export const RibbonButton: ReturnType<typeof forwardRef<HTMLButtonElement, RibbonButtonProps>> = forwardRef<HTMLButtonElement, RibbonButtonProps>(RibbonButtonImpl);
RibbonButton.displayName = 'RibbonButton';
