/**
 * "Add a security key?", asked after a sign-in, as a promise the sign-in awaits.
 *
 * Asked after, not before, because only a signed-in session can enrol a key,
 * and it is a real click either way: the card's button is the user gesture a
 * WebAuthn ceremony needs. If the form goes away first the offer resolves as
 * declined, so nothing keeps the password it holds alive.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountRef, StepUp } from '@/lib/sign-in/types';

export interface KeyOffer {
  account: AccountRef;
  stepUp: StepUp;
  title: string;
  body: string;
  finish: (added: boolean) => void;
}

export type KeyOfferRequest = Omit<KeyOffer, 'finish'>;

export function useKeyOffer(): { offer: KeyOffer | null; offerKey: (request: KeyOfferRequest) => Promise<boolean> } {
  const [offer, setOffer] = useState<KeyOffer | null>(null);
  const pending: React.MutableRefObject<((added: boolean) => void) | null> = useRef(null);

  useEffect(() => (): void => { pending.current?.(false); }, []);

  const offerKey: (request: KeyOfferRequest) => Promise<boolean> = useCallback((request: KeyOfferRequest): Promise<boolean> => new Promise<boolean>((resolve) => {
    const finish = (added: boolean): void => {
      pending.current = null;
      setOffer(null);
      resolve(added);
    };
    pending.current = finish;
    setOffer({ ...request, finish });
  }), []);

  return { offer, offerKey };
}
