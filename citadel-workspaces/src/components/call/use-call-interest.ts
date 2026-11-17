/**
 * While a call is on, tells a supervising agent its peers are wanted.
 *
 * A call needs the live link, so the agent keeps it healed (and its UDP path
 * restored) for as long as someone is in the call. Ringing counts: the call
 * cannot start without the link either.
 */
import { useEffect } from 'react';
import type { CallState } from '@/lib/call/call-state';

function peersOf(call: CallState | null, selfCid: bigint | null): bigint[] {
  if (call === null || call.status === 'ended' || call.status === 'failed') return [];
  return [...call.participants.keys()].filter((cid: bigint): boolean => cid !== selfCid && cid >= 0n);
}

export function useCallInterest(selfCid: bigint | null, call: CallState | null): void {
  const peers: bigint[] = peersOf(call, selfCid);
  const key: string = peers.map((cid: bigint): string => cid.toString()).join(',');
  useEffect(() => {
    if (selfCid === null || key === '') return undefined;
    // Loaded now, not at start-up: the landing path never needs it, and most calls are not supervised.
    let ended: boolean = false;
    const releases: Array<() => void> = [];
    void import('@/lib/agent-supervisor/interest').then(({ holdInterest }): void => {
      if (ended) return;
      for (const cid of key.split(',')) releases.push(holdInterest(selfCid, BigInt(cid)));
    });
    return (): void => { ended = true; for (const release of releases) release(); };
  }, [selfCid, key]);
}
