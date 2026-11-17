import { describe, it, expect, vi, beforeEach  } from 'vitest';

/**
 * Pinning tests for `executeSendFile`'s source-discriminator logic.
 *
 * PR #13 introduced a `FileSource.ByteContents` variant so the React UI can
 * upload from a browser `File` object without first persisting to a path the
 * native picker provides. The branch is fragile because:
 *
 *   1. Three input modes (string path / pickFileRequestId / File) must each
 *      produce a distinct wire shape — a future refactor that collapses the
 *      branches risks silently sending the wrong variant to the SDK.
 *   2. The size guard prevents a 100 MB inline upload from OOM-crashing the
 *      tab; if the constant is changed or the guard is moved past
 *      `arrayBuffer()`, the allocation happens before the throw and we lose
 *      the protection.
 *
 * These tests pin the wire shape per input type AND verify the size guard
 * fires *before* the buffer allocation by spying on `arrayBuffer()`.
 */

const sendRequestSpy = vi.hoisted(() => vi.fn<(request: unknown) => Promise<void>>(async (): Promise<undefined> => undefined));

vi.mock('../../websocket-service', () => ({
  websocketService: {
    sendRequest: sendRequestSpy,
  },
}));

import { executeSendFile } from '../send-operations';
import type { SendFileParams } from '../io-router-types';

// jsdom's File implementation has unreliable byte semantics (calls
// toString on BlobPart). Build a fake File via Object.defineProperty so
// `source instanceof File` succeeds AND `size` / `arrayBuffer()` return
// the test bytes faithfully.
function makeFakeFile(name: string, bytes: Uint8Array, size: number = bytes.byteLength): File {
  const file: File = new File([new Uint8Array(0)], name);
  Object.defineProperty(file, 'size', { value: size, configurable: true });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    configurable: true,
  });
  return file;
}

beforeEach(() => {
  sendRequestSpy.mockClear();
});

interface SendFileRequest {
  SendFile: {
    request_id: string;
    source: unknown;
    cid: bigint;
    peer_cid: bigint;
    chunk_size: number | null;
    transfer_type: string;
  };
}

function extractSendFile(): SendFileRequest['SendFile'] {
  const [request] = sendRequestSpy.mock.calls[0] as unknown as [SendFileRequest];
  return request.SendFile;
}

// `mode` is required by SendFileParams but `executeSendFile` does not branch
// on it — every test in this file targets the source-discriminator logic, so
// we set a constant value via this helper to keep the call sites concise.
function buildParams(overrides: Partial<SendFileParams> & Pick<SendFileParams, 'source'>): SendFileParams {
  return {
    cid: 1n,
    peerCid: 2n,
    transferId: 'tid',
        ...overrides,
  };
}

