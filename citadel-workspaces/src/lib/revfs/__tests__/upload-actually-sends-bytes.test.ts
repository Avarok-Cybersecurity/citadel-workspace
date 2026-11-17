/**
 * A file upload must put the file's BYTES on the wire, in a shape the backend
 * can deserialize.
 *
 * The request used to carry `source` as a bare string — and the string was a
 * tree DIRECTORY PATH, not a filesystem path and not data. The backend field is
 * `FileSource`, an externally-tagged enum, and the WASM client deserializes
 * strictly, so the request was rejected IN THE BROWSER. Nothing reached the
 * internal service and nothing was logged there. `transfer_type` was also
 * `'FileTransfer'` rather than `RemoteEncryptedVirtualFilesystem`, so even a
 * correct source would have landed somewhere `DownloadFile` cannot address.
 *
 * The tree was mutated and persisted BEFORE the call, the failed result was
 * awaited and discarded, and the user was shown "Uploaded: {name}". Phantom
 * files counted against the storage quota.
 *
 * These assert on the REQUEST OBJECT, because the existing test helper mocks
 * the whole intent as `{ type: 'backend-send-file', success: true }` — which is
 * precisely why no unit test could see any of this.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { backendSendFile } from '../revfs-io-network';

const sent: Array<Record<string, unknown>> = [];

/** The one I/O seam this module has — injected, so nothing needs mocking. */
const deps: { sendInternalServiceRequest: (request: unknown) => Promise<void>; } = {
  sendInternalServiceRequest: async (request: unknown): Promise<void> => {
    sent.push(request as Record<string, unknown>);
  },
};

const CID: bigint = 7n;
const CONTENT: Uint8Array<ArrayBuffer> = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

/** The SendFile payload from the most recent send. */
function lastSendFile(): Record<string, unknown> {
  const request: Record<string, unknown> = sent[sent.length - 1];
  return (request?.SendFile ?? {}) as Record<string, unknown>;
}

describe('a RE-VFS upload request', () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it('carries the file bytes as a ByteContents FileSource', async () => {
    void backendSendFile(deps, CID, null, 'notes.txt', CONTENT, '/docs/notes.txt');
    await Promise.resolve();

    const source: { ByteContents?: { file_name: string; data: number[]; }; } = lastSendFile().source as { ByteContents?: { file_name: string; data: number[] } };

    // A bare string here is what the WASM deserializer rejected outright.
    expect(typeof source).toBe('object');
    expect(source.ByteContents?.file_name).toBe('notes.txt');
    expect(source.ByteContents?.data).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('addresses the virtual filesystem, not a plain transfer', async () => {
    void backendSendFile(deps, CID, null, 'notes.txt', CONTENT, '/docs/notes.txt');
    await Promise.resolve();

    const transferType: { RemoteEncryptedVirtualFilesystem?: { virtual_path: string; }; } = lastSendFile().transfer_type as {
      RemoteEncryptedVirtualFilesystem?: { virtual_path: string };
    };

    // 'FileTransfer' would store the bytes somewhere DownloadFile and
    // DeleteVirtualFile cannot address, so the file would be unreachable.
    expect(transferType.RemoteEncryptedVirtualFilesystem?.virtual_path).toBe('/docs/notes.txt');
  });

  it('sends the peer cid through for a peer-scoped upload', async () => {
    void backendSendFile(deps, CID, 42n, 'notes.txt', CONTENT, '/docs/notes.txt');
    await Promise.resolve();

    // The peer path previously sent no bytes at all — only a tree op describing
    // a file whose contents never left the uploader's page.
    expect(lastSendFile().peer_cid).toBe(42n);
  });
});
