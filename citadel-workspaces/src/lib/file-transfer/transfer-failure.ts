/**
 * What a person is told when a file transfer's tick stream ends in failure. Pure.
 *
 * The SDK ends a transfer in one of two failure statuses: `Fail(message)`, text only, and
 * `Failed { code, message }`, which carries the `citadel_io::ErrorCode` that ended it so a
 * reader tells failures apart by code rather than by text. Both are terminal: neither is ever
 * progress, and a reader that does not recognise one must not keep waiting on it.
 */
import type { ObjectTransferStatus } from './protocol-types';

/**
 * `ErrorCode::FileTransferStalled` (citadel_io): the other side stopped answering one of the
 * transfer's groups, so the SDK ended it — at the sender, a group header unanswered past its
 * deadline or acks that stopped; at the receiver, a group whose packets stopped. From the SDK pin
 * that introduces the code (b3d440db) on, the kernel test
 * citadel-workspace-server-kernel/tests/the_sdk_ends_a_stalled_transfer_before_the_page_gives_up.rs
 * holds this number to the SDK's.
 */
export const FILE_TRANSFER_STALLED_CODE: number = 666;

/**
 * Said at either end of a stalled transfer: from the sender's side the receiver stopped
 * answering, from the receiver's the sender stopped sending, and to each of them that is the
 * other side going quiet.
 */
export const STALLED_TRANSFER_COPY: string =
  'The other side stopped answering, so the transfer was ended. Try again once they are back.';

/** Said for a failure that came with no words of its own. */
export const UNEXPLAINED_TRANSFER_FAILURE: string = 'The transfer failed.';

/**
 * Why `status` ended the transfer, or null when `status` is not a failure. The SDK's own
 * message is used for a code this page has no words for.
 */
export function transferFailureReason(status: ObjectTransferStatus | Record<string, unknown> | string | null | undefined): string | null {
  if (status === 'Fail') return UNEXPLAINED_TRANSFER_FAILURE;
  if (status === null || status === undefined || typeof status !== 'object') return null;
  if ('Failed' in status) {
    const failed: unknown = status.Failed;
    const code: unknown = typeof failed === 'object' && failed !== null ? (failed as { code?: unknown }).code : undefined;
    const message: unknown = typeof failed === 'object' && failed !== null ? (failed as { message?: unknown }).message : undefined;
    if (code === FILE_TRANSFER_STALLED_CODE) return STALLED_TRANSFER_COPY;
    return typeof message === 'string' && message !== '' ? message : UNEXPLAINED_TRANSFER_FAILURE;
  }
  if ('Fail' in status) {
    const said: unknown = status.Fail;
    return typeof said === 'string' && said !== '' ? said : UNEXPLAINED_TRANSFER_FAILURE;
  }
  return null;
}
