/**
 * The agent's LocalDB as the pause record's storage, and the one read of it.
 *
 * Kept apart from `index.ts` so auto-connect can consult a pause without
 * importing the store's wiring -- which imports auto-connect to reconnect.
 */
import { websocketService } from '@/lib/websocket-service';
import { readPauseStatus, type PauseStorage } from './pause-store';
import type { PauseStatus } from './pause-rules';

export const agentPauseStorage: PauseStorage = {
  get: (localCid: bigint, key: string): Promise<{ value: number[] } | null> =>
    websocketService.sendLocalDBGet(localCid, key),
  set: (localCid: bigint, key: string, value: number[]): Promise<void> =>
    websocketService.sendLocalDBSet(localCid, key, value),
  remove: (localCid: bigint, key: string): Promise<void> =>
    websocketService.sendLocalDBDelete(localCid, key),
};

export function pauseStatusOf(localCid: bigint, peerCid: bigint): Promise<PauseStatus> {
  return readPauseStatus(agentPauseStorage, localCid, peerCid);
}
