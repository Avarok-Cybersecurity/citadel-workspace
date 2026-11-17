/**
 * One contact's pause state, for whichever surface is showing it.
 *
 * The row, the chat and its settings each hold one of these; they agree
 * because every change goes through the store, which tells every subscriber.
 * The local session is the one this tab acts as -- the same answer
 * auto-connect uses when it decides whether to dial.
 */
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { toastError } from '@/lib/toast-helpers';
import { getCurrentCid } from '@/lib/p2p/current-cid';
import { peerPauseStore, type PauseStatus, type PauseChange } from '@/lib/p2p-pause';
import { PAUSE_COPY } from '@/lib/p2p-pause/pause-copy';

/** `loading` until the first read lands. */
export type PauseView = PauseStatus | 'loading';

export interface PeerPauseBinding {
  status: PauseView;
  busy: boolean;
  pause: () => void;
  resume: () => void;
}

export function usePeerPause(peerCid: bigint): PeerPauseBinding {
  const { toast }: ReturnType<typeof useToast> = useToast();
  const [localCid, setLocalCid] = useState<bigint | null>(null);
  const [status, setStatus] = useState<PauseView>('loading');
  const [busy, setBusy] = useState<boolean>(false);

  useEffect(() => {
    let live: boolean = true;
    void (async (): Promise<void> => {
      const own: bigint | null = await getCurrentCid();
      if (!live) return;
      setLocalCid(own);
      // No session to key a pause by: say so rather than "not paused".
      const read: PauseStatus = own === null ? 'unknown' : await peerPauseStore.status(own, peerCid);
      if (live) setStatus(read);
    })();
    return (): void => { live = false; };
  }, [peerCid]);

  useEffect(() => {
    if (localCid === null) return undefined;
    return peerPauseStore.subscribe((change: PauseChange): void => {
      if (change.localCid === localCid && change.peerCid === peerCid) setStatus(change.status);
    });
  }, [localCid, peerCid]);

  const act: (kind: 'pause' | 'resume') => void = useCallback((kind: 'pause' | 'resume'): void => {
    if (localCid === null) return;
    setBusy(true);
    void (async (): Promise<void> => {
      try {
        await (kind === 'pause' ? peerPauseStore.pause(localCid, peerCid) : peerPauseStore.resume(localCid, peerCid));
      } catch (error: unknown) {
        toastError(toast, kind === 'pause' ? PAUSE_COPY.pauseFailed : PAUSE_COPY.resumeFailed,
          error instanceof Error ? error.message : String(error));
        setStatus(await peerPauseStore.status(localCid, peerCid));
      } finally {
        setBusy(false);
      }
    })();
  }, [localCid, peerCid, toast]);

  return {
    status,
    busy,
    pause: useCallback((): void => act('pause'), [act]),
    resume: useCallback((): void => act('resume'), [act]),
  };
}
