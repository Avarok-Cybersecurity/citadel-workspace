/**
 * A tab whose session another browser now holds.
 *
 * The agent refuses to hand a live session to a different connection without
 * the password, so on load this tab used to adopt a session it could not use
 * and wait for ever on "Workspace data is taking longer than expected". The
 * workspace switcher already had the answer (#59): ask, then open sign-in with
 * the username filled in. This is that same offer -- `offerTakeover` and
 * `TakeoverSignIn` -- reached from page start instead.
 */
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NavigateFunction } from 'react-router';
import { offerTakeover, takeoverPrompt } from '@/lib/sessions/takeover';
import { useConfirm } from '@/components/shared/confirm-dialog';
import { LazyTakeoverSignIn as TakeoverSignIn } from '@/components/LazyTakeoverSignIn';
import { Button } from '@/components/ui/button';
import { agentHostsConversations } from '@/lib/agent-conversations/capabilities';
import { heldElsewhereSignIn, type SignInRequest } from '@/lib/sessions/sign-in-request';

export interface HeldElsewhere {
  /** Whose session is held elsewhere, or null when none is. */
  username: string | null;
  /** `declined` runs when the user does not take it back. */
  offer: (username: string, declined?: () => void) => void;
  /** What the loader shows instead of its spinner. */
  notice: JSX.Element;
}

export function useHeldElsewhere(): HeldElsewhere {
  const confirm: ReturnType<typeof useConfirm> = useConfirm();
  const navigate: NavigateFunction = useNavigate();
  const [username, setUsername] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState<SignInRequest | null>(null);
  // Joinable beside the other window when the agent hosts the account (0.8.6).
  const [joinable, setJoinable] = useState<boolean>(false);

  const offer: (name: string, declined?: () => void) => void = useCallback((name: string, declined?: () => void): void => {
    setUsername(name);
    void agentHostsConversations().then(setJoinable);
    void offerTakeover(name, { confirm, signInAs: (who: string) => setSigningIn(heldElsewhereSignIn(who)), declined });
  }, [confirm]);

  const prompt: ReturnType<typeof takeoverPrompt> | null = username === null ? null : takeoverPrompt(username, joinable);
  const notice: JSX.Element = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background px-4" data-testid="session-held-elsewhere">
      <div className="flex max-w-md flex-col items-center space-y-4 text-center">
        <p className="text-lg font-medium text-foreground">{prompt?.title}</p>
        <p className="text-sm text-muted-foreground">{prompt?.description}</p>
        <div className="flex gap-2">
          <Button onClick={() => { if (username !== null) setSigningIn(heldElsewhereSignIn(username)); }}>{prompt?.confirmLabel}</Button>
          <Button variant="outline" onClick={() => navigate('/connect')}>Go to Connect</Button>
        </div>
      </div>
      <TakeoverSignIn request={signingIn} onClose={() => setSigningIn(null)} />
    </div>
  );
  return { username, offer, notice };
}
