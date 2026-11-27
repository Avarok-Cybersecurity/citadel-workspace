/**
 * A file kept in the scratchpad: its bytes in the agent's LocalDB under the account's own cid,
 * read back whole, refused when they were damaged, and out of reach of any other account.
 *
 * Real: the store, the CBOR manifest and the browser's SHA-256. Stood in: the agent's LocalDB, a
 * Map per cid that rejects an absent key as the agent does ("Key not found").
 */
import { describe, it, expect } from 'vitest';
import { scratchpadBlobs, SCRATCHPAD_FILE_LIMIT } from '../scratchpad-blobs';
import { sha256Hex } from '@/lib/chat/attachments/attachment-wire';
import type { LocalDbPort } from '@/lib/cdoc/chat/chat-local-db';

const ME: bigint = 31n;
const OTHER: bigint = 32n;

type AgentDb = LocalDbPort & { rows: Map<string, Uint8Array> };

function agentDb(): AgentDb {
  const rows: Map<string, Uint8Array> = new Map();
  const at = (cid: bigint, key: string): string => `${cid.toString()}|${key}`;
  return {
    rows,
    get: async (cid: bigint, key: string): Promise<{ value: Uint8Array }> => {
      const value: Uint8Array | undefined = rows.get(at(cid, key));
      if (value === undefined) throw new Error(`Key not found: ${key}`);
      return { value };
    },
    set: async (cid: bigint, key: string, value: Uint8Array): Promise<void> => { rows.set(at(cid, key), value); },
  };
}

// Past one 256 KiB chunk, so the chunking is exercised and not just the single-record case.
const bytes: Uint8Array = Uint8Array.from({ length: 300 * 1024 }, (_: unknown, i: number): number => (i * 7) % 251);

describe('a file kept in the scratchpad', () => {
  it('reads back whole, under the sha-256 of its bytes', async () => {
    const db: AgentDb = agentDb();
    const id: string = await scratchpadBlobs(ME, db, sha256Hex).keep(bytes);
    expect(id).toBe(await sha256Hex(bytes));
    expect(await scratchpadBlobs(ME, db, sha256Hex).read(id)).toEqual(bytes);
    expect([...db.rows.keys()].every((k: string): boolean => k.startsWith(`${ME.toString()}|scratchpad:${ME.toString()}:file:${id}`))).toBe(true);
  });

  it('is refused, not handed over, when a chunk was damaged', async () => {
    const db: AgentDb = agentDb();
    const id: string = await scratchpadBlobs(ME, db, sha256Hex).keep(bytes);
    const key: string = `${ME.toString()}|scratchpad:${ME.toString()}:file:${id}#1`;
    const chunk: Uint8Array = (db.rows.get(key) ?? new Uint8Array()).slice();
    chunk[0] = (chunk[0] + 1) % 256;
    db.rows.set(key, chunk);
    await expect(scratchpadBlobs(ME, db, sha256Hex).read(id)).rejects.toThrow('damaged');
  });

  it('is not there for another account on the same agent', async () => {
    const db: AgentDb = agentDb();
    const id: string = await scratchpadBlobs(ME, db, sha256Hex).keep(bytes);
    await expect(scratchpadBlobs(OTHER, db, sha256Hex).read(id)).rejects.toThrow('not kept on this device');
  });

  it('is never kept under the device-wide cid 0, nor past its limit, nor read by a forged id', async () => {
    expect(() => scratchpadBlobs(0n, agentDb(), sha256Hex)).toThrow('never under the device-wide cid 0');
    await expect(scratchpadBlobs(ME, agentDb(), sha256Hex).keep(new Uint8Array(SCRATCHPAD_FILE_LIMIT + 1))).rejects.toThrow('up to 16 MB');
    await expect(scratchpadBlobs(ME, agentDb(), sha256Hex).read('../../other')).rejects.toThrow('not a scratchpad file id');
  });

  it('does not take a transport failure for an absent file', async () => {
    const db: AgentDb = agentDb();
    const id: string = await scratchpadBlobs(ME, db, sha256Hex).keep(bytes);
    db.get = async (): Promise<never> => { throw new Error('request timed out after 5s'); };
    await expect(scratchpadBlobs(ME, db, sha256Hex).read(id)).rejects.toThrow('timed out');
  });
});
