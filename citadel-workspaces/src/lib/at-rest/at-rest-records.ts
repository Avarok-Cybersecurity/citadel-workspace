/**
 * Sealing and opening an account's device records, and turning the setting on and off: the
 * part of encryption at rest the device-records seam (lib/document-replica-cache.ts) loads when
 * a sealed record is read or the setting is on.
 *
 * Turning it on or off converts the records in place, each by one compare-and-put, so a crash
 * leaves every record whole: sealed, or not yet. The setting is written first, marked
 * `converting`, and cleared only once every record is in its shape; a conversion cut short is
 * finished on the next open (the seam's resumeOnce). Reads accept both shapes meanwhile.
 *
 * The record key lives in memory only, derived per account from the root the agent keeps
 * (through root-store-port.ts); the root's bytes are cleared once the key is derived.
 */
import { dbGet, dbKeysWithPrefix, dbPut, dbReplaceIf } from '@/lib/storage-utils';
import { accountRecordsPrefix, atRestModeKey, recordPlace } from '@/lib/document-replica-cache';
import { atRestRootStore, type AtRestRootStore } from './root-store-port';
import { AT_REST_REFUSED_LOCKED, AT_REST_REFUSED_UNREACHABLE } from './at-rest-copy';
import { AtRestRefusedError, RecordLockedError, isAtRestEnvelope, readAtRestMode, type AtRestEnvelope, type AtRestMode } from './at-rest-shape';
import { SealedRecordError, deriveRecordKey, newRoot, openValue, recordAad, sameValue, sealValue } from './record-crypto';

const keys: Map<bigint, CryptoKey> = new Map<bigint, CryptoKey>();

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.byteLength === b.byteLength && a.every((byte: number, i: number): boolean => byte === b[i]);

function aadOf(key: string): Uint8Array<ArrayBuffer> {
  const { account, node, kind } = recordPlace(key);
  return recordAad(account, node, kind);
}

/** The account's record key; with `make`, a root is made and kept by the agent when none is. */
async function keyFor(account: bigint, make: boolean): Promise<CryptoKey | null> {
  const known: CryptoKey | undefined = keys.get(account);
  if (known) return known;
  const store: AtRestRootStore = await atRestRootStore();
  let root: Uint8Array | null = await store.read(account);
  if (root === null) {
    if (!make) return null;
    root = newRoot();
    await store.write(account, root);
    // Kept only once the agent hands the same bytes back: a write lost on the way is no root.
    const kept: Uint8Array | null = await store.read(account);
    if (kept === null || !sameBytes(kept, root)) throw new Error('the agent did not keep the encryption root');
  }
  try {
    const key: CryptoKey = await deriveRecordKey(root, account);
    keys.set(account, key);
    return key;
  } finally {
    root.fill(0);
  }
}

/** A key for reading, or null when none can be had here now: the record then reads as locked. */
async function readingKey(account: bigint): Promise<CryptoKey | null> {
  try {
    return await keyFor(account, false);
  } catch (error: unknown) {
    console.warn('[at-rest] No key for this account\'s records on this device:', error);
    return null;
  }
}

export async function sealRecord(key: string, value: unknown): Promise<AtRestEnvelope> {
  let recordKey: CryptoKey | null;
  try {
    recordKey = await keyFor(recordPlace(key).account, true);
  } catch (error: unknown) {
    console.warn('[at-rest] A record could not be sealed on this device:', error);
    recordKey = null;
  }
  if (recordKey === null) throw new RecordLockedError(key);
  return sealValue(recordKey, aadOf(key), value);
}

export async function openRecord(key: string, envelope: AtRestEnvelope): Promise<unknown> {
  const recordKey: CryptoKey | null = await readingKey(recordPlace(key).account);
  if (recordKey === null) throw new RecordLockedError(key);
  try {
    return await openValue(recordKey, aadOf(key), envelope);
  } catch (error: unknown) {
    if (error instanceof SealedRecordError) throw new RecordLockedError(key);
    throw error;
  }
}

