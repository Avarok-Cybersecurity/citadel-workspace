/**
 * The production PasskeyStore: the agent's CID-0 LocalDB.
 *
 * CID 0 is readable and writable without a session, which is what lets the
 * sign-in form find an account's keys before anyone is signed in -- and is why
 * only ciphertext and public metadata may ever be written here.
 */
// Namespace import, as connection/io-websocket.ts does, to stay out of the
// websocket-service import cycle.
import * as wsModule from '../websocket-service';
import { isGenuinelyAbsent } from '@/lib/storage/absence';
import { type Bytes, copyBytes } from './bytes';
import type { PasskeyStore } from './repository';

const GLOBAL_CID: 0n = 0n;

export const agentPasskeyStore: PasskeyStore = {
  async get(key: string): Promise<Bytes | null> {
    try {
      const result: { value: number[] } | null = await wsModule.websocketService.sendLocalDBGet(GLOBAL_CID, key);
      return result?.value ? copyBytes(Uint8Array.from(result.value)) : null;
    } catch (error) {
      if (isGenuinelyAbsent(error)) return null;
      throw error;
    }
  },
  async set(key: string, value: Bytes): Promise<void> {
    await wsModule.websocketService.sendLocalDBSet(GLOBAL_CID, key, Array.from(value));
  },
  async delete(key: string): Promise<void> {
    await wsModule.websocketService.sendLocalDBDelete(GLOBAL_CID, key);
  },
  async listKeys(prefix: string): Promise<string[]> {
    try {
      return await wsModule.websocketService.sendLocalDBListKeys(GLOBAL_CID, prefix);
    } catch (error) {
      if (isGenuinelyAbsent(error)) return [];
      throw error;
    }
  },
};
