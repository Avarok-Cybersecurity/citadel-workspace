import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface CheckNowButtonProps {
  checking: boolean;
  onCheck: () => void;
  /** "Retry" after a failure; "Check now" otherwise. */
  label?: string;
  variant?: 'default' | 'secondary';
}

/** Asks the agent to look for a release now. The spinner stops for reduced motion; the words say "Checking…" either way. */
export function CheckNowButton({ checking, onCheck, label = 'Check now', variant = 'secondary' }: CheckNowButtonProps): JSX.Element {
  return (
    <Button size="sm" variant={variant} onClick={onCheck} disabled={checking} data-testid="agent-update-check" className="gap-2">
      {checking
        ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
        : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
      {checking ? 'Checking…' : label}
    </Button>
  );
}
