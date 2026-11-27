/**
 * The agent's LocalDB, faked because it is I/O behind a WebSocket: one keyspace per session
 * cid, as the SDK's backend keeps them, and the agent's ownership gate (citadel-internal-service
 * requests/mod.rs, ownership_gate_tests.rs): a connection may only name the sessions it owns.
 * A missing key answers as the agent does ("Key not found", KEY_NOT_FOUND).
 */
import type { LocalDbPort } from '../../chat-local-db';

export interface DbRequest {
  readonly op: 'get' | 'set';
  readonly cid: bigint;
  readonly key: string;
}

export class FakeAgentLocalDb {
  readonly requests: DbRequest[] = [];
  private readonly spaces: Map<bigint, Map<string, Uint8Array>> = new Map<bigint, Map<string, Uint8Array>>();
  /** Writes fail while set, as when the agent is unreachable. */
  failWrites: boolean = false;

  /** The LocalDB as one browser connection sees it: it owns the sessions in `owned`. */
  connection(owned: readonly bigint[]): LocalDbPort {
    const gate = (cid: bigint): Map<string, Uint8Array> => {
      if (!owned.includes(cid)) throw new Error(`Refused: session ${cid.toString()} is not this connection's`);
      const space: Map<string, Uint8Array> = this.spaces.get(cid) ?? new Map<string, Uint8Array>();
      this.spaces.set(cid, space);
      return space;
    };
    return {
      get: async (cid: bigint, key: string): Promise<{ readonly value: Uint8Array } | null> => {
        this.requests.push({ op: 'get', cid, key });
        const value: Uint8Array | undefined = gate(cid).get(key);
        if (value === undefined) throw new Error('Key not found');
        return { value: value.slice() };
      },
      set: async (cid: bigint, key: string, value: Uint8Array): Promise<void> => {
        this.requests.push({ op: 'set', cid, key });
        const space: Map<string, Uint8Array> = gate(cid);
        if (this.failWrites) throw new Error('LocalDB set failed');
        space.set(key, value.slice());
      },
    };
  }

  keys(cid: bigint): string[] {
    return [...(this.spaces.get(cid)?.keys() ?? [])];
  }
}
