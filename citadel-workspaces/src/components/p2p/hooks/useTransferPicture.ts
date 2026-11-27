/**
 * A chat file's picture once it can be shown, null while loading, re-read as its transfer
 * changes (a received picture becomes readable when its download completes) and when `again` is
 * pressed (a decoder that failed to load gets a second try).
 */
import { useCallback, useEffect, useState } from 'react';
import { pictureCache } from '@/lib/received-files/picture-io';
import type { PictureLoad } from '@/lib/received-files/picture-load';
import type { FileTransfer } from '@/lib/file-transfer/types';

export interface TransferPicture {
  readonly load: PictureLoad | null;
  readonly again: () => Promise<void>;
}

interface Answered {
  readonly id: string | undefined;
  readonly attempt: number;
  readonly load: PictureLoad;
}

export function useTransferPicture(transfer: FileTransfer | undefined): TransferPicture {
  // Each answer is kept with the transfer and attempt it answers: the viewer moves between
  // pictures, and in the render before the next load starts, the last answer must not show.
  const [answered, setAnswered] = useState<Answered | null>(null);
  const [attempt, setAttempt] = useState<number>(0);
  const id: string | undefined = transfer?.id;
  const state: string | undefined = transfer?.state;
  useEffect((): (() => void) => {
    let live: boolean = true;
    const setLoad = (load: PictureLoad): void => { if (live) setAnswered({ id, attempt, load }); };
    if (!transfer) {
      setLoad({ unavailable: 'this device has no record of the file' });
      return (): void => { live = false; };
    }
    pictureCache.get(transfer).then(setLoad, (): void => setLoad({ unavailable: 'it could not be read' }));
    return (): void => { live = false; };
    // The transfer object is re-read each render; its id and state are what change the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, state, attempt]);
  const again: () => Promise<void> = useCallback(async (): Promise<void> => { setAttempt((n: number): number => n + 1); }, []);
  const current: PictureLoad | null = answered !== null && answered.id === id && answered.attempt === attempt ? answered.load : null;
  return { load: current, again };
}
