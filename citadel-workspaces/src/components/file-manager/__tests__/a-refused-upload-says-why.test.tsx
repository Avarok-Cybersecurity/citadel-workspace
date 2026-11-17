/**
 * An upload the agent refuses says why, in the person's toast: the agent's own reason travels
 * from its SendFileRequestFailure through the transport (backendSendFile), the server upload
 * (uploadFileToServer) and the drop handler (useDropUpload) to the error the person reads.
 *
 * Seen in CI: Server Storage on a server whose SDK node had no filesystem backend refused
 * every upload with "File transfer is not enabled for this session. Both nodes must use a
 * filesystem backend", and the page said only that the server did not accept the file.
 *
 * Real: the transport, the server upload and the drop handler. Doubles, each because the
 * thing itself is not here: sonner (the toast is what is read, and jsdom renders no Toaster
 * the test can wait on), the agent socket (answered with the agent's refusal frame), and the
 * tree store (an in-memory default tree, the server upload's only read before the send).
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { eventEmitter } from '@/lib/event-emitter';
import { backendSendFile } from '@/lib/revfs/revfs-io-network';
import { uploadFileToServer, type FileOpsContext } from '@/lib/revfs/revfs-server-file-ops';
import { createDefaultTree } from '@/lib/revfs/tree-operations';
import type { RevfsIO } from '@/lib/revfs/revfs-io';
import type { RevfsIntent, RevfsIntentResult } from '@/types/revfs-intents';
import { TreeScope, type RevfsFileMetadata } from '@/types/revfs-types';
import { useDropUpload } from '../useDropUpload';
import { SERVER_STORAGE_CHECKING } from '@/lib/revfs/storage-offer';

const toasts: string[] = [];
vi.mock('sonner', () => ({
  toast: new Proxy({}, { get: (_t: object, kind: string | symbol) => (m: string): number => { toasts.push(`${String(kind)}: ${m}`); return 1; } }),
}));

const REFUSAL: string = 'File transfer is not enabled for this session. Both nodes must use a filesystem backend';
const ME: bigint = 300n;

/** The agent: answers each SendFile with its refusal, as the SDK's session did in CI. */
const refusingAgent = async (request: unknown): Promise<void> => {
  const requestId: string = (request as { SendFile: { request_id: string } }).SendFile.request_id;
  queueMicrotask((): void => { eventEmitter.emit('websocket-message', { SendFileRequestFailure: { request_id: requestId, message: REFUSAL } }); });
};

function serverOps(): FileOpsContext {
  const io: Pick<RevfsIO, 'execute'> = {
    execute: (intent: RevfsIntent): Promise<RevfsIntentResult> => {
      if (intent.type !== 'backend-send-file') throw new Error(`the server upload asked for ${intent.type} before its bytes were accepted`);
      return backendSendFile({ sendInternalServiceRequest: refusingAgent }, intent.cid, intent.peerCid, intent.fileName, intent.content, intent.virtualDir);
    },
  };
  return {
    ensureIO: (): RevfsIO => io as RevfsIO,
    getServerTree: async () => createDefaultTree(),
  } as unknown as FileOpsContext;
}

describe('an upload the agent refuses', () => {
  it('tells the person the agent\'s reason, not only that the server did not accept it', async () => {
    const ops: FileOpsContext = serverOps();
    const { result } = renderHook(() => useDropUpload({
      myCid: ME, storageOffer: { kind: 'offered' }, storageMode: TreeScope.Server, storageUsed: 0, storageQuota: 100e6,
      uploadFile: async (dir: string, name: string, metadata: RevfsFileMetadata, content: Uint8Array): Promise<boolean> => {
        await uploadFileToServer(ops, ME, dir, name, metadata, content);
        return true;
      },
      reportDelivery: (): void => { toasts.push('delivered'); },
      setRevfsDisabledReason: (): void => undefined,
      setRevfsDisabledModalOpen: (): void => undefined,
      setAttemptedFileSize: (): void => undefined,
      setStorageLimitModalOpen: (): void => undefined,
    }));
    const file: File = Object.assign(new File([new Uint8Array(3)], 'ten-pages.docx'), { arrayBuffer: async (): Promise<ArrayBuffer> => new ArrayBuffer(3) });
    const files: FileList = { 0: file, length: 1, item: (): File => file, [Symbol.iterator]: function* (): Generator<File> { yield file; } } as unknown as FileList;
    await act(async (): Promise<void> => { await result.current('/', files); });
    expect(toasts).not.toContain('delivered');
    expect(toasts.filter((t: string): boolean => t.startsWith('error: '))).toEqual([
      `error: Failed to upload ten-pages.docx: The server did not accept "ten-pages.docx", so it has not been uploaded. ${REFUSAL}`,
    ]);
  });
});

describe('a drop before the server has said whether it stores files', () => {
  it('sends nothing, and says it is still checking', async () => {
    const sent: string[] = [];
    const { result } = renderHook(() => useDropUpload({
      myCid: ME, storageOffer: { kind: 'checking' }, storageMode: TreeScope.Server, storageUsed: 0, storageQuota: 0,
      uploadFile: async (_dir: string, name: string): Promise<boolean> => { sent.push(name); return true; },
      reportDelivery: (): void => undefined,
      setRevfsDisabledReason: (): void => undefined,
      setRevfsDisabledModalOpen: (): void => undefined,
      setAttemptedFileSize: (): void => undefined,
      setStorageLimitModalOpen: (): void => undefined,
    }));
    const file: File = new File([new Uint8Array(3)], 'early.docx');
    const files: FileList = { 0: file, length: 1, item: (): File => file, [Symbol.iterator]: function* (): Generator<File> { yield file; } } as unknown as FileList;
    toasts.length = 0;
    await act(async (): Promise<void> => { await result.current('/', files); });
    expect(sent).toEqual([]);
    expect(toasts).toEqual([`info: ${SERVER_STORAGE_CHECKING}`]);
  });
});
