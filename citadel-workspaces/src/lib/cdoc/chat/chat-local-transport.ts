import type { ChatTransport } from './chat-ports';

/**
 * A scratchpad document's channel: nobody is at the other end (lib/scratchpad), so nothing it
 * writes leaves this device and nothing arrives. It is kept in this account's LocalDB like any
 * chat document, and is live only in the sense that each pause writes it back.
 */
export function localChatTransport(selfCid: bigint): ChatTransport {
  return {
    selfCid,
    peerCid: selfCid,
    send: async (): Promise<void> => undefined,
    onMessage: (): (() => void) => (): void => undefined,
    onConnected: (): (() => void) => (): void => undefined,
  };
}
