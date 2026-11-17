/**
 * What a list says when it has nothing in it.
 *
 * A list that renders zero rows and no explanation reads as a broken screen:
 * the user cannot tell "nobody is here yet" from "this failed to load" from
 * "your filter excludes everything", and there is nothing to click. Each of
 * those needs a different sentence and, where one exists, a different action.
 */

import type { LucideIcon } from 'lucide-react';
import { Button } from './button';

interface EmptyStateProps {
  icon: LucideIcon;
  /** What is empty, in the user's words. */
  title: string;
  /** Why it is empty, and what would change that. */
  description: string;
  /** The one thing to do about it, when there is one. */
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <Icon className="h-10 w-10 text-muted-foreground/60" aria-hidden="true" />
      <p className="text-base font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && (
        <Button variant="outline" size="sm" className="mt-2 h-[44px] min-w-[44px]" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
