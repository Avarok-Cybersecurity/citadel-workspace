/** Opening the recipient's P2P channel before any file send; used by every send path. */
import { debugLog } from '@/lib/debug-config';
import type { LifecycleDeps } from './transfer-lifecycle';

/**
 * Every send's first network act is a P2P message to the recipient (the offer
 * announcement), and the protocol's SendFile names them as its peer. Neither
 * opens a channel. A text message does -- MessageSender kicks
 * p2pAutoConnectService before sending -- so after an agent reconnect or a
 * server restart a DM went through while a file to the same peer failed with
 * "No messaging handle found" ("Peer Connection Not Found" in the DM dialog,
 * "failed" in a group share), until something else happened to reopen it.
 *
 * Not opening in time is reported, not thrown: the caller decides whether to
 * send anyway or hold the send for the peer (send-queue.ts).
 */
export async function openChannelBeforeSending(deps: Pick<LifecycleDeps, 'openPeerChannel'>, recipientCid: string): Promise<boolean> {
  const opened: boolean = await deps.openPeerChannel(BigInt(recipientCid));
  if (!opened) debugLog('TransferLifecycle', 'P2P channel not confirmed open', { recipientCid });
  return opened;
}

/**
 * Long enough for a fresh P2P handshake after a reconnect, short enough that a
 * group share to several unreachable members does not stall for minutes: the
 * fan-out sends one member at a time.
 */
export const FILE_SEND_CONNECT_TIMEOUT_MS: number = 15_000;

/**
 * The production `openPeerChannel`: the same auto-connect service the message
 * path uses. Imported lazily because that service reaches most of the P2P
 * layer, and this module sits under the file-transfer service it loads.
 */
export async function openPeerChannelViaAutoConnect(peerCid: bigint): Promise<boolean> {
  const { p2pAutoConnectService } = await import('../p2p-auto-connect-service');
  return p2pAutoConnectService.waitForPeerConnected(peerCid, FILE_SEND_CONNECT_TIMEOUT_MS);
}
