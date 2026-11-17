/**
 * The member's answers to apps that want to change their calendar (design §3.8, layer 3): the SDK
 * host asks through `ask`, and the pane shows one prompt at a time (`asking`) until the member
 * answers it. A prompt left open when the pane goes away is answered `unanswered`, which lets
 * nothing through and is not remembered, so the app is asked again next time.
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { ConsentAnswer } from '@/lib/calendar/sdk-host';

interface Waiting {
  readonly appId: string;
  readonly resolve: (answer: ConsentAnswer) => void;
}

export interface SdkConsent {
  readonly ask: (appId: string) => Promise<ConsentAnswer>;
  /** The app the member is being asked about now, or null. */
  readonly asking: string | null;
  readonly answer: (answer: Exclude<ConsentAnswer, 'unanswered'>) => void;
}

export function useSdkConsent(): SdkConsent {
  const queue: MutableRefObject<Waiting[]> = useRef<Waiting[]>([]);
  const [asking, setAsking] = useState<string | null>(null);
  const ask: (appId: string) => Promise<ConsentAnswer> = useCallback((appId: string): Promise<ConsentAnswer> => new Promise<ConsentAnswer>((resolve): void => {
    queue.current.push({ appId, resolve });
    setAsking(queue.current[0]?.appId ?? null);
  }), []);
  const answer: (given: Exclude<ConsentAnswer, "unanswered">) => void = useCallback((given: Exclude<ConsentAnswer, 'unanswered'>): void => {
    queue.current.shift()?.resolve(given);
    setAsking(queue.current[0]?.appId ?? null);
  }, []);
  useEffect(() => (): void => {
    for (const waiting of queue.current.splice(0)) waiting.resolve('unanswered');
  }, []);
  return { ask, asking, answer };
}
