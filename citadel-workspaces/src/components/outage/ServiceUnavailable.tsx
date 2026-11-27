import { CloudOff, WifiOff } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { RecoveryNotice } from '@/components/recovery-route/RecoveryNotice';
import { recovery, type Recovery } from '@/lib/recovery-route/recovery';
import type { Wake } from '@/lib/recovery-route/binding';
import { OUTAGE_CODE, OUTAGE_COPY, OUTAGE_TITLE, outage, outageCause, type OutageCause, type OutageKind } from '@/lib/reconnect/outage';

/**
 * The whole page, in place of a workspace a failure keeps from being shown (lib/reconnect/
 * outage.ts): whose failure it is in one line, the code support asks for, and the way out that
 * fits the cause (owner decision 2026-11-27):
 *
 *   offline       waits for the network; back online, a page the agent cannot bring back by itself
 *                 runs `onRetry` (a lost session's sign-in, a timed-out load's reload) by itself
 *   reconnecting  waits for the agent's own reconnect instead of reloading over it; then Reload
 *   server down   Try again: the session is gone, and its sign-in is what reaches the server
 *   load timeout  Try again reloads
 *
 * `onRetry` is the loader's: a lost session's sign-in, else a reload.
 */
const subscribeOnline = (changed: () => void): (() => void) => {
  window.addEventListener('online', changed);
  window.addEventListener('offline', changed);
  return (): void => {
    window.removeEventListener('online', changed);
    window.removeEventListener('offline', changed);
  };
};

const isOnline = (): boolean => navigator.onLine;

/** Ends the reconnect wait when the outage is over: the agent reconnected and the loader cleared it. */
const outageOver: Wake = (resume: () => void): (() => void) =>
  outage.subscribe((): void => { if (outage.get() === null) resume(); });

function wayOut(cause: OutageCause, kind: OutageKind, onRetry: () => void): Recovery {
  const retry = async (): Promise<void> => onRetry();
  switch (cause) {
    case 'offline': {
      // A reconnect carries on by itself once the network is back; anything else needs onRetry.
      const wake: Wake = (resume: () => void): (() => void) => {
        const back = (): void => {
          if (kind !== 'reconnect-slow') onRetry();
          resume();
        };
        window.addEventListener('online', back);
        return (): void => window.removeEventListener('online', back);
      };
      return recovery('session.offline', { wake, retry });
    }
    case 'reconnecting': return recovery('session.reconnect-slow', { wake: outageOver });
    case 'server-down': return recovery('session.server-unreachable', { retry });
    case 'load-timeout': return recovery('session.workspace-timeout', { retry });
  }
}

export function ServiceUnavailable({ kind, onRetry }: { kind: OutageKind; onRetry: () => void }): JSX.Element {
  const cause: OutageCause = outageCause(kind, useSyncExternalStore(subscribeOnline, isOnline));
  const Icon: typeof CloudOff = cause === 'offline' ? WifiOff : CloudOff;
  return (
    <div className="fixed inset-0 z-[105] flex items-center justify-center bg-background px-4" data-testid="service-unavailable" data-cause={cause}>
      <div className="flex w-full max-w-md flex-col items-center gap-3 text-center">
        <Icon className="h-12 w-12 text-muted-foreground" aria-hidden="true" data-testid="service-unavailable-icon" />
        <h1 className="text-lg font-medium text-foreground" data-testid="service-unavailable-title">{OUTAGE_TITLE[cause]}</h1>
        <RecoveryNotice
          key={cause}
          className="p-0"
          recovery={wayOut(cause, kind, onRetry)}
          message={(
            <span className="text-muted-foreground">
              {OUTAGE_COPY.codeLabel}{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground" data-testid="service-unavailable-code">{OUTAGE_CODE[kind]}</code>
            </span>
          )}
        />
      </div>
    </div>
  );
}
