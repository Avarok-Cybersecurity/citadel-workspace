/**
 * A copied file shares its original's backend byte key — deletion must
 * respect that.
 *
 * `copyNode` regenerates `fileId` but keeps `fileMetadata.virtualDirectory`,
 * the immutable upload-time key the backend stores the bytes under (it cannot
 * duplicate or re-path an object, and the browser does not hold the bytes, so
 * sharing is the only representable relationship). Every delete site
 * addresses that key — so deleting EITHER copy used to destroy the bytes the
 * other still pointed at, and an rmdir of a folder holding only a copy swept
 * bytes still referenced from outside the folder. The fix: delete sites
 * refcount the key (tree-byte-refs.ts) and only issue the backend delete for
 * the LAST reference.
 *
 * Driven through the real RevfsService — tree functions, ops modules, state —
 * with only the I/O boundary mocked (SBIO); assertions are on which
 * backend-delete-file intents actually reach that boundary.
 */
import { describe, it, expect } from 'vitest';
import {
  ALICE,
  BOB,
  createTestService,
  defaultIntentHandler,
  getExecuteCalls,
} from './revfs-service-test-helpers';
import type { RevfsFileMetadata } from '@/types/revfs-types';
import type { RevfsService } from '@/lib/revfs/revfs-service';

const META: RevfsFileMetadata = {
  fileId: 'f1',
  fileName: 'report.pdf',
  fileSize: 4096,
  fileType: 'pdf',
  virtualDirectory: '',
  uploadedByCid: ALICE,
};
const BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([1, 2, 3]);

/** The virtualDir of every backend-delete-file intent issued so far. */
function deletesIssued(service: ReturnType<typeof createTestService>): string[] {
  return getExecuteCalls(service)
    .filter(i => i.type === 'backend-delete-file')
    .map(i => (i as { virtualDir: string }).virtualDir);
}

describe('deleting one of two copies (peer scope)', () => {
  it('keeps the bytes until the LAST reference is removed', async () => {
    const service: RevfsService = createTestService(defaultIntentHandler());
    await service.mkdir(ALICE, BOB, '/docs');
    await service.uploadFileToPeer(ALICE, BOB, '/docs', 'report.pdf', META, BYTES);
    await service.copy(ALICE, BOB, '/docs/report.pdf', '/');

    // Removing the ORIGINAL: the copy still points at these bytes, so no
    // backend delete may go out — issuing one here is exactly the defect
    // that silently broke the surviving copy.
    await service.removeFileFromPeer(ALICE, BOB, '/docs/report.pdf');
    expect(deletesIssued(service)).toEqual([]);

    // Removing the last copy: now the bytes are unreferenced and must be
    // deleted, exactly once, under the upload-time key.
    await service.removeFileFromPeer(ALICE, BOB, '/report.pdf');
    expect(deletesIssued(service)).toEqual(['/docs/report.pdf']);
  });
});

describe('deleting one of two copies (server scope)', () => {
  it('keeps the bytes until the LAST reference is removed', async () => {
    const service: RevfsService = createTestService(defaultIntentHandler());
    await service.serverMkdir(ALICE, '/docs');
    await service.uploadFileToServer(ALICE, '/docs', 'report.pdf', META, BYTES);
    await service.serverCopy(ALICE, '/docs/report.pdf', '/');

    await service.removeFileFromServer(ALICE, '/docs/report.pdf');
    expect(deletesIssued(service)).toEqual([]);

    await service.removeFileFromServer(ALICE, '/report.pdf');
    expect(deletesIssued(service)).toEqual(['/docs/report.pdf']);
  });
});

describe('rmdir over shared bytes', () => {
  it('does not sweep bytes still referenced outside the removed folder', async () => {
    const service: RevfsService = createTestService(defaultIntentHandler());
    await service.serverMkdir(ALICE, '/docs');
    await service.serverMkdir(ALICE, '/backup');
    await service.uploadFileToServer(ALICE, '/docs', 'report.pdf', META, BYTES);
    await service.serverCopy(ALICE, '/docs/report.pdf', '/backup');

    // The folder holds ONLY the copy; the original outside still needs the
    // bytes. Sweeping them here destroyed a file the tree still listed as
    // downloadable.
    await service.serverRmdir(ALICE, '/backup');
    expect(deletesIssued(service)).toEqual([]);

    // Once the last reference goes, the sweep must reclaim the bytes.
    await service.serverRmdir(ALICE, '/docs');
    expect(deletesIssued(service)).toEqual(['/docs/report.pdf']);
  });

  it('deletes a blob once when a folder holds both original and copy', async () => {
    const service: RevfsService = createTestService(defaultIntentHandler());
    await service.serverMkdir(ALICE, '/docs');
    await service.uploadFileToServer(ALICE, '/docs', 'report.pdf', META, BYTES);
    await service.serverCopy(ALICE, '/docs/report.pdf', '/docs');

    // Two nodes, one blob. A second delete for the same key would fail on
    // the backend and misreport an otherwise healthy sweep.
    await service.serverRmdir(ALICE, '/docs');
    expect(deletesIssued(service)).toEqual(['/docs/report.pdf']);
  });
});
