/**
 * The frame window a pairing frame names its answer in: by the digest of exact bytes, bounded by
 * count and by age, and never a wrong frame when the named one is not held.
 *
 * Real: the pairing and WebCrypto. The clock is injected.
 */
import { describe, expect, it } from 'vitest';
import type { WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';
import { AnswerPairing, HELD_FRAMES, HELD_MS, sha256Hex } from '../answer-pairing';

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);
const frame = (n: number): { bytes: Uint8Array; response: WorkspaceProtocolResponse } =>
  ({ bytes: bytesOf(`{"Response":{"Error":"answer ${n}"}}`), response: { Error: `answer ${n}` } });

function pairing(): { p: AnswerPairing; clock: { t: number } } {
  const clock: { t: number } = { t: 0 };
  const p: AnswerPairing = new AnswerPairing((): number => clock.t);
  p.setServerPairs(true);
  return { p, clock };
}

async function marker(p: AnswerPairing, requestId: bigint, bytes: Uint8Array): Promise<WorkspaceProtocolResponse | null> {
  const expected: ReturnType<AnswerPairing['expect']> = p.expect(requestId);
  const answered: WorkspaceProtocolResponse = { Answered: { request_id: requestId, digest: await sha256Hex(bytes) } };
  expect(p.readFrame(bytesOf('{}'), answered)).toBe(true);
  return expected.answer;
}

describe('the answer window', () => {
  it('digests as the kernel does (request_frame_tests.rs vector)', async () => {
    expect(await sha256Hex(bytesOf('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('gives a pairing frame the held frame its digest names, among others', async () => {
    const { p } = pairing();
    for (const n of [1, 2, 3]) expect(p.readFrame(frame(n).bytes, frame(n).response)).toBe(false);
    expect(await marker(p, 7n, frame(2).bytes)).toEqual({ Error: 'answer 2' });
  });

  it('gives null, never another frame, when the named frame is not held', async () => {
    const { p } = pairing();
    p.readFrame(frame(1).bytes, frame(1).response);
    expect(await marker(p, 7n, frame(9).bytes)).toBeNull();
  });

  it(`holds the last ${HELD_FRAMES} frames only`, async () => {
    const { p } = pairing();
    for (let n: number = 0; n <= HELD_FRAMES; n += 1) p.readFrame(frame(n).bytes, frame(n).response);
    expect(await marker(p, 1n, frame(0).bytes)).toBeNull();
    expect(await marker(p, 2n, frame(1).bytes)).toEqual({ Error: 'answer 1' });
  });

  it(`holds a frame for ${HELD_MS}ms only`, async () => {
    const { p, clock } = pairing();
    p.readFrame(frame(1).bytes, frame(1).response);
    p.readFrame(frame(2).bytes, frame(2).response);
    clock.t = HELD_MS + 1;
    expect(await marker(p, 1n, frame(1).bytes)).toBeNull();
    clock.t = 0;
    expect(await marker(p, 2n, frame(2).bytes)).toEqual({ Error: 'answer 2' });
  });

  it('holds nothing while the server does not pair', async () => {
    const { p } = pairing();
    p.setServerPairs(false);
    p.readFrame(frame(1).bytes, frame(1).response);
    p.setServerPairs(true);
    expect(await marker(p, 1n, frame(1).bytes)).toBeNull();
  });
});
