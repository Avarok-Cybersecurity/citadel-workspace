/**
 * What a session switch says while it runs, as ONE notice that changes.
 *
 * Resuming a session from the landing page raised "Reconnecting... Loading
 * bob0924" and then, a moment later, "Connected! Now viewing bob0924" -- as two
 * toasts, so both sat on screen together, one saying it was still working and
 * the other that it was done. Both were styled as successes, too, so the one
 * still in progress wore a tick.
 *
 * Every notice of one switch shares an id, and Sonner replaces a toast with the
 * same id rather than stacking a second: the progress notice BECOMES the
 * outcome. Both switch paths (the previous-sessions bar and the login
 * redirect) build their notices here, so they cannot come apart again.
 */
import type { ToastOptions } from '@/hooks/use-toast';
import { SESSION_OWNED_ELSEWHERE } from './claim-session';

export interface SessionSwitchToasts {
  progress: ToastOptions;
  connected: ToastOptions;
  ownedElsewhere: ToastOptions;
  /** The agent no longer holds it: the progress notice must not stay saying "Reconnecting". */
  signedOut: ToastOptions;
  failed: (description: string) => ToastOptions;
}

/** `label` is what is being opened, as the caller names it to the user. */
export function sessionSwitchToasts(cid: bigint, label: string): SessionSwitchToasts {
  const id: string = `session-switch:${cid.toString()}`;
  return {
    progress: { id, title: 'Reconnecting...', description: `Loading ${label}`, variant: 'default' },
    connected: { id, title: 'Connected!', description: `Now viewing ${label}`, variant: 'success' },
    ownedElsewhere: { id, ...SESSION_OWNED_ELSEWHERE },
    signedOut: { id, title: 'Sign in to continue', description: `Your session for ${label} has ended.`, variant: 'default' },
    failed: (description: string): ToastOptions => ({ id, title: 'Connection Failed', description, variant: 'destructive' }),
  };
}