const writeMode = (account: bigint, mode: AtRestMode): Promise<void> => dbPut('keyValue', atRestModeKey(account), { on: mode.on, converting: mode.converting });

async function recordKeys(account: bigint): Promise<string[]> {
  const mode: string = atRestModeKey(account);
  return (await dbKeysWithPrefix('keyValue', accountRecordsPrefix(account))).filter((key: string): boolean => key !== mode);
}

/**
 * Puts every record in the setting's shape; false when some could not be (opened without a
 * key) or changed under the sweep, so the conversion stays marked and the next open looks again.
 */
async function convert(account: bigint, on: boolean, recordKey: CryptoKey | null): Promise<boolean> {
  let complete: boolean = true;
  for (const key of await recordKeys(account)) {
    const stored: unknown = await dbGet<unknown>('keyValue', key);
    if (stored === undefined || isAtRestEnvelope(stored) === on) continue;
    if (recordKey === null) { complete = false; continue; }
    if (on) {
      const sealed: AtRestEnvelope = await sealValue(recordKey, aadOf(key), stored);
      if (!(await dbReplaceIf('keyValue', key, (now: unknown): boolean => now !== undefined && !isAtRestEnvelope(now) && sameValue(now, stored), sealed))) complete = false;
      continue;
    }
    const envelope: AtRestEnvelope = stored as AtRestEnvelope;
    let plain: unknown;
    try {
      plain = await openValue(recordKey, aadOf(key), envelope);
    } catch (error: unknown) {
      if (!(error instanceof SealedRecordError)) throw error;
      complete = false;
      continue;
    }
    if (!(await dbReplaceIf('keyValue', key, (now: unknown): boolean => isAtRestEnvelope(now) && sameBytes(now.iv, envelope.iv), plain))) complete = false;
  }
  return complete;
}

/** On: refused, with nothing changed, unless the agent keeps (or already kept) a root. */
export async function turnOn(account: bigint): Promise<void> {
  let recordKey: CryptoKey | null;
  try {
    recordKey = await keyFor(account, true);
  } catch (error: unknown) {
    console.warn('[at-rest] Turning encryption on was refused:', error);
    throw new AtRestRefusedError(AT_REST_REFUSED_UNREACHABLE);
  }
  await writeMode(account, { on: true, converting: true });
  if (await convert(account, true, recordKey)) await writeMode(account, { on: true, converting: false });
}

/** Off: refused, with nothing changed, while any sealed record cannot be opened here. */
export async function turnOff(account: bigint): Promise<void> {
  const recordKey: CryptoKey | null = await readingKey(account);
  for (const key of await recordKeys(account)) {
    const stored: unknown = await dbGet<unknown>('keyValue', key);
    if (!isAtRestEnvelope(stored)) continue;
    if (recordKey === null) throw new AtRestRefusedError(AT_REST_REFUSED_LOCKED);
    try {
      await openValue(recordKey, aadOf(key), stored);
    } catch (error: unknown) {
      if (error instanceof SealedRecordError) throw new AtRestRefusedError(AT_REST_REFUSED_LOCKED);
      throw error;
    }
  }
  await writeMode(account, { on: false, converting: true });
  if (await convert(account, false, recordKey)) await writeMode(account, { on: false, converting: false });
}

/** Finishes a conversion cut short, toward the setting as written. */
export async function resume(account: bigint): Promise<void> {
  const mode: AtRestMode = readAtRestMode(await dbGet<unknown>('keyValue', atRestModeKey(account)));
  if (!mode.converting) return;
  if (await convert(account, mode.on, await readingKey(account))) await writeMode(account, { on: mode.on, converting: false });
}

/** Sign-out: the root leaves the agent and the key leaves memory. */
export async function forgetRoot(account: bigint): Promise<void> {
  keys.delete(account);
  await (await atRestRootStore()).remove(account);
}
