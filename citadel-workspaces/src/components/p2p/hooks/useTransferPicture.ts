/**
 * A chat file's picture once it can be shown, null while loading, re-read as its transfer
 * changes (a received picture becomes readable when its download completes).
 */
import { useEffect, useState } from 'react';
import { pictureCache } from '@/lib/received-files/picture-io';
import type { PictureLoad } from '@/lib/received-files/picture-load';
import type { FileTransfer } from '@/lib/file-transfer/types';

export function useTransferPicture(transfer: FileTransfer | undefined): PictureLoad | null {
  // Each answer is kept with the transfer it answers: the viewer moves between pictures, and in the
  // render before the next one's load starts, the last one's picture must not show under its name.
  const [answered, setAnswered] = useState<{ readonly id: string | undefined; readonly load: PictureLoad } | null>(null);
  const id: string | undefined = transfer?.id;
  const state: string | undefined = transfer?.state;
  useEffect((): (() => void) => {
    let live: boolean = true;
    const setLoad = (load: PictureLoad): void => setAnswered({ id, load });
    if (!transfer) {
      setLoad({ unavailable: 'this device has no record of the file' });
      return (): void => { live = false; };
    }
    const pending: Promise<void> = pictureCache.get(transfer).then((done: PictureLoad): void => { if (live) setLoad(done); });
    void pending;
    return (): void => { live = false; };
    // The transfer object is re-read each render; its id and state are what change the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, state]);
  return answered !== null && answered.id === id ? answered.load : null;
}
