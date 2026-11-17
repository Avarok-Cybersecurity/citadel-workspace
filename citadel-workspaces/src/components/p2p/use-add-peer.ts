import { useState } from 'react';
import { debugLog } from '@/lib/debug-config';

/**
 * Sending a connection request to someone chosen from a list.
 *
 * It was a typed-CID form: `setValue(cid)` then `submit()`. The Messages page's
 * Available list used it that way on click -- set the CID, submit at once --
 * and `submit` read the value from the render before, which was still empty,
 * so it returned without sending anything. The one-click request never worked.
 * The CID box is gone too (it asked for a number no screen shows); people are
 * found by name, so the CID is passed straight in.
 */
export interface PeerRequest {
  error: string | null;
  sending: boolean;
  request: (cid: bigint) => Promise<void>;
}

export function usePeerRequest(
  register: (cid: bigint) => Promise<unknown>,
  onSent: () => void,
): PeerRequest {
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const request = async (cid: bigint): Promise<void> => {
    setSending(true);
    setError(null);
    try {
      await register(cid);
      onSent();
    } catch (caught) {
      debugLog('P2PPeerList', 'Failed to send a connection request:', caught);
      // Shown, not only logged: debugLog is a no-op outside dev. The server's
      // own words where there are any.
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : 'Could not send the connection request. Try again, or use Find people.',
      );
    } finally {
      setSending(false);
    }
  };

  return { error, sending, request };
}
