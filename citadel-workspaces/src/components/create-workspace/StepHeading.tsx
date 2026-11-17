import { useEffect, useRef, type JSX, type ReactNode } from 'react';

export interface StepHeadingProps {
  readonly title: string;
  readonly children?: ReactNode;
}

/**
 * The heading of a create-workspace screen, focused when the screen appears.
 *
 * The steps replace one another in place, so without this a keyboard or screen
 * reader user is left focused on a button that no longer exists and hears
 * nothing about the new screen. Moving focus to its heading announces where they
 * are and starts the tab order at the top of it.
 */
export function StepHeading({ title, children }: StepHeadingProps): JSX.Element {
  const ref: React.RefObject<HTMLHeadingElement> = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div className="mb-6">
      <h1 ref={ref} tabIndex={-1} className="text-2xl font-semibold tracking-tight text-foreground outline-none">
        {title}
      </h1>
      {children && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{children}</p>}
    </div>
  );
}
