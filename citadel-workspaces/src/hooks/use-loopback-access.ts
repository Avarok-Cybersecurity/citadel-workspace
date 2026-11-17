import { useEffect, useRef, useState } from 'react';
import { readLoopbackAccess, type LoopbackAccess, type LoopbackAccessReading } from '@/lib/loopback-permission';

/**
 * The browser's loopback permission for this page, kept current.
 *
 * `onGranted` runs once when the permission turns to granted after being anything else.
 * The page reloads there: a WebSocket that was waiting on the prompt when it was answered
 * stays stuck, and Chrome queues every later connection to the same host behind it
 * (observed on Chrome 153), so only a fresh page reaches the agent.
 */
export function useLoopbackAccess(permissions: Permissions | undefined, onGranted: () => void): LoopbackAccess {
  const [state, setState] = useState<LoopbackAccess>('unknown');
  const latestOnGranted: React.MutableRefObject<() => void> = useRef(onGranted);
  latestOnGranted.current = onGranted;

  useEffect(() => {
    let cancelled: boolean = false;
    let watched: PermissionStatus | null = null;
    const onChange = (): void => {
      if (!watched) return;
      const next: LoopbackAccess = watched.state;
      setState(next);
      if (next === 'granted') latestOnGranted.current();
    };
    void readLoopbackAccess(permissions).then((reading: LoopbackAccessReading): void => {
      if (cancelled) return;
      setState(reading.state);
      watched = reading.status;
      watched?.addEventListener('change', onChange);
    });
    return (): void => {
      cancelled = true;
      watched?.removeEventListener('change', onChange);
    };
  }, [permissions]);

  return state;
}
