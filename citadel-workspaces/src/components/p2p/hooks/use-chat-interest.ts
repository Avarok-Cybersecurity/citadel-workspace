/** While a chat is open, tells a supervising agent its peer is wanted (lib/agent-supervisor/interest). */
import { useEffect } from 'react';
import { holdInterest } from '@/lib/agent-supervisor/interest';

export function useChatInterest(sessionCid: bigint | null, peerCid: bigint | null): void {
  useEffect(() => {
    if (sessionCid === null || peerCid === null) return undefined;
    return holdInterest(sessionCid, peerCid);
  }, [sessionCid, peerCid]);
}
