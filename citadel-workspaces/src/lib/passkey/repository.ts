/**
 * Where sign-in hints live, behind a port.
 *
 * `PasskeyStore` is the I/O boundary (SBIO): production writes the agent's
 * CID-0 LocalDB, which any local process can read -- acceptable only because
 * every byte written through here is public metadata. Tests use an in-memory store.
 */
import type { Bytes } from './bytes';

export interface PasskeyStore {
  /** null when the key is genuinely absent; a failed read rejects. */
  get(key: string): Promise<Bytes | null>;
  set(key: string, value: Bytes): Promise<void>;
  delete(key: string): Promise<void>;
  listKeys(prefix: string): Promise<string[]>;
}
