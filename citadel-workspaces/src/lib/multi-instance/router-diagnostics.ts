/**
 * Diagnostics for the multi-tab inbound router.
 *
 * Kept out of the router itself because these lines exist to answer one
 * specific question — where a message that ILM reported as delivered stops
 * being visible — and that question is not part of the routing rules.
 */

import { debugLog, debugEnabled } from '@/lib/debug-config';
import { describeForwarded } from '@/lib/p2p/message-fingerprint';
import { holdUntilP2PHandlerAttached } from '@/lib/p2p/p2p-handler-ready';
import { arrivesAtFrameRate, getMessageType } from './routing-rules';

/**
 * Record an emit and how many handlers were actually listening.
 *
 * A message emitted with no subscriber vanishes silently: no error, no trace,
 * indistinguishable from never having arrived. The router's own receiver
 * attaches at module load, but the P2P messenger subscribes to
 * 'websocket-message' only when it is constructed later in app init — so a
 * message forwarded into a still-booting tab lands in exactly that window.
 *
 * Tagged [ILM-Router] so the integration harness's keyword filter keeps it, and
 * fingerprinted so it joins to the sending tab's `forward ->` line.
 */
export function logEmit(listeners: number, message: unknown): void {
  // Guarded as one block. `describeForwarded` copies the payload into a
  // Uint8Array and hashes it with three BigInt operations per byte, and this
  // runs for EVERY message processed locally -- the leader's own, every
  // broadcast, and every forward -- in every tab. At the 16 MiB inline
  // transfer cap that is close to a second of main-thread time per tab, for a
  // logger production compiles away.
  if (!debugEnabled) return;
  if (arrivesAtFrameRate(getMessageType(message))) return;

  if (listeners === 0) {
    debugLog(
      'InstanceInboundRouter',
      `[ILM-Router] emit with NO listeners ${describeForwarded(message)} — message is lost here`,
    );
    return;
  }
  debugLog(
    'InstanceInboundRouter',
    `[ILM-Router] emit listeners=${listeners} ${describeForwarded(message)}`,
  );
}

/**
 * Whether this message must wait for the P2P handler before being emitted.
 *
 * Only MessageNotification is held. Everything else — LocalDB responses,
 * session lists, workspace replies — has subscribers that attach at module
 * load, so holding those would delay traffic that already had a receiver.
 *
 * The listener count cannot make this decision: it counts the services that
 * are always subscribed, so it is nonzero exactly when this is most wrong.
 */
export function mustHoldForP2PHandler(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false;
  if (!('MessageNotification' in (message as Record<string, unknown>))) return false;
  return holdUntilP2PHandlerAttached(message);
}
