/**
 * The owner's scenario for a scratchpad document: its pictures are kept on this device, in the
 * agent's LocalDB under the account (lib/scratchpad), so a reopen, another tab of the account
 * and an export all find them; another account on the same agent does not.
 *
 * Real: the device store, its chunked CBOR manifests, SHA-256, the wasm editor. Stood in: the
 * agent's LocalDB (FakeAgentLocalDb: I/O behind the WebSocket, with the agent's ownership gate).
 */
import { describe, expect, it } from 'vitest';
import { FakeAgentLocalDb } from '../../chat/__tests__/doubles/fake-agent-local-db';
import { sha256Hex } from '@/lib/chat/attachments/attachment-wire';
import { devicePictures } from '../device-pictures';
import { SCRATCHPAD_FILE_LIMIT } from '@/lib/scratchpad/scratchpad-blobs';
import type { PictureDocument } from '../picture-port';
import { drawnImages, insertCloseReopen, labels, storedAccess, type OwnerScenario } from './picture-rig';
import { PNG_4X3 } from './doubles/memory-pictures';
import { sha256ContentId } from '../content-id';

const ME: bigint = 41n;
const DOC: PictureDocument = { kind: 'scratchpad', account: ME, docId: 'cdoc-scratch-1' };

describe('a picture in a scratchpad document', () => {
  it('is drawn after a reopen in another tab, with the same bytes, and exported', async () => {
    const agent: FakeAgentLocalDb = new FakeAgentLocalDb();
    const tab = (): ReturnType<typeof storedAccess> => storedAccess(devicePictures(agent.connection([ME]), sha256Hex), DOC);
    const seen: OwnerScenario = await insertCloseReopen(tab, tab, PNG_4X3);
    expect(drawnImages(seen.reopenedCalls)).toBe(1);
    expect(seen.reopenedBytes).toEqual(PNG_4X3);
    expect(seen.exported).toEqual({ bytes: PNG_4X3 });
    expect(agent.requests.every((r) => r.cid === ME)).toBe(true);
  });

  it('is kept apart per document: another document of the account does not find it', async () => {
    const agent: FakeAgentLocalDb = new FakeAgentLocalDb();
    const port = devicePictures(agent.connection([ME]), sha256Hex);
    const id: string = await sha256ContentId(PNG_4X3);
    expect((await port.put(DOC, id, PNG_4X3)).ok).toBe(true);
    expect(await port.get({ ...DOC, docId: 'cdoc-scratch-2' }, id)).toEqual({ ok: false, failure: { kind: 'notFound' } });
  });

  it('refuses a picture larger than the device keeps, by name', async () => {
    const agent: FakeAgentLocalDb = new FakeAgentLocalDb();
    const big: Uint8Array = new Uint8Array(SCRATCHPAD_FILE_LIMIT + 1);
    expect(await devicePictures(agent.connection([ME]), sha256Hex).put(DOC, await sha256ContentId(big), big)).toEqual({ ok: false, failure: { kind: 'tooLarge', maxBytes: SCRATCHPAD_FILE_LIMIT } });
  });

  it('is not shown to another account signed in to the same agent', async () => {
    const agent: FakeAgentLocalDb = new FakeAgentLocalDb();
    const other = (): ReturnType<typeof storedAccess> => storedAccess(devicePictures(agent.connection([ME + 1n]), sha256Hex), DOC);
    const mine = (): ReturnType<typeof storedAccess> => storedAccess(devicePictures(agent.connection([ME]), sha256Hex), DOC);
    const seen: OwnerScenario = await insertCloseReopen(mine, other, PNG_4X3);
    expect(drawnImages(seen.reopenedCalls)).toBe(0);
    expect(labels(seen.reopenedCalls).join(' ')).toMatch(/picture not available/);
    expect(seen.exported).toEqual({ refused: expect.stringMatching(/^The document was not exported: 1 picture could not be fetched/) });
  });
});
