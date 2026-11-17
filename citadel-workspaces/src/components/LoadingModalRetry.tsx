import { Button } from '@/components/ui/button';

/** Offered beside Dismiss when a failed operation can simply be run again. */
export function LoadingModalRetry({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <Button variant="outline" size="sm" className="mt-4" onClick={onRetry} data-testid="loading-modal-retry">
      Retry
    </Button>
  );
}
