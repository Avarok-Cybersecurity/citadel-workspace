/**
 * P2P message dispatch: building and sending the
 * `InternalServiceRequest::Message` envelope.
 *
 * Owns CID-pair validation and the string-vs-bytes convergence onto the wire's
 * `Vec<u8>` representation. Split from p2p-operations.ts so that module keeps
 * the connection-lifecycle handshakes (connect/accept/disconnect) while the
 * send path lives here.
 */

import { debugLog } from '../debug-config';
import { stringToBytes } from '../utils/encoding-utils';
import type { P2PConfig } from './p2p-operations';
import { markBackgroundSend, type SendDelivery } from '../p2p/send-failure';

/**
 * Common send path for both string- and bytes-shaped P2P message APIs.
 * Validates the CID pair, builds the `InternalServiceRequest::Message`
 * envelope, and dispatches via `config.sendMessage`. The wire `message`
 * field is `Vec<u8>` on the Rust side — `number[]` is the JSON-friendly
 * representation both branches converge on.
 */
async function dispatchP2PMessage(
  config: P2PConfig, cid: bigint, targetCid: bigint, messageBytes: number[], callerLabel: string, delivery: SendDelivery
): Promise<void> {
  await config.init();
  if (cid === undefined || cid === null) {
    throw new Error('CID is required to send P2P message');
  }
  if (targetCid === undefined || targetCid === null) {
    throw new Error('Target CID (peer_cid) is required to send P2P message');
  }

  const messageRequest: { Message: { request_id: `${string}-${string}-${string}-${string}-${string}`; message: number[]; cid: bigint; peer_cid: bigint; security_level: string; }; } = {
    Message: {
      request_id: crypto.randomUUID(),
      message: messageBytes,
      cid: cid,
      peer_cid: targetCid,
      security_level: 'Standard'
    }
  };

  if (delivery === 'background') markBackgroundSend(messageRequest.Message.request_id);

  debugLog('P2POperations', `[P2P] ${callerLabel}`, {
    cid: cid.toString(), targetCid: targetCid.toString(), messageLength: messageBytes.length,
  });

  await config.sendMessage(messageRequest);
}

/**
 * Send a P2P message to a peer.
 */
export async function sendP2PMessage(config: P2PConfig, cid: bigint, targetCid: bigint, message: string): Promise<void> {
  return dispatchP2PMessage(config, cid, targetCid, stringToBytes(message), 'sendP2PMessage', 'user');
}

/**
 * Send raw bytes over the P2P channel. Mirrors `sendP2PMessage` but skips
 * the UTF-8 reinterpretation step — callers (e.g. the Yjs provider, which
 * CBOR-encodes its messages) already have bytes and would otherwise lose
 * data when `stringToBytes` round-trips them through `TextEncoder`.
 */
export async function sendP2PMessageBytes(config: P2PConfig, cid: bigint, targetCid: bigint, message: Uint8Array, delivery: SendDelivery): Promise<void> {
  return dispatchP2PMessage(config, cid, targetCid, Array.from(message), 'sendP2PMessageBytes', delivery);
}
