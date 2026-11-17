/**
 * Pulling a file back out of the encrypted virtual filesystem.
 *
 * Separate from the send/delete pair because a REVFS pull's completion signal
 * is a different event stream — ticks, not a status notification — and the
 * reasoning about which variants are terminal belongs beside the code that
 * reads them.
 */

import type { RevfsIntentResult } from '@/types/revfs-intents';
import { BACKEND_TIMEOUT_MS, type NetworkIODeps } from './revfs-io-network';
import { debugLog } from '@/lib/debug-config';
import { awaitPullCompletion, type PullOutcome } from '../websocket/pull-completion';

export async function backendDownloadFile(
  deps: NetworkIODeps,
  cid: bigint,
  peerCid: bigint | null,
  virtualDir: string,
): Promise<RevfsIntentResult> {
  const requestId: string = crypto.randomUUID();
  const isServerStorage: boolean = peerCid === null;
  debugLog('RevfsIO', `backendDownloadFile: virtualDir=${virtualDir} requestId=${requestId} scope=${isServerStorage ? 'server' : 'peer'}`);

  const request: { DownloadFile: { request_id: string; virtual_directory: string; cid: bigint; peer_cid: bigint | null; security_level: string; delete_on_pull: boolean; }; } = {
    DownloadFile: {
      request_id: requestId,
      virtual_directory: virtualDir,
      cid,
      peer_cid: peerCid,
      security_level: 'Standard',
      delete_on_pull: false,
    },
  };

  // Correlation and terminal-variant reasoning live in `awaitPullCompletion`,
  // shared with the async file-transfer pull. They were duplicated, this copy
  // was fixed, the other was not, and the other went on timing out on every
  // download for as long as the duplication lasted.
  const pull: Promise<PullOutcome> = awaitPullCompletion(requestId, BACKEND_TIMEOUT_MS, 'RevfsIO');

  try {
    await deps.sendInternalServiceRequest(request);
  } catch (error: unknown) {
    debugLog('RevfsIO', 'backendDownloadFile request error:', error);
    return { type: 'backend-download-file', success: false };
  }

  const outcome: PullOutcome = await pull;
  return {
    type: 'backend-download-file',
    success: outcome.success,
    downloadPath: outcome.downloadPath,
  };
}

/**
 * Delete a file via the Citadel protocol.
 */