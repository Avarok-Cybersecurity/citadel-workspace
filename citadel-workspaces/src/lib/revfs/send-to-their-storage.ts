/**
 * "Send to their storage": put a file in the shared storage you have with a peer.
 *
 * Not a way of sending. A send delivers a file to the peer over the Citadel
 * protocol; this places one in the peer-pair RE-VFS tree (the File Manager's
 * shared storage), where its bytes are kept on the peer's agent encrypted for
 * you. They open it by asking you for it, so you must be online then.
 *
 * The bytes travel inline (ByteContents), so this route has its own ceiling.
 */
import { MAX_BYTE_CONTENTS_BYTES } from '@/lib/file-transfer/server-upload';
import { formatBytes } from '@/lib/format-bytes';
import type { RevfsFileMetadata } from '@/types/revfs-types';

/** Where in the shared tree the file goes. */
export const SHARED_STORAGE_DIR: string = '/';

/** The largest file this route can carry, the agent's inline-payload cap. */
export const SHARED_STORAGE_LIMIT_BYTES: number = MAX_BYTE_CONTENTS_BYTES;

/** Why `file` cannot go to shared storage, or null when it can. */
export function sharedStorageRefusal(file: Pick<File, 'name' | 'size'>): string | null {
  if (file.size === 0) return `"${file.name}" is empty, so there is nothing to store.`;
  if (file.size > SHARED_STORAGE_LIMIT_BYTES) {
    return `Shared storage holds files up to ${formatBytes(SHARED_STORAGE_LIMIT_BYTES)}; ` +
      `"${file.name}" is ${formatBytes(file.size)}. Send it instead.`;
  }
  return null;
}

export interface SharedStoragePorts {
  currentCid: () => Promise<bigint | null>;
  newFileId: () => string;
  upload: (myCid: bigint, peerCid: bigint, dir: string, name: string, meta: RevfsFileMetadata, content: Uint8Array) => Promise<boolean>;
}

/**
 * Place `file` at the root of the storage shared with `peerCid`. Resolves true
 * once the peer acknowledged it; throws with the reason when it cannot be done.
 */
export async function sendToTheirStorage(ports: SharedStoragePorts, peerCid: bigint, file: File): Promise<boolean> {
  const refusal: string | null = sharedStorageRefusal(file);
  if (refusal !== null) throw new Error(refusal);
  const myCid: bigint | null = await ports.currentCid();
  if (myCid === null) throw new Error('No active session to store this file from.');
  const meta: RevfsFileMetadata = {
    fileId: ports.newFileId(),
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type || 'application/octet-stream',
    virtualDirectory: SHARED_STORAGE_DIR,
    uploadedByCid: myCid,
  };
  const content: Uint8Array = new Uint8Array(await file.arrayBuffer());
  return ports.upload(myCid, peerCid, SHARED_STORAGE_DIR, file.name, meta, content);
}
