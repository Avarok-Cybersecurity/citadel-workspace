/**
 * The workspace server keeps pictures of at most its configured size (25 MiB as shipped), which
 * is below the editor's own ceiling for an embedded image (32 MiB). A picture between the two is
 * refused with the server's limit before any of it is held by the editor or sent: the server's
 * limit is the only one the editor applies, asked of the server once per open document.
 */
import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES } from '../../engine/engine-limits';
import { serverPictures } from '../server-pictures';
import type { PictureDocument } from '../picture-port';
import { scriptedServer, SHIPPED_MAX_BYTES, type ScriptedServer } from './scripted-server';
import { close, openWith, storedAccess, type Opened } from './picture-rig';
import { PNG_4X3 } from './doubles/memory-pictures';

const PAGE: PictureDocument = { kind: 'page', nodeId: 'node-9' };
const DEADLINE_MS: number = 2_000;

describe('a picture larger than the workspace server keeps', () => {
  it('is refused with the server\'s limit before any of it is uploaded, though the editor could hold it', async () => {
    expect(SHIPPED_MAX_BYTES).toBeLessThan(MAX_IMAGE_BYTES);
    const server: ScriptedServer = scriptedServer();
    const o: Opened = await openWith(storedAccess(serverPictures(server, DEADLINE_MS), PAGE), { kind: 'blank' });
    try {
      const between: Uint8Array = new Uint8Array((SHIPPED_MAX_BYTES + MAX_IMAGE_BYTES) / 2);
      await expect(o.editor.addImage(between)).rejects.toThrow('The picture was not added. Pictures in this document can be at most 25 MB.');
      expect(server.sent.map((r) => Object.keys(r)[0])).toEqual(['Limits']);
      expect(await o.editor.pictureLimit()).toBe(SHIPPED_MAX_BYTES);
      await o.editor.addImage(PNG_4X3);
      expect(server.sent.map((r) => Object.keys(r)[0])).toEqual(['Limits', 'UploadChunk']);
    } finally {
      close(o);
    }
  });

  it('follows the server: one configured smaller is the limit the editor applies', async () => {
    const server: ScriptedServer = scriptedServer({ maxBytes: PNG_4X3.length - 1 });
    const o: Opened = await openWith(storedAccess(serverPictures(server, DEADLINE_MS), PAGE), { kind: 'blank' });
    try {
      await expect(o.editor.addImage(PNG_4X3)).rejects.toThrow(/^The picture was not added\. Pictures in this document can be at most/);
      expect(server.sent.some((r) => 'UploadChunk' in r)).toBe(false);
    } finally {
      close(o);
    }
  });
});
