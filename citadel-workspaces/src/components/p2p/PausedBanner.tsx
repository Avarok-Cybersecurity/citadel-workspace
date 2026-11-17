/**
 * The strip under a paused conversation's header.
 *
 * A status, not an alert: nothing went wrong, the user chose this. It carries
 * Resume itself so undoing the pause never needs a trip into settings.
 */
import { Button } from '@/components/ui/button';
import { PauseCircle } from 'lucide-react';
import { PAUSE_COPY } from '@/lib/p2p-pause/pause-copy';

export function PausedBanner({ busy, onResume }: { busy: boolean; onResume: () => void }): JSX.Element {
  return (
    <div
      role="status"
      data-testid="p2p-paused-banner"
      className="flex items-center justify-between gap-3 border-b border-warning/40 bg-warning/10 px-4 py-2"
    >
      <p className="flex min-w-0 items-center gap-2 text-sm text-warning-emphasis">
        <PauseCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0">{PAUSE_COPY.banner}</span>
      </p>
      <Button size="sm" variant="outline" className="shrink-0" disabled={busy} aria-busy={busy} onClick={onResume}>
        {PAUSE_COPY.resume}
      </Button>
    </div>
  );
}
