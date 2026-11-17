/**
 * Why a folder cannot take an upload, or null when it can.
 *
 * One answer for the two places that need it: the upload path, which refuses,
 * and the toolbar, which says so before the user has picked a file rather than
 * after. Written out at each, the button would stay live over a folder the
 * upload then turned away.
 */
import { SENT_FILES_DIR } from '@/types/revfs-types';
import { SERVER_STORAGE_CHECKING, type StorageOffer } from '@/lib/revfs/storage-offer';

export function uploadRefusal(targetPath: string): string | null {
  const isStandardTransfer: boolean =
    targetPath === SENT_FILES_DIR || targetPath.startsWith(SENT_FILES_DIR + '/');
  return isStandardTransfer
    ? 'Sent Files lists what you sent in chat. Use P2P Chat to send files directly.'
    : null;
}

/** What an upload control shows over a folder of a storage. */
export type UploadAvailability =
  | { readonly kind: 'offered' }
  /** The storage takes files and this folder does not: the control stays, disabled, saying why. */
  | { readonly kind: 'disabled'; readonly reason: string }
  /** The storage takes none, or has not said yet: no control at all, only why. */
  | { readonly kind: 'absent'; readonly reason: string };

export function uploadAvailability(targetPath: string, offer: StorageOffer): UploadAvailability {
  if (offer.kind === 'checking') return { kind: 'absent', reason: SERVER_STORAGE_CHECKING };
  if (offer.kind === 'refused') return { kind: 'absent', reason: offer.reason };
  const refusal: string | null = uploadRefusal(targetPath);
  return refusal === null ? { kind: 'offered' } : { kind: 'disabled', reason: refusal };
}
