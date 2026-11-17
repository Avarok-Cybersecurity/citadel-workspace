/**
 * The agent's LocalDB, in memory: the only fake in the migration's tests.
 *
 * Why a fake: LocalDB is the Citadel agent's key-value store, reached over the agent's
 * WebSocket; there is no in-process agent to run under vitest. Everything above it (the
 * original reads in live-document-store/stored-reads.ts, the account store, the runner, the
 * walker, yjs, cbor-x) is the production code. The fake keeps the agent's observable contract:
 * values are byte arrays per (cid, key), and an absent key REJECTS with the agent's
 * "Key not found" (which isGenuinelyAbsent classifies), exactly as `sendLocalDBGet` does.
 *
 * It records every call, so a test can assert which cids were written, and it can be told to
 * fail a chosen call, which is how a timeout or a crash between two writes is injected.
 */
import type { MigrationLocalDb } from '../account-store';

export type DbOp = 'get' | 'set';

export interface DbCall {
  readonly op: DbOp;
  readonly cid: bigint;
  readonly key: string;
}

type FailRule = (call: DbCall) => Error | null;

export class FakeLocalDb implements MigrationLocalDb {
  readonly calls: DbCall[] = [];
  private readonly values: Map<string, number[]> = new Map();
  private rules: FailRule[] = [];

  private static slot(cid: bigint, key: string): string {
    return `${cid.toString()}\u0000${key}`;
  }

  /** Seeds a value as if an earlier session had stored it (not recorded as a call). */
  seed(cid: bigint, key: string, value: number[]): void {
    this.values.set(FakeLocalDb.slot(cid, key), [...value]);
  }

  peek(cid: bigint, key: string): number[] | undefined {
    const value: number[] | undefined = this.values.get(FakeLocalDb.slot(cid, key));
    return value === undefined ? undefined : [...value];
  }

  /** Every stored (cid, key) -> bytes, for byte-identical comparisons. */
  dump(cid: bigint): Map<string, string> {
    const out: Map<string, string> = new Map();
    const prefix: string = `${cid.toString()}\u0000`;
    for (const [slot, value] of this.values) if (slot.startsWith(prefix)) out.set(slot.slice(prefix.length), JSON.stringify(value));
    return out;
  }

  /** Fails every call `rule` answers an error for, until `clearFailures`. */
  failWhen(rule: FailRule): void {
    this.rules.push(rule);
  }

  /** Fails the first call matching `op` and `key`, once. */
  failOnce(op: DbOp, key: string, error: Error): void {
    let spent: boolean = false;
    this.rules.push((call: DbCall): Error | null => {
      if (spent || call.op !== op || call.key !== key) return null;
      spent = true;
      return error;
    });
  }

  clearFailures(): void {
    this.rules = [];
  }

  private check(call: DbCall): void {
    this.calls.push(call);
    for (const rule of this.rules) {
      const error: Error | null = rule(call);
      if (error) throw error;
    }
  }

  sendLocalDBGet(cid: bigint, key: string): Promise<{ value: number[] } | null> {
    return Promise.resolve().then((): { value: number[] } => {
      this.check({ op: 'get', cid, key });
      const value: number[] | undefined = this.values.get(FakeLocalDb.slot(cid, key));
      if (value === undefined) throw new Error(`Key not found: ${key}`);
      return { value: [...value] };
    });
  }

  sendLocalDBSet(cid: bigint, key: string, value: number[]): Promise<void> {
    return Promise.resolve().then((): void => {
      this.check({ op: 'set', cid, key });
      this.values.set(FakeLocalDb.slot(cid, key), [...value]);
    });
  }
}

/** The agent's answer to a LocalDB request that never came back. */
export const timedOut = (): Error => new Error('LocalDB request timed out after 5000ms');
