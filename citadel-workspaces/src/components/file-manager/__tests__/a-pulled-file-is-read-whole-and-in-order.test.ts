/**
 * Reading a pulled file into the page, chunk by chunk: assembled whole into a buffer of its own,
 * every answer checked for continuity, and anything over the 256 MiB page cap refused before a
 * byte is copied. The double is the file manager's data source (the agent's pull and
 * ReadPulledChunk), answering from an in-memory file as the agent would from disk.
 */
import { describe, expect, it } from 'vitest';
import { RevfsFileState, type RevfsNode } from '@/types/revfs-types';
import { MAX_PULLED_FILE_BYTES, PulledFileError, READ_CHUNK_BYTES, readPulledFile, type PulledFileIO } from '../pulled-file-reader';
import type { PulledChunk } from '@/types/revfs-intents';

const NODE: RevfsNode = { name: 'big.docx', path: '/big.docx', type: 'file', fileState: RevfsFileState.ServerStored, createdAt: 0, updatedAt: 0 };

function agentWith(file: Uint8Array, tamper: (c: PulledChunk, n: number) => PulledChunk = (c: PulledChunk): PulledChunk => c): { io: PulledFileIO; asked: bigint[]; pulled: number } {
  const asked: bigint[] = [];
  const state: { pulled: number } = { pulled: 0 };
  const io: PulledFileIO = {
    pull: async (): Promise<void> => { state.pulled++; },
    readChunk: async (_n: RevfsNode, offset: bigint, maxLen: number): Promise<PulledChunk> => {
      asked.push(offset);
      const start: number = Number(offset);
      return tamper({ totalSize: BigInt(file.length), offset, data: file.slice(start, start + maxLen) }, asked.length);
    },
  };
  return { io, asked, get pulled(): number { return state.pulled; } };
}

type FakeAgent = ReturnType<typeof agentWith>;

const sized = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_v: unknown, i: number) => i % 251);

describe('reading a pulled file', () => {
  it('pulls once, then assembles every chunk in order into a buffer of its own', async () => {
    const file: Uint8Array = sized(2 * READ_CHUNK_BYTES + 17);
    const agent: FakeAgent = agentWith(file);
    const bytes: Uint8Array = await readPulledFile(NODE, agent.io);
    expect(agent.pulled).toBe(1);
    expect(agent.asked).toEqual([0n, BigInt(READ_CHUNK_BYTES), BigInt(2 * READ_CHUNK_BYTES)]);
    expect(Buffer.from(bytes).equals(Buffer.from(file))).toBe(true);
    expect(bytes.byteLength).toBe(bytes.buffer.byteLength);
  });

  it('reads an empty file as empty', async () => {
    expect((await readPulledFile(NODE, agentWith(new Uint8Array(0)).io)).length).toBe(0);
  });

  it('refuses an answer at another offset', async () => {
    const agent: FakeAgent = agentWith(sized(READ_CHUNK_BYTES + 5), (c, n) => (n === 2 ? { ...c, offset: c.offset + 1n } : c));
    await expect(readPulledFile(NODE, agent.io)).rejects.toThrow(/answered offset/);
  });

  it('refuses a file whose size changes while it is read', async () => {
    const agent: FakeAgent = agentWith(sized(READ_CHUNK_BYTES + 5), (c, n) => (n === 2 ? { ...c, totalSize: c.totalSize + 1n } : c));
    await expect(readPulledFile(NODE, agent.io)).rejects.toThrow(/size changed/);
  });

  it('refuses an agent that stops sending before the end', async () => {
    const agent: FakeAgent = agentWith(sized(READ_CHUNK_BYTES + 5), (c, n) => (n === 2 ? { ...c, data: new Uint8Array(0) } : c));
    await expect(readPulledFile(NODE, agent.io)).rejects.toThrow(/sent nothing/);
  });

  it('refuses a file over the page cap before copying anything', async () => {
    const agent: FakeAgent = agentWith(sized(4), (c) => ({ ...c, totalSize: MAX_PULLED_FILE_BYTES + 1n }));
    await expect(readPulledFile(NODE, agent.io)).rejects.toThrow(PulledFileError);
    expect(agent.asked).toEqual([0n]);
  });
});
