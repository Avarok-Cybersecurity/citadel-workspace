/**
 * A chat file's picture once it can be shown, null while loading, re-read as its transfer
 * changes (a received picture becomes readable when its download completes).
 */
import { useEffect, useState } from 'react';
import { pictureCache } from '@/lib/received-files/picture-io';
import type { PictureLoad } from '@/lib/received-files/picture-load';
import type { FileTransfer } from '@/lib/file-transfer/types';

export function useTransferPicture(transfer: FileTransfer | undefined): PictureLoad | null {
  const [load, setLoad] = useState<PictureLoad | null>(null);
  const id: string | undefined = transfer?.id;
  const state: string | undefined = transfer?.state;
  useEffect((): (() => void) => {
    let live: boolean = true;
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
  return load;
}
