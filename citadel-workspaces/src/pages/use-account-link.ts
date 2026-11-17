import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { NavigateFunction } from 'react-router';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/components/shared/confirm-dialog';
import { runAsyncSetup } from '@/lib/utils/async-utils';
import { ACCOUNT_LINK_PARAMS, hasAccountLinkParams } from '@/lib/onboarding/account-link-params';
import type { AccountLinkDecision } from '@/lib/onboarding/open-account-link';
import type { OrphanSessionWithWorkspace } from '@/components/useOrphanSessions';
import { useClearAfterClose } from './use-clear-after-close';

/**
 * Act on `?account=` / `?link=` once per page load, and keep them in the URL
 * until what they started is over.
 *
 * A reload while the link's sign-in is open (the new-version banner's, say)
 * therefore reopens that sign-in, rather than landing on a bare page. They are
 * cleared with `replace` once that is over: at once for a malformed link or a
 * switch to a live session, and when the sign-in closes otherwise
 * (use-clear-after-close.ts). `onLogin` receives the username when there is no
 * live session to switch to; `signInOpen` is whether that sign-in is showing.
 * The parser and the switch flow are imported only when a link is present
 * (account-link-runner.ts), so a plain visit does not load them.
 */
export function useAccountLink(onLogin: (username: string, server: string | null) => void, signInOpen: boolean): void {
  const navigate: NavigateFunction = useNavigate();
  const { toast } = useToast();
  const confirm: ReturnType<typeof useConfirm> = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  /** The query string last acted on, so a StrictMode re-run does not act twice. */
  const consumed: React.MutableRefObject<string | null> = useRef<string | null>(null);
  const latestOnLogin: React.MutableRefObject<(username: string, server: string | null) => void> = useRef(onLogin);
  latestOnLogin.current = onLogin;
  const [signInPending, setSignInPending] = useState<boolean>(false);

  const clearLink: () => void = useCallback((): void => {
    setSignInPending(false);
    setSearchParams((current: URLSearchParams): URLSearchParams => {
      const next: URLSearchParams = new URLSearchParams(current);
      for (const key of ACCOUNT_LINK_PARAMS) next.delete(key);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    const query: string = searchParams.toString();
    if (consumed.current === query || !hasAccountLinkParams(searchParams)) return;
    consumed.current = query;

    const linkParams: URLSearchParams = new URLSearchParams(searchParams);
    runAsyncSetup(async (): Promise<void> => {
      const { runAccountLink } = await import('./account-link-runner');
      const login = (username: string, server: string | null): void => { setSignInPending(true); latestOnLogin.current(username, server); };
      const outcome: AccountLinkDecision<OrphanSessionWithWorkspace> | null = await runAccountLink(linkParams, { navigate, toast, confirm, login });
      if (outcome?.kind !== 'login') clearLink();
    });
  }, [searchParams, navigate, toast, confirm, clearLink]);

  useClearAfterClose(signInPending, signInOpen, clearLink);
}

/**
 * Sign-in that an account link can start: `linkedUsername` is the name the link
 * carried, for the form to start with; `startPlainLogin` is the ordinary button,
 * which clears it. `signInOpen` is whether the sign-in step is showing.
 */
export function useLinkedLogin(
  startLogin: () => void, signInOpen: boolean,
): { linkedUsername: string | undefined; linkedServer: string | undefined; startPlainLogin: () => void } {
  const [linked, setLinked] = useState<{ username: string; server: string | undefined } | undefined>(undefined);
  useAccountLink((username: string, server: string | null): void => { setLinked({ username, server: server ?? undefined }); startLogin(); }, signInOpen);
  const startPlainLogin = (): void => { setLinked(undefined); startLogin(); };
  return { linkedUsername: linked?.username, linkedServer: linked?.server, startPlainLogin };
}
