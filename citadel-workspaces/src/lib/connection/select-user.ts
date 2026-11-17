import type { ConnectionIO } from './io';
import { SET_USER_TIMEOUT_MS } from './constants';
import { debugLog } from '@/lib/debug-config';

/**
 * Point this tab at an account, without letting a slow write stop the flow.
 *
 * `setSelectedUser` writes tab context to IndexedDB, and IndexedDB can stall —
 * an upgrade blocked by another tab, a busy agent, a private-browsing quota.
 * `handleAuthSuccess` learned this and raced the call against a timeout,
 * continuing on expiry with a comment saying why. `switchAccount`, in the next
 * file over, awaited it bare: a stalled write there meant the user pressed a
 * workspace icon and nothing happened, with the old account still on screen.
 *
 * One implementation, so the next caller inherits the lesson instead of
 * repeating the shape.
 *
 * `remember` is what makes "a lost write costs the selection on the NEXT page
 * load, not this one" true. It was a claim about the callers, and it held for
 * one of them: `handleAuthSuccess` writes `currentConnectionInfo` with the
 * username immediately afterwards, so a stalled write cost it nothing.
 * `switchAccount` did not, and had no in-memory copy at all — so a stalled
 * write left `resolveCurrentUserId()` with a null from BOTH of its sources,
 * every permission fetch bailing with "nobody is signed in on this tab", and
 * every gated control on the page refused for its lifetime. CI reported it as
 * the workspace administrator's own Edit button, disabled, for sixty seconds
 * across three attempts, with that sentence in its title.
 *
 * So the mirror happens here, before the race and regardless of its outcome:
 * one implementation means one place to remember, rather than a rule each
 * caller is trusted to follow.
 *
 * Required rather than optional: a caller that genuinely has nowhere to put it
 * should have to say so, not inherit a no-op.
 *
 * Returns whether the durable write completed, for callers that want to say so.
 */
export async function selectUserWithoutBlocking(
  io: ConnectionIO,
  selection: { selectedUsername: string; selectedServerAddress: string; selectedCid?: bigint },
  remember: (selection: { username: string; serverAddress: string; cid?: bigint }) => void,
): Promise<boolean> {
  remember({
    username: selection.selectedUsername,
    serverAddress: selection.selectedServerAddress,
    cid: selection.selectedCid,
  });

  try {
    await Promise.race([
      io.setSelectedUser(selection),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('setSelectedUser timeout')), SET_USER_TIMEOUT_MS),
      ),
    ]);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message === 'setSelectedUser timeout') {
      debugLog('ConnectionService', 'setSelectedUser timed out — continuing anyway');
      return false;
    }
    throw error;
  }
}
