/**
 * Asking before moving a session another browser window holds.
 *
 * Apart from claim-session.ts, which the landing page reaches at start-up: this
 * is needed only once a switch or a page load finds the session held elsewhere,
 * so the workspace switcher imports it when that happens.
 */
import { agentHostsConversations } from '../agent-conversations/capabilities';

/** What to ask before moving a session another browser window holds. */
export function takeoverPrompt(username: string, joinable: boolean): { title: string; description: string; confirmLabel: string } {
  if (joinable) {
    return {
      title: `${username} is open in another window`,
      description:
        'Open it here too? Both windows stay signed in and in step. ' +
        'You will confirm with your password, once for this browser.',
      confirmLabel: 'Open here too',
    };
  }
  return {
    title: `${username} is open in another browser window`,
    description:
      'Use it here instead? You will sign in with your password to move it to this window, ' +
      'and the other window will stop receiving updates for this account.',
    confirmLabel: 'Use it here',
  };
}

export interface TakeoverCallbacks {
  /** Ask before moving a session another browser window holds. */
  confirm: (request: { title: string; description: string; confirmLabel: string }) => Promise<boolean>;
  /** Open sign-in for this username: the password is the agent's only takeover door. */
  signInAs: (username: string) => void;
  /** The user said no. Absent where saying no simply leaves things as they are. */
  declined?: () => void;
}

/**
 * A session live on another connection cannot be claimed: the agent refuses
 * `only_if_orphaned: false` for it. Switching to one used to do nothing at all;
 * this asks, and on yes starts the password sign-in that moves it.
 */
export async function offerTakeover(username: string, callbacks: TakeoverCallbacks): Promise<void> {
  if (await callbacks.confirm(takeoverPrompt(username, await agentHostsConversations()))) callbacks.signInAs(username);
  else callbacks.declined?.();
}