describe('executeSendFile — source discrimination', () => {
  it('encodes a string path source as { Path: <string> }', async () => {
    // Don't await: sendRequest resolves but the wrapping promise waits for an
    // event we never emit. Fire the call, give the microtask queue a turn,
    // then assert on what was sent.
    void executeSendFile(buildParams({
      source: '/tmp/disk-file.bin',
      transferId: 'tid-1',
    }));
    await Promise.resolve();

    expect(sendRequestSpy).toHaveBeenCalledTimes(1);
    expect(extractSendFile().source).toEqual({ Path: '/tmp/disk-file.bin' });
  });

  it('encodes a pickFileRequestId source as { PickFileRef: { pick_file_request_id } }', async () => {
    // PickFileRef is only reached when `source` is NOT a string. Real callers
    // pass a placeholder File alongside the pickFileRequestId.
    const placeholder: File = new File([new Uint8Array(0)], 'placeholder');
    void executeSendFile(buildParams({
      source: placeholder,
      pickFileRequestId: 'pick-42',
      transferId: 'tid-2',
    }));
    await Promise.resolve();

    expect(sendRequestSpy).toHaveBeenCalledTimes(1);
    expect(extractSendFile().source).toEqual({
      PickFileRef: { pick_file_request_id: 'pick-42' },
    });
  });

  it('encodes a browser File source as { ByteContents: { file_name, data: number[] } } with the file bytes', async () => {
    const expectedBytes: Uint8Array<ArrayBuffer> = new Uint8Array([0xCA, 0xFE, 0xBA, 0xBE]);
    const file: File = makeFakeFile('hello.bin', expectedBytes);

    void executeSendFile(buildParams({
      source: file,
      cid: 7n,
      peerCid: 8n,
      transferId: 'tid-3',
    }));
    // arrayBuffer() is async — wait until the production code has dispatched
    // the request rather than guessing at the number of microtask turns.
    await vi.waitFor(() => expect(sendRequestSpy).toHaveBeenCalledTimes(1));
    const sent: { request_id: string; source: unknown; cid: bigint; peer_cid: bigint; chunk_size: number | null; transfer_type: string; } = extractSendFile();
    expect(sent.source).toEqual({
      ByteContents: {
        file_name: 'hello.bin',
        data: Array.from(expectedBytes),
      },
    });
    expect(sent.cid).toBe(7n);
    expect(sent.peer_cid).toBe(8n);
  });
});

describe('executeSendFile — ByteContents size guard', () => {
  it('rejects browser File payloads above the inline cap before any allocation', async () => {
    // Build a File whose `.size` reports above the cap. The fake
    // `arrayBuffer()` is wrapped in a spy that fails the test loudly if
    // the production code reaches it — that would mean the size check
    // ran *after* the allocation, defeating the OOM protection.
    const sizeBytes: number = 17 * 1024 * 1024;
    const allocSpy: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<ArrayBuffer> => new ArrayBuffer(sizeBytes));
    const oversized: File = new File([new Uint8Array(0)], 'too-big.bin');
    Object.defineProperty(oversized, 'size', { value: sizeBytes, configurable: true });
    Object.defineProperty(oversized, 'arrayBuffer', { value: allocSpy, configurable: true });

    await expect(
      executeSendFile(buildParams({
        source: oversized,
        transferId: 'tid-oversized',
      })),
    ).rejects.toThrow(/inline browser uploads are capped/);

    expect(allocSpy).not.toHaveBeenCalled();
    expect(sendRequestSpy).not.toHaveBeenCalled();
  });

  it('lets a 3 MiB file through the guard — the cap is the service\'s 16 MiB, not a second private 2 MiB', async () => {
    // Two constants both governed inline ByteContents payloads: 2 MiB here,
    // 16 MiB in server-upload.ts mirroring the internal service. A 3 MiB p2p
    // send was refused AFTER its offer was announced while the same bytes
    // staged fine in async mode. One cap now; this pins that the p2p guard
    // uses it.
    const { eventEmitter } = await import('../../event-emitter');
    const sizeBytes: number = 3 * 1024 * 1024;
    const smallEnough: File = makeFakeFile('mid.bin', new Uint8Array([9, 9]), sizeBytes);

    const pending: Promise<unknown> = executeSendFile(buildParams({ source: smallEnough, transferId: 'tid-mid' }));

    await vi.waitFor(() => expect(sendRequestSpy).toHaveBeenCalledTimes(1));
    const requestId: string = extractSendFile().request_id;
    eventEmitter.emit('websocket-message', { SendFileRequestSuccess: { request_id: requestId } });
    await expect(pending).resolves.toBeTruthy();
  });

  it('rejects a non-File, non-string, no-pickFileRequestId combination with a clear error', async () => {
    await expect(
      executeSendFile(buildParams({
        source: undefined as unknown as string,
        transferId: 'tid-bad',
      })),
    ).rejects.toThrow(/file path \(string\), pickFileRequestId, or a non-empty browser File/);

    expect(sendRequestSpy).not.toHaveBeenCalled();
  });
});
