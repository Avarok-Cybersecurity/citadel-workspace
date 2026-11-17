/**
 * A ribbon tab's toolbar and its groups. At desktop widths a group is its controls in a row;
 * at phone width (`compact`) each group collapses to one button whose popover holds the same
 * controls in a toolbar of their own, so the ribbon never scrolls the page sideways.
 */
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { RibbonButton } from './RibbonButton';
import { useRibbon } from './ribbon-context';
import { useRovingFocus, type RovingFocus } from './use-roving-focus';

export function RibbonToolbar({ label, testId, vertical, className, children }: { label: string; testId: string; vertical?: boolean; className?: string; children: ReactNode }): JSX.Element {
  const roving: RovingFocus = useRovingFocus();
  return (
    <div
      ref={roving.ref}
      role="toolbar"
      aria-label={label}
      aria-orientation={vertical === true ? 'vertical' : 'horizontal'}
      data-testid={testId}
      onKeyDown={roving.onKeyDown}
      onFocus={roving.onFocus}
      className={cn('flex min-w-0 gap-1', vertical === true ? 'flex-col items-stretch' : 'flex-wrap items-center', className)}
    >
      {children}
    </div>
  );
}

export interface RibbonGroupProps {
  readonly label: string;
  readonly testId: string;
  /** The collapsed group's button icon. */
  readonly icon: LucideIcon;
  /** Whether the group folds into one button at phone width; a group of one or two controls does not. */
  readonly collapses: boolean;
  readonly children: ReactNode;
}

export function RibbonGroup({ label, testId, icon, collapses, children }: RibbonGroupProps): JSX.Element {
  const { compact } = useRibbon();
  const [open, setOpen] = useState<boolean>(false);
  if (!compact || !collapses) {
    return (
      <div role="group" aria-label={label} data-testid={testId} className="flex items-center gap-0.5 border-r border-border pr-1 last:border-r-0">
        {children}
      </div>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <RibbonButton testId={`${testId}-open`} label={label} icon={icon} text={label} />
      </PopoverTrigger>
      {/* Focus lands on the popover, not its first control, so that control's tooltip does not open over its neighbours. */}
      <PopoverContent align="start" collisionPadding={16} className="w-auto max-w-[calc(100vw-32px)] p-2" tabIndex={-1}
        onOpenAutoFocus={(e: Event): void => { e.preventDefault(); (e.currentTarget as HTMLElement | null)?.focus(); }}
        // Its toolbar is one Tab stop, so Tab would only cycle there: Tab leaves, back to the group's button.
        onKeyDown={(e: KeyboardEvent<HTMLDivElement>): void => { if (e.key === 'Tab') { e.preventDefault(); setOpen(false); } }}>
        <RibbonToolbar label={label} testId={testId}>
          {children}
        </RibbonToolbar>
      </PopoverContent>
    </Popover>
  );
}
