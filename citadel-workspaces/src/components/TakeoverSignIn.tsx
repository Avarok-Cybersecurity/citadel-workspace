/**
 * The sign-in for a session another browser window holds.
 *
 * With an agent that hosts the account (0.8.6), the session can be opened here
 * too, both windows staying live: that is offered first (OpenHereToo), with
 * moving it as the alternative. With an older agent moving it is the only way:
 * the agent re-points a live session only for a Connect that proves the
 * password (connect.rs, credential_fingerprint); ClaimSession cannot. So that
 * opens the ordinary sign-in form with the username filled in, whose
 * SessionAlreadyActive path then claims and opens the workspace.
 *
 * An account the agent no longer holds has nothing to join or move: it goes
 * straight to that same sign-in form, saying why.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NavigateFunction } from 'react-router';
import { Login } from './Login';
import { OpenHereToo } from './OpenHereToo';
import { useToast } from '@/hooks/use-toast';
import { postAuthSetup } from '@/lib/post-auth-setup';
import { getWorkspacePath } from '@/lib/workspace-navigation';
import { toastError } from '@/lib/toast-helpers';
import { describeFailure } from '@/lib/failure-message';
import { agentHostsConversations } from '@/lib/agent-conversations/capabilities';
import type { SignInRequest } from '@/lib/sessions/sign-in-request';

export interface TakeoverSignInProps {
  /** The account to sign in as and why, or null when no sign-in is open. */
  request: SignInRequest | null;
  onClose: () => void;
}

type Way = 'deciding' | 'join' | 'move';

export function TakeoverSignIn({ request, onClose }: TakeoverSignInProps): JSX.Element | null {
  const navigate: NavigateFunction = useNavigate();
  const { toast } = useToast();
  const [way, setWay] = useState<Way>('deciding');
  const username: string | null = request?.username ?? null;
  const signedOut: boolean = request?.kind === 'signed-out';

  useEffect(() => {
    if (username === null || signedOut) return undefined;
    let live: boolean = true;
    setWay('deciding');
    agentHostsConversations().then(
      (joinable: boolean) => { if (live) setWay(joinable ? 'join' : 'move'); },
      () => { if (live) setWay('move'); },
    );
    return (): void => { live = false; };
  }, [username, signedOut]);

  if (request === null) return null;
  if (request.kind === 'held-elsewhere' && way === 'deciding') return null;
  if (request.kind === 'held-elsewhere' && way === 'join') {
    return <OpenHereToo username={request.username} onClose={onClose} onMoveInstead={() => setWay('move')} />;
  }

  const finish = async (cid: string): Promise<void> => {
    onClose();
    try {
      await postAuthSetup(BigInt(cid));
      navigate(getWorkspacePath());
    } catch (error) {
      toastError(toast, 'Could not open the workspace', describeFailure(error, 'Sign in again to continue.'));
    }
  };

  return (
    <Login
      initialUsername={request.username}
      notice={request.kind === 'signed-out' ? request.notice : undefined}
      scope={request.kind === 'signed-out' ? request.server ?? undefined : undefined}
      onNext={(cid: string) => { void finish(cid); }}
      onCancel={onClose}
    />
  );
}
