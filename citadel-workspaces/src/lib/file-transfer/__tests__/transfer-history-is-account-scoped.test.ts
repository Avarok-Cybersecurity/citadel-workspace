/**
 * One browser's accounts must not share a transfer history.
 *
 * Settings were given account scoping — `scopedSettingsKey` exists and its
 * comment says why: "two accounts in one browser talking to the same peer must
 * not share a max-file-size or an auto-accept switch". The transfer STORE was
 * left on a single global `citadel:file-transfers` key, so every tab loaded
 * every account's history and each write re-serialised all of it. Two accounts
 * in one browser is the ordinary case in this product, not an edge one.
 *
 * The same guarded/unguarded twin that produced most of this codebase's
 * defects, one file apart from the guard that names the hazard.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const currentCid: { value: bigint | null } = { value: 1n };
vi.mock('@/lib/multi-instance', () => ({
  instanceManager: {
    get cid(): bigint | null {
      return currentCid.value;
    },
  },
}));

import { persistTransfer, loadPersistedTransfers } from '../transfer-persistence';
import type { FileTransfer } from '../types';

function transfer(id: string, name: string): FileTransfer {
  return {
    id,
    fileName: name,
    fileSize: 10,
    senderCid: '7',
    recipientCid: '8',
    state: 'complete',
    isIncoming: true,
    mode: 'p2p',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    downloadPath: `/tmp/${name}`,
  } as unknown as FileTransfer;
}

function loadedIds(): string[] {
  const seen: FileTransfer[] = [];
  const store: { setTransfer: (t: FileTransfer) => void; setSettings: () => void; } = {
    setTransfer: (t: FileTransfer): void => { seen.push(t); },
    setSettings: (): void => {},
  };
  // loadPersistedTransfers is async but does no real I/O here.
  void loadPersistedTransfers(store);
  return seen.map((t) => t.id);
}

describe('the transfer history', () => {
  beforeEach(() => {
    localStorage.clear();
    currentCid.value = 1n;
  });

  it('is not visible to another account in the same browser', async () => {
    persistTransfer(transfer('a1', 'alice.pdf'));

    currentCid.value = 2n;
    const store: { setTransfer: ReturnType<typeof vi.fn>; setSettings: ReturnType<typeof vi.fn>; } = { setTransfer: vi.fn(), setSettings: vi.fn() };
    await loadPersistedTransfers(store);

    expect(store.setTransfer).not.toHaveBeenCalled();
  });

  /**
   * The opposite direction. Without this, "store nothing" and "load nothing"
   * would satisfy the assertion above perfectly.
   */
  it('is still visible to the account that created it', async () => {
    persistTransfer(transfer('a1', 'alice.pdf'));

    const store: { setTransfer: ReturnType<typeof vi.fn>; setSettings: ReturnType<typeof vi.fn>; } = { setTransfer: vi.fn(), setSettings: vi.fn() };
    await loadPersistedTransfers(store);

    expect(store.setTransfer).toHaveBeenCalledTimes(1);
  });

  /**
   * `downloadPath` was omitted from the persisted fields, so after a reload the
   * "Click to open file" control rendered and operated on nothing — worse than
   * not rendering, because it reads as working.
   */
  it('remembers where the file was written, so the open control still works', async () => {
    persistTransfer(transfer('a1', 'alice.pdf'));

    const seen: FileTransfer[] = [];
    await loadPersistedTransfers({
      setTransfer: (t: FileTransfer): void => { seen.push(t); },
      setSettings: (): void => {},
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].downloadPath).toBe('/tmp/alice.pdf');
  });

  /** A session that has no account yet must still work, not throw. */
  it('falls back to an unscoped key when no account is known', async () => {
    currentCid.value = null;
    persistTransfer(transfer('a1', 'alice.pdf'));

    const store: { setTransfer: ReturnType<typeof vi.fn>; setSettings: ReturnType<typeof vi.fn>; } = { setTransfer: vi.fn(), setSettings: vi.fn() };
    await loadPersistedTransfers(store);

    expect(store.setTransfer).toHaveBeenCalledTimes(1);
  });
});

// Referenced so the helper above is not flagged as unused by lint.
void loadedIds;
