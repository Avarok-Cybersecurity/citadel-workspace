/**
 * Dropping files into the manager: the upload, and the quota it has to fit.
 *
 * Its own hook because the accounting is the subject. `storageUsed` comes from
 * the tree and the tree only grows once an upload has LANDED, so the room left
 * is not a number the tree can answer on its own — the uploads already in the
 * air have to be carried here. Reading that reasoning inside a file of ten
 * unrelated handlers is how it came to be missing.
 */
import { useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { describeError } from '@/lib/describe-error';
import { wouldExceedQuota } from '@/lib/revfs/quota-check';
import { TreeScope, type RevfsFileMetadata } from '@/types/revfs-types';
import { uploadRefusal } from './upload-refusal';
import { SERVER_STORAGE_CHECKING, type StorageOffer } from '@/lib/revfs/storage-offer';

export interface DropUploadDeps {
  myCid: bigint | null;
  /** Whether the open storage takes files; nothing is sent until it has said it does. */
  storageOffer: StorageOffer;
  storageMode: TreeScope;
  storageUsed: number;
  storageQuota: number;
  uploadFile: (
    targetPath: string,
    fileName: string,
    metadata: RevfsFileMetadata,
    content: Uint8Array,
  ) => Promise<boolean>;
  reportDelivery: (acknowledged: boolean, message: string) => void;
  setRevfsDisabledReason: (reason: 'server_disabled' | 'peer_disabled') => void;
  setRevfsDisabledModalOpen: (open: boolean) => void;
  setAttemptedFileSize: (size: number) => void;
  setStorageLimitModalOpen: (open: boolean) => void;
}

export function useDropUpload(
  deps: DropUploadDeps,
): (targetPath: string, files: FileList) => Promise<void> {
  /**
   * Bytes of uploads started and not yet reflected in the tree.
   *
   * A ref rather than state: it must be read by a callback that was created
   * before the value changed, which is exactly what a state snapshot cannot do —
   * and it is the reason the quota check was wrong in the first place.
   */
  const inFlightBytesRef: React.MutableRefObject<number> = useRef<number>(0);

  return useCallback(async (targetPath: string, files: FileList): Promise<void> => {
    if (!deps.myCid) { toast.error('Not connected'); return; }
    const refusal: string | null = uploadRefusal(targetPath);
    if (refusal) { toast.info(refusal); return; }
    if (deps.storageOffer.kind === 'checking') { toast.info(SERVER_STORAGE_CHECKING); return; }
    if (deps.storageOffer.kind === 'refused') {
      deps.setRevfsDisabledReason(deps.storageMode === TreeScope.Server ? 'server_disabled' : 'peer_disabled');
      deps.setRevfsDisabledModalOpen(true);
      return;
    }
    const fileArray: File[] = Array.from(files);
    const totalSize: number = fileArray.reduce((sum, file) => sum + file.size, 0);
    // Counting what is already in the air. `deps.storageUsed` comes from the tree,
    // and the tree only grows once an upload has LANDED, so a second drop
    // started before the first one's write completes was measured against a
    // total that did not include it -- two 60% drops both passing a check
    // against an 80% quota. See lib/revfs/quota-check.
    if (wouldExceedQuota({
      used: deps.storageUsed,
      quota: deps.storageQuota,
      inFlight: inFlightBytesRef.current,
      incoming: totalSize,
    })) {
      deps.setAttemptedFileSize(totalSize);
      deps.setStorageLimitModalOpen(true);
      return;
    }
    // Reserved for the whole batch before any of it starts, and released in
    // `finally` so a throw cannot leak the reservation and shrink the quota for
    // the rest of the session.
    inFlightBytesRef.current += totalSize;
    try {
    for (const file of fileArray) {
      // Between the drop and the acknowledgement nothing on screen changed, so a large file read as a
      // drop that did nothing. The progress toast is replaced by the outcome's own toast.
      const progress: string | number = toast.loading(`Uploading ${file.name}…`);
      try {
        // The file's CONTENTS, which this never read. Only name, size and type
        // were passed on, so the upload described a file whose bytes never left
        // the page — and the toast below still said "Uploaded".
        const content: Uint8Array<ArrayBuffer> = new Uint8Array(await file.arrayBuffer());
        const acknowledged: boolean = await deps.uploadFile(
          targetPath,
          file.name,
          {
            fileId: crypto.randomUUID(), fileName: file.name, fileSize: file.size,
            fileType: file.type || 'application/octet-stream',
            virtualDirectory: targetPath, uploadedByCid: deps.myCid,
          },
          content,
        );
        deps.reportDelivery(acknowledged, `Uploaded: ${file.name}`);
      } catch (err) {
        toast.error(`Failed to upload ${file.name}: ${describeError(err)}`);
      } finally {
        toast.dismiss(progress);
      }
    }
    } finally {
      inFlightBytesRef.current -= totalSize;
    }
  }, [deps]);
}
