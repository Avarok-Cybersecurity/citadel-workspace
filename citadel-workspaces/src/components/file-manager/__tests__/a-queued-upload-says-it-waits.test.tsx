/**
 * An upload dropped while an earlier transfer of the same session is still sending waits in the
 * SDK behind it, with no tick of its own, possibly for minutes. Its toast said "Uploading …"
 * the whole time, which reads as frozen. It now says it is waiting for the earlier transfer to
 * finish, and then shows the upload's own progress.
 *
 * Real: the drop handler (useDropUpload), the transport (backendSendFile), the session's push
 * registry and the phase events. Doubles: sonner (jsdom renders no Toaster to read; the calls
 * are what the person would see) and the agent socket, whose frames are emitted by hand.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { eventEmitter } from '@/lib/event-emitter';
import { backendSendFile } from '@/lib/revfs/revfs-io-network';
import type { RevfsIntentResult } from '@/types/revfs-intents';
import { TreeScope, type RevfsFileMetadata } from '@/types/revfs-types';
import { useDropUpload } from '../useDropUpload';

const shown: string[] = [];
vi.mock('sonner', () => ({
  toast: new Proxy({}, { get: (_t: object, kind: string | symbol) => (m: string): number => { shown.push(`${String(kind)}: ${m}`); return 1; } }),
}));

const ME: bigint = 500n;
const sent: string[] = [];
const agent: { sendInternalServiceRequest: (request: unknown) => Promise<void> } = { sendInternalServiceRequest: async (request: unknown): Promise<void> => { sent.push((request as { SendFile: { request_id: string } }).SendFile.request_id); } };
const frame = (message: Record<string, unknown>): void => eventEmitter.emit('websocket-message', message);
const tick = (requestId: string, status: unknown): void => frame({ FileTransferTickNotification: { request_id: requestId, status } });

describe('an upload queued behind an earlier transfer of its session', () => {
  it('says it is waiting for the earlier transfer, then shows its own progress', async () => {
    const earlier: Promise<RevfsIntentResult> = backendSendFile(agent, ME, 42n, 'big.bin', new Uint8Array(3), '/big.bin', 'earlier');
    await vi.waitFor((): void => { expect(sent).toHaveLength(1); });
    frame({ SendFileRequestSuccess: { request_id: sent[0] } });
    tick(sent[0], 'TransferBeginning');

    const { result } = renderHook(() => useDropUpload({
      myCid: ME, storageOffer: { kind: 'offered' }, storageMode: TreeScope.Peer, storageUsed: 0, storageQuota: 100e6,
      uploadFile: async (dir: string, name: string, metadata: RevfsFileMetadata, content: Uint8Array): Promise<boolean> => {
        const pushed: RevfsIntentResult = await backendSendFile(agent, ME, 43n, name, content, dir, metadata.fileId);
        return pushed.type === 'backend-send-file' && pushed.success;
      },
      reportDelivery: (acknowledged: boolean, message: string): void => { shown.push(`delivered ${acknowledged}: ${message}`); },
      setRevfsDisabledReason: (): void => undefined,
      setRevfsDisabledModalOpen: (): void => undefined,
      setAttemptedFileSize: (): void => undefined,
      setStorageLimitModalOpen: (): void => undefined,
    }));
    const file: File = Object.assign(new File([new Uint8Array(3)], 'plan.pdf'), { arrayBuffer: async (): Promise<ArrayBuffer> => new ArrayBuffer(3) });
    const files: FileList = { 0: file, length: 1, item: (): File => file, [Symbol.iterator]: function* (): Generator<File> { yield file; } } as unknown as FileList;

    let dropped: Promise<void> = Promise.resolve();
    act((): void => { dropped = result.current('/', files); });
    await vi.waitFor((): void => { expect(sent).toHaveLength(2); });
    frame({ SendFileRequestSuccess: { request_id: sent[1] } });
    tick(sent[1], 'TransferBeginning');
    expect(shown.at(-1)).toBe('loading: plan.pdf: waiting for the earlier transfer to finish…');

    tick(sent[0], 'TransferComplete');
    expect(await earlier).toMatchObject({ success: true });
    tick(sent[1], { TransferTick: [1, 4, 1.0] });
    expect(shown.at(-1)).toBe('loading: Uploading plan.pdf… 25%');

    tick(sent[1], 'TransferComplete');
    await act(async (): Promise<void> => { await dropped; });
    expect(shown).toEqual([
      'loading: Uploading plan.pdf…',
      'loading: plan.pdf: waiting for the earlier transfer to finish…',
      'loading: Uploading plan.pdf… 25%',
      'delivered true: Uploaded: plan.pdf',
      'dismiss: 1',
    ]);
  });
});
