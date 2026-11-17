/**
 * DisabledWithTooltip Component
 *
 * A wrapper that displays children in a disabled state with a tooltip
 * explaining why the element is disabled. Used for permission-gated UI elements.
 */

import React from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Lock } from 'lucide-react';

interface DisabledWithTooltipProps {
  /** Whether the element should be disabled */
  disabled: boolean;
  /** Tooltip message explaining why disabled */
  tooltip: string;
  /** Content to render */
  children: React.ReactNode;
  /** Additional class names for the wrapper */
  className?: string;
  /** Show lock icon in tooltip (default: true) */
  showIcon?: boolean;
  /** Side for tooltip (default: top) */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Delay before showing tooltip in ms (default: 300) */
  delayDuration?: number;
}

/**
 * Wraps children with a disabled state and explanatory tooltip
 *
 * @example
 * ```tsx
 * <DisabledWithTooltip
 *   disabled={!canEdit}
 *   tooltip="You don't have permission to edit this content"
 * >
 *   <Button>Edit</Button>
 * </DisabledWithTooltip>
 * ```
 */
/**
 * Mark the wrapped control as genuinely disabled, not merely styled as such.
 *
 * Both wrappers below grey the region out and set `pointer-events: none`. CSS
 * does not stop the KEYBOARD, so the button inside stayed focusable and Enter
 * still fired its onClick — a permission-gated action was fully operable by
 * anyone not using a mouse. It also reported `isEnabled()` as true, which is how
 * this surfaced.
 *
 * Shared by both components so the two cannot drift apart.
 */
function disableChildren(children: React.ReactNode, reason: string): React.ReactNode {
  return React.Children.map(children, (child) =>
    React.isValidElement(child)
      ? React.cloneElement(
          child as React.ReactElement<{ disabled?: boolean; tabIndex?: number; title?: string }>,
          // `title` on the control itself, not only on the wrapper: hovering
          // lands on the button, and a DOM dump of a refused control should say
          // what refused it.
          { disabled: true, tabIndex: -1, title: reason }
        )
      : child
  );
}

export const DisabledWithTooltip: React.FC<DisabledWithTooltipProps> = ({
  disabled,
  tooltip,
  children,
  className,
  showIcon = true,
  side = 'top',
  delayDuration = 300,
}) => {
  // If not disabled, render children directly
  if (!disabled) {
    return <>{children}</>;
  }


  return (
    <TooltipProvider>
      <Tooltip delayDuration={delayDuration}>
        <TooltipTrigger asChild>
          <div
            className={cn(
              // Disabled styling
              'opacity-50 cursor-not-allowed select-none',
              // Prevent interactions with children
              '[&_*]:pointer-events-none',
              className
            )}
            aria-disabled="true"
            // group, not presentation: role="presentation" removes the element
            // from the accessibility tree, which silently discards the
            // aria-disabled beside it — the one thing this wrapper exists to
            // announce. group keeps it announced as a disabled region.
            role="group"
            // The reason lived ONLY inside the Radix tooltip, which renders in
            // a portal when the pointer is over the trigger. So it existed for
            // a mouse and for nothing else: the region announced itself as
            // disabled and never said why, and a DOM dump of a failing test
            // showed a bare `<button disabled>Edit</button>` with the
            // explanation nowhere in the document.
            //
            // Named here, and on the control itself below, so the sentence is
            // in the accessibility tree and in the markup whether or not the
            // tooltip ever opens.
            title={tooltip}
            aria-label={tooltip}
          >
            {disableChildren(children, tooltip)}
          </div>
        </TooltipTrigger>
        <TooltipContent
          side={side}
          className={cn(
            'max-w-xs bg-popover text-foreground border-border',
            'px-3 py-2 text-sm'
          )}
        >
          <div className="flex items-start gap-2">
            {showIcon && (
              <Lock className="h-4 w-4 flex-shrink-0 mt-0.5 text-warning-emphasis" />
            )}
            <span>{tooltip}</span>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
