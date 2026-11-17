/**
 * A send-queue port for tests whose subject is the ordinary send: the peer is
 * known to be online, so nothing is held (see a-send-to-an-offline-peer-waits).
 * Keeping a send's bytes for a reload (keepForResume) is refused here, as a
 * browser whose storage refuses them would: those tests are about the send.
 */
import type { SendQueuePort } from '../send-queue-hold';

export const ONLINE_PEER_QUEUE: SendQueuePort = {
  peerOnlineStatus: (): boolean => true,
  peerName: (): string => 'Peer',
  hold: async (): Promise<boolean> => false,
  take: async (): Promise<undefined> => undefined,
  release: async (): Promise<void> => undefined,
};
