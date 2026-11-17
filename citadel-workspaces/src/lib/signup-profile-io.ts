/**
 * The wiring for `signup-profile.ts`: the workspace event, the protocol send
 * and the toast. Kept apart so the rules are tested without any of them.
 */
import { applySignupProfile, planSignupProfileUpdate, type SignupProfileFields } from '@/lib/signup-profile';
import { workspaceEvents } from '@/lib/workspace-events';
import WorkspaceService from '@/lib/workspace-service';
import { toast } from '@/hooks/use-toast';
import { debugLog } from '@/lib/debug-config';

/**
 * How long a new session may take to reach the workspace before the profile
 * details are given up on. The same bound the registration itself gets
 * (`useJoinRegistration`'s 30-second timeout): after it, the user is told and
 * pointed at Settings rather than left believing it saved.
 */
export const SIGNUP_PROFILE_WORKSPACE_WAIT_MS: number = 30_000;

/**
 * Resolves on the next `workspace:loaded` in this tab.
 *
 * The event carries no usable session id (`buildConnectionInfo` sends cid 0),
 * so "the next one" is the identity: it is subscribed the moment registration
 * succeeds, and the load that follows is the one this tab issues for the
 * session it has just selected.
 */
export function nextWorkspaceLoad(timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject): void => {
    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
      unsubscribe();
      reject(new Error('the workspace did not finish loading'));
    }, timeoutMs);
    const unsubscribe: () => void = workspaceEvents.onWorkspaceEvent('workspace:loaded', (): void => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    });
  });
}

/** Fire and forget: failures become a toast, never a rejection. */
export function startSignupProfile(fields: SignupProfileFields): void {
  const _done: Promise<void> = applySignupProfile(planSignupProfileUpdate(fields), {
    waitForWorkspace: () => nextWorkspaceLoad(SIGNUP_PROFILE_WORKSPACE_WAIT_MS),
    send: (update) => WorkspaceService.updateUserProfile(update),
    reportFailure: (description: string): void => {
      debugLog('SignupProfile', 'Profile details not saved:', description);
      toast({ title: 'Profile details not saved', description, variant: 'destructive' });
    },
  });
}
