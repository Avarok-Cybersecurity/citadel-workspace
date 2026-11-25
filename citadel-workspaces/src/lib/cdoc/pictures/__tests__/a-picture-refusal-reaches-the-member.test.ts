/**
 * Every way the workspace server refuses a picture, and every way it fails to answer, reaches the
 * caller as the PictureFailure a member can be told: no answer in time, or a link that is down,
 * is offline, and nothing is sent while the link is down.
 */
import { describe, it, expect } from 'vitest';
import type { DocumentPictureRefusal } from 'citadel-workspace-client-ts';
import { serverPictures } from '../server-pictures';
import type { PictureDocument, PictureFailure, PictureResult } from '../picture-port';
import { scriptedServer, type ScriptedServer } from './scripted-server';

const NO_DEADLINE_HERE: number = 5_000;
/** Short, for the one test about it. */
const SHORT_DEADLINE: number = 20;
/** Longer than the test's own timeout: only the link can end the exchange in time. */
const BEYOND_THE_TEST: number = 60_000;
const ID: string = `sha256-${'cd'.repeat(32)}`;
const PAGE: PictureDocument = { kind: 'page', nodeId: 'room-1' };
const picture: Uint8Array = Uint8Array.from([1, 2, 3]);

function failure<T>(result: PictureResult<T>): PictureFailure {
  if (result.ok) throw new Error('expected a failure');
  return result.failure;
}

const REFUSALS: ReadonlyArray<readonly [DocumentPictureRefusal, PictureFailure]> = [
  ['Denied', { kind: 'notPermitted' }],
  ['NotFound', { kind: 'notFound' }],
  [{ TooLarge: { max_bytes: 26214400n } }, { kind: 'tooLarge', maxBytes: 26214400 }],
  [{ DocumentFull: { max_pictures: 2048 } }, { kind: 'full', detail: 'This document already holds 2048 pictures; remove one to add another.' }],
  ['StorageFull', { kind: 'full', detail: "The workspace's storage is full." }],
  ['Mismatch', { kind: 'damaged' }],
  ['BadChunk', { kind: 'damaged' }],
  ['Unavailable', { kind: 'unavailable', detail: 'The workspace server cannot keep pictures right now.' }],
];

describe('a refused or unanswered picture', () => {
  const named: ReadonlyArray<readonly [string, DocumentPictureRefusal, PictureFailure]> = REFUSALS.map(
    ([refusal, expected]: readonly [DocumentPictureRefusal, PictureFailure]): readonly [string, DocumentPictureRefusal, PictureFailure] =>
      [typeof refusal === 'string' ? refusal : Object.keys(refusal)[0], refusal, expected],
  );
  it.each(named)('is refused %s as the member is told it', async (_: string, refusal: DocumentPictureRefusal, expected: PictureFailure) => {
    const port = serverPictures(scriptedServer({ refuse: refusal }), NO_DEADLINE_HERE);
    expect(failure(await port.put(PAGE, ID, picture))).toEqual(expected);
    expect(failure(await port.get(PAGE, ID))).toEqual(expected);
  });

  it('is offline when the server does not answer in time', async () => {
    const port = serverPictures(scriptedServer({ silent: true }), SHORT_DEADLINE);
    expect(failure(await port.put(PAGE, ID, picture))).toEqual({ kind: 'offline' });
    expect(failure(await port.get(PAGE, ID))).toEqual({ kind: 'offline' });
  });

  it('is offline, and not sent, while the link is down', async () => {
    const server: ScriptedServer = scriptedServer();
    server.setLink('down');
    const port = serverPictures(server, NO_DEADLINE_HERE);
    expect(failure(await port.put(PAGE, ID, picture))).toEqual({ kind: 'offline' });
    expect(failure(await port.get(PAGE, ID))).toEqual({ kind: 'offline' });
    expect(server.sent).toEqual([]);
  });

  it('is offline as soon as the link drops while it waits', async () => {
    const server: ScriptedServer = scriptedServer({ silent: true });
    const port = serverPictures(server, BEYOND_THE_TEST);
    const pending: Promise<PictureResult<Uint8Array>> = port.get(PAGE, ID);
    await Promise.resolve();
    server.setLink('down');
    expect(failure(await pending)).toEqual({ kind: 'offline' });
  });
});
