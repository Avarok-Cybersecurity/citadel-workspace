import { useEffect, useState } from 'react';
import { eventEmitter } from '@/lib/event-emitter';

interface ServiceHealth {
  isHealthy: boolean;
  lastCheck: number;
  error?: string;
}

/**
 * Whether the local agent is reachable.
 *
 * `healthCheckService` has polled this every 10 seconds since it was written and
 * emitted `service-health` to **zero listeners** — so the app knew the internal
 * service was down and told nobody. The user met it as scattered, uncorrelated
 * per-operation failures, or as silence.
 *
 * Distinct from `useOnlineStatus`, which reports the DEVICE's connectivity. The
 * agent runs on localhost: it can be dead while the browser is perfectly online,
 * and that produces exactly the "app simply stops working" symptom the offline
 * banner exists to explain.
 *
 * Starts optimistic. The first poll may be up to the interval away, and opening
 * with a red banner that resolves itself would train people to ignore it.
 */
export function useServiceHealth(): { isHealthy: boolean } {
  const [isHealthy, setIsHealthy] = useState(true);

  useEffect(() => {
    const handler = (health: unknown): void => {
      const h: ServiceHealth | undefined = health as ServiceHealth | undefined;
      if (typeof h?.isHealthy === 'boolean') setIsHealthy(h.isHealthy);
    };
    eventEmitter.on('service-health', handler);
    return (): void => eventEmitter.off('service-health', handler);
  }, []);

  return { isHealthy };
}
