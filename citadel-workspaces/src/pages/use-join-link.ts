import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { joinServerFrom, withoutJoinParams } from '@/lib/invite-link';
import { useClearAfterClose } from './use-clear-after-close';

/**
 * Open the join flow when navigated here with `?join=1` -- from Manage
 * Accounts' empty state, or an invite link, which also names the server
 * (`&server=`) to fill in. Both stay in the URL while the wizard is open
 * (`wizardOpen`), so a reload reopens it with the server filled in, and are
 * cleared with `replace` once it closes (use-clear-after-close.ts), so a later
 * reload or back/forward does not replay it.
 */
export function useJoinLink(openServerStep: () => void, fillServer: (address: string) => void, wizardOpen: boolean): void {
  const [searchParams, setSearchParams] = useSearchParams();
  /** The query string last acted on, so a StrictMode re-run does not act twice. */
  const consumed: React.MutableRefObject<string | null> = useRef<string | null>(null);
  const [pending, setPending] = useState<boolean>(false);

  useEffect(() => {
    const query: string = searchParams.toString();
    if (consumed.current === query || searchParams.get('join') !== '1') return;
    consumed.current = query;
    const server: string | null = joinServerFrom(searchParams);
    if (server !== null) fillServer(server);
    openServerStep();
    setPending(true);
  }, [searchParams, openServerStep, fillServer]);

  const clear: () => void = useCallback((): void => {
    setPending(false);
    setSearchParams((current: URLSearchParams): URLSearchParams => withoutJoinParams(current), { replace: true });
  }, [setSearchParams]);
  useClearAfterClose(pending, wizardOpen, clear);
}
