/**
 * "Max file size to accept" must limit what you accept.
 *
 * The setting is labelled that way in Chat Settings and was read at exactly
 * one site: the SEND path. So a user who lowered the slider to protect
 * themselves carried on receiving files of any size — and with auto-accept on,
 * without being asked. A receiver had no way to limit what arrived, while the
 * control read as protective.
 */
import { describe, it, expect, vi } from 'vitest';
import { acceptTransfer , type LifecycleDeps } from '../transfer-lifecycle';
import type { FileTransfer } from '../types';

const PEER: string = '42';
const ONE_MB: number = 1024 * 1024;

function offered(fileSize: number): FileTransfer {
  return {
    id: 't1',
    senderCid: PEER,
    fileSize,
    fileName: 'big.bin',
    state: 'pending',
    isIncoming: true,
    updatedAt: 0,
    mode: 'sync',
  } as unknown as FileTransfer;
}

function deps(transfer: FileTransfer, maxFileSize: number): { d: LifecycleDeps; executeIntent: ReturnType<typeof vi.fn>; } {
  const executeIntent: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
  return {
    d: {
      state: {
        getTransfer: () => transfer,
        getSettings: () => ({ maxFileSize }),
      },
      io: { executeIntent },
      emitStateChange: vi.fn(),
      saveTransfer: vi.fn().mockResolvedValue(undefined),
      saveSettings: vi.fn(),
    } as unknown as LifecycleDeps,
    executeIntent,
  };
}

describe('the receiver-side size limit', () => {
  it('refuses a file larger than the limit, and sends no acceptance', async () => {
    const t: FileTransfer = offered(50 * ONE_MB);
    const { d, executeIntent } = deps(t, 10 * ONE_MB);

    await expect(acceptTransfer(d, 't1')).rejects.toThrow(/exceeds your limit/);

    // The important half: nothing was sent, so the peer does not start
    // streaming 50MB at a receiver that refused it.
    expect(executeIntent).not.toHaveBeenCalled();
    expect(t.state).toBe('pending');
  });

  it('accepts a file within the limit', async () => {
    // Negative control for the check itself — a limit that refuses everything
    // would pass the test above while breaking the feature.
    const t: FileTransfer = offered(5 * ONE_MB);
    const { d, executeIntent } = deps(t, 10 * ONE_MB);

    await acceptTransfer(d, 't1');

    expect(executeIntent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'send-response', accepted: true }),
    );
    expect(t.state).toBe('transferring');
  });

  it('accepts a file exactly at the limit', async () => {
    // The boundary belongs to the user: a 10MB limit accepts a 10MB file.
    const t: FileTransfer = offered(10 * ONE_MB);
    const { d, executeIntent } = deps(t, 10 * ONE_MB);

    await acceptTransfer(d, 't1');

    expect(executeIntent).toHaveBeenCalled();
  });
});
