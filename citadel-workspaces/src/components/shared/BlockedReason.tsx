/**
 * Says WHY a control is unavailable to someone who cannot hover.
 *
 * A disabled button carried its reason in `title`, which only a mouse ever shows: on a phone the
 * control just sat dimmed and a keyboard user could not even land on it. Wrapped here, the control
 * stays dimmed and inert, but the wrapper is one focusable button that names the action and says the
 * reason when pressed, by tap, click, Enter or Space.
 *
 * With no reason the child is returned untouched.
 */
import { cloneElement, type KeyboardEvent, type ReactElement } from 'react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface ControlProps {
  className?: string;
  'aria-label'?: string;
}

interface BlockedReasonProps {
  reason: string | null;
  children: ReactElement<ControlProps>;
}

export function BlockedReason({ reason, children }: BlockedReasonProps): JSX.Element {
  const { toast } = useToast();
  if (reason === null) return children;
  const say = (): void => { toast({ description: reason }); };
  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    say();
  };
  return (
    <span
      role="button"
      tabIndex={0}
      aria-disabled="true"
      aria-label={children.props['aria-label'] ?? reason}
      data-testid="blocked-reason"
      className="inline-flex shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={say}
      onKeyDown={onKeyDown}
    >
      {/* The real control stays disabled and out of the tab order; it only draws the dimmed state. */}
      {cloneElement(children, { className: cn(children.props.className, 'pointer-events-none'), 'aria-hidden': true, tabIndex: -1 } as Partial<ControlProps>)}
    </span>
  );
}
