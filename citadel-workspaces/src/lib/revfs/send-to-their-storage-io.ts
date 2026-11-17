/** The I/O behind "Send to their storage": this tab's session and the RE-VFS engine. */
import { getSelectedUser, type TabUserContext } from '@/lib/tab-context';
import { revfsService } from './revfs-service';
import { sendToTheirStorage } from './send-to-their-storage';

export function sendToTheirStorageNow(peerCid: bigint, file: File): Promise<boolean> {
  return sendToTheirStorage({
    currentCid: async (): Promise<bigint | null> => {
      const selection: TabUserContext | null = await getSelectedUser();
      return selection?.selectedCid ?? null;
    },
    newFileId: (): string => crypto.randomUUID(),
    upload: (myCid, peer, dir, name, meta, content): Promise<boolean> =>
      revfsService.uploadFileToPeer(myCid, peer, dir, name, meta, content),
  }, peerCid, file);
}
