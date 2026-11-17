/**
 * A reload must not turn a transfer into a lie.
 *
 * Every transfer was persisted to a key nothing read back, so a reload lost all
 * of them while the message bubble kept rendering from the message record.
 * Accept, Decline and Cancel then threw "Transfer not found" — false about the
 * world: the agent still had it, and the browser had forgotten a record it
 * explicitly persisted. The user could not even dismiss the bubble.
 *
 * Restoring is not resuming, and the distinction is the whole test.
 */

import { describe, it, expect } from 'vitest';
import { restoreTransfer } from '../restore-transfer';
import type { FileTransfer } from '../types';

const persisted = (over: Record<string, unknown> = {}): Partial<FileTransfer> => ({
  id: 't-1',
  fileName: 'notes.md',
  fileSize: 1024,
  fileType: 'text/markdown',
  state: 'complete',
  isIncoming: true,
    createdAt: 1,
  updatedAt: 2,
  ...over,
}) as Partial<FileTransfer>;

describe('restoring a transfer after a reload', () => {
  it('keeps a finished transfer as it was, so history survives', () => {
    for (const state of ['complete', 'declined', 'cancelled', 'expired', 'error']) {
      const restored: FileTransfer | null = restoreTransfer(persisted({ state }));
      expect(restored?.state, state).toBe(state);
    }
  });

  it('does not bring back as in-flight a transfer nothing can follow', () => {
    // No id the agent's ticks carry was kept (a record from before they were),
    // so nothing could move its bar: a "Downloading… 40%" forever otherwise.
    for (const state of ['uploading', 'staged', 'transferring']) {
      const restored: FileTransfer | null = restoreTransfer(persisted({ state, progress: 40 }));
      expect(restored?.state, state).toBe('error');
      expect(restored?.progress, state).toBe(0);
    }
  });

  it('ends an unanswerable offer as expired, not failed, without sending anyone to ask', () => {
    // Nothing was moving, so "interrupted" and a red failure would be false.
    const offer: FileTransfer | null = restoreTransfer(persisted({ state: 'pending', progress: 0 }));
    expect(offer?.state).toBe('expired');
    expect(offer?.errorMessage).toMatch(/reloaded/i);
    expect(offer?.errorMessage).not.toMatch(/ask/i);
  });

  it('says what happened to a lost download, and does not tell the reader to ask', () => {
    const restored: FileTransfer | null = restoreTransfer(persisted({ state: 'transferring' }));
    expect(restored?.errorMessage).toMatch(/reload/i);
    expect(restored?.errorMessage).not.toMatch(/ask/i);
  });

  it('drops a record too damaged to render or act on', () => {
    // A half-written localStorage entry must not become a bubble with no name
    // and no id that nothing can dismiss.
    expect(restoreTransfer({})).toBeNull();
    expect(restoreTransfer({ id: '' })).toBeNull();
    expect(restoreTransfer({ id: 't', fileName: 'x' })).toBeNull();
  });

  it('fills in what a partial record is missing rather than dropping it', () => {
    const restored: FileTransfer | null = restoreTransfer({ id: 't', fileName: 'x', state: 'complete' });
    expect(restored).not.toBeNull();
    expect(restored?.fileSize).toBe(0);
  });

  it('restores a transfer persisted with the removed mode and staged path, without them', () => {
    const legacy: Record<string, unknown> = { id: 't', fileName: 'x', state: 'complete', mode: 'async', virtualPath: '/transfers/t/x' };
    const restored: FileTransfer | null = restoreTransfer(legacy as Partial<FileTransfer>);
    expect(restored?.state).toBe('complete');
    expect(restored).not.toHaveProperty('mode');
    expect(restored).not.toHaveProperty('virtualPath');
  });
});
