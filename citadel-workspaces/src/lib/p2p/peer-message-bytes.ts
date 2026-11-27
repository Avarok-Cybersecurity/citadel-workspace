import { isByteArray } from '@/lib/utils/encoding-utils';

/**
 * The bytes inside a `PeerMessage`: the WASM client hands every byte field over as a Uint8Array,
 * whatever the agent's JSON carried. Anything else is not a message.
 */
export function peerMessageBytes(message: unknown): Uint8Array | null {
  return isByteArray(message) ? message : null;
}
