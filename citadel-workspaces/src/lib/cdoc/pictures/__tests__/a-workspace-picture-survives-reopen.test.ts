/**
 * The owner's scenario over the workspace server's store, for a node's page and for a node chat
 * document: insert, close, reopen in a fresh editor as another member, export. The server is
 * scripted in memory (scripted-server.ts: the wire is I/O; the kernel's own tests prove its
 * gates, hash check, limits and purge); everything above the wire is real.
 */
import { describe, expect, it } from 'vitest';
import { serverPictures } from '../server-pictures';
import type { PictureDocument } from '../picture-port';
import { scriptedServer, type ScriptedServer } from './scripted-server';
import { drawnImages, insertCloseReopen, labels, storedAccess, type OwnerScenario } from './picture-rig';
import { PNG_4X3 } from './doubles/memory-pictures';
import { pictureMissingLabel } from '../picture-port';

const DEADLINE_MS: number = 2_000;
const DOCS: ReadonlyArray<readonly [string, PictureDocument]> = [
  ['a page', { kind: 'page', nodeId: 'node-7' }],
  ['a node chat document', { kind: 'nodeChat', nodeId: 'node-7', chatDoc: 'cdoc-chan-1' }],
];

describe.each(DOCS)('a picture in %s', (_: string, doc: PictureDocument) => {
  it('is drawn for another member after a reopen, with the same bytes, and exported', async () => {
    const server: ScriptedServer = scriptedServer();
    const member = (): ReturnType<typeof storedAccess> => storedAccess(serverPictures(server, DEADLINE_MS), doc);
    const seen: OwnerScenario = await insertCloseReopen(member, member, PNG_4X3);
    expect(drawnImages(seen.reopenedCalls)).toBe(1);
    expect(seen.reopenedBytes).toEqual(PNG_4X3);
    expect(seen.exported).toEqual({ bytes: PNG_4X3 });
  });

  it('is a box saying so for a member the server refuses', async () => {
    const stored: ScriptedServer = scriptedServer();
    const refusing: ScriptedServer = scriptedServer({ refuse: 'Denied' });
    const seen: OwnerScenario = await insertCloseReopen(
      () => storedAccess(serverPictures(stored, DEADLINE_MS), doc),
      () => storedAccess(serverPictures(refusing, DEADLINE_MS), doc),
      PNG_4X3,
    );
    expect(drawnImages(seen.reopenedCalls)).toBe(0);
    expect(labels(seen.reopenedCalls)).toContain(pictureMissingLabel({ kind: 'notPermitted' }));
  });
});

describe('two documents of one node', () => {
  it('keep their pictures apart: the page does not answer for the chat document', async () => {
    const server: ScriptedServer = scriptedServer();
    const seen: OwnerScenario = await insertCloseReopen(
      () => storedAccess(serverPictures(server, DEADLINE_MS), DOCS[0][1]),
      () => storedAccess(serverPictures(server, DEADLINE_MS), DOCS[1][1]),
      PNG_4X3,
    );
    expect(drawnImages(seen.reopenedCalls)).toBe(0);
    expect(labels(seen.reopenedCalls)).toContain(pictureMissingLabel({ kind: 'notFound' }));
  });
});
