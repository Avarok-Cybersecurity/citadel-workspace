import { useEffect, useRef } from 'react';
import { browserSessionStorage } from '@/lib/chat/draft-handoff';
import { peekPendingRedirect, type PendingRedirect } from '@/lib/share/pending-redirect';

/**
 * A secure link opened by a visitor who is not signed in lands here, on the landing page: open
 * sign-in once, and fill the link's server into the join wizard for a visitor with no account
 * there yet. The link itself waits in storage until a session resolves it (resolve-here.ts).
 */
export function usePendingRedirectSignIn(startLogin: () => void, fillServer: (address: string) => void): void {
  const acted: React.MutableRefObject<boolean> = useRef<boolean>(false);
  useEffect(() => {
    if (acted.current) return;
    const pending: PendingRedirect | null = peekPendingRedirect(browserSessionStorage());
    if (pending === null) return;
    acted.current = true;
    fillServer(pending.server);
    startLogin();
  }, [startLogin, fillServer]);
}
