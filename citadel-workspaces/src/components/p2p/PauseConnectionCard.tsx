/**
 * Pause / Resume in a conversation's settings, with what it means spelled out.
 *
 * The card is presentational; `PauseConnectionControl` binds it to the store.
 */
import { Button } from '@/components/ui/button';
import { PauseCircle } from 'lucide-react';
import { PAUSE_COPY, pauseExplanation } from '@/lib/p2p-pause/pause-copy';
import type { PauseView } from './hooks/use-peer-pause';

interface PauseConnectionCardProps {
  status: PauseView;
  peerName: string;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
}

export function PauseConnectionCard({ status, peerName, busy, onPause, onResume }: PauseConnectionCardProps): JSX.Element {
  const paused: boolean = status === 'paused';
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-surface/50 p-4" data-testid="pause-connection-card">
      <div className="flex items-start gap-3">
        <PauseCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning-emphasis" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{paused ? PAUSE_COPY.statusLabel : PAUSE_COPY.pause}</p>
          {status === 'unknown' ? (
            <p className="text-xs text-muted-foreground">{PAUSE_COPY.unreadable}</p>
          ) : (
            <p className="text-xs text-muted-foreground">{pauseExplanation(peerName, paused ? 'paused' : 'active')}</p>
          )}
        </div>
      </div>
      {(status === 'active' || status === 'paused') && (
        <Button
          variant="outline" size="sm" className="self-start"
          disabled={busy} aria-busy={busy}
          onClick={paused ? onResume : onPause}
          data-testid={paused ? 'resume-connection' : 'pause-connection'}
        >
          {paused ? PAUSE_COPY.resume : PAUSE_COPY.pause}
        </Button>
      )}
    </div>
  );
}
