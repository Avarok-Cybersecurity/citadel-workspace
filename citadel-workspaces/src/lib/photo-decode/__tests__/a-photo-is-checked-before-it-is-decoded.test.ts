/**
 * decode-photo.ts with its ports faked: the module's probe refuses an oversized photo before the
 * browser or the module decodes a pixel; a format the browser draws is drawn from the original;
 * a RAW's JPEG preview is used as it is unless it needs turning upright. The fakes stand in for
 * the wasm binary and the canvas, which jsdom has neither of; the real binary is decoded in
 * the-vendored-decoder-decodes-each-format.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { AnswerKind, decodePhoto, type DecodePorts, type ModuleAnswer, type NativeMemo, type PhotoLimits } from '../decode-photo';

const LIMITS: PhotoLimits = { maxPixels: 40_000_000, maxEdge: 16_384 };
const BYTES: Uint8Array = new Uint8Array([1, 2, 3]);

function answer(kind: number, fields: Partial<Omit<ModuleAnswer, 'take_data'>> = {}, data: Uint8Array = new Uint8Array(4)): ModuleAnswer {
  return { kind, width: 0, height: 0, orientation: 1, flag: false, detail: '', ...fields, take_data: (): Uint8Array => data };
}

function ports(probe: ModuleAnswer, full: ModuleAnswer, native: boolean) {
  const module = vi.fn((_b: Uint8Array, _l: PhotoLimits, pixels: boolean): ModuleAnswer => (pixels ? full : probe));
  const drawsNatively = vi.fn(async (): Promise<boolean> => native);
  const encodeRgba = vi.fn(async (): Promise<Blob> => new Blob(['rgba'], { type: 'image/jpeg' }));
  const encodeJpeg = vi.fn(async (jpeg: Uint8Array): Promise<Blob> => new Blob([jpeg.slice().buffer], { type: 'image/jpeg' }));
  const all: DecodePorts = { module, drawsNatively, encodeRgba, encodeJpeg };
  return { all, module, drawsNatively, encodeRgba, encodeJpeg };
}

describe('a photo the page decodes', () => {
  it('over the limits is refused by the probe, before any decoder sees it', async () => {
    const p = ports(answer(AnswerKind.TooLarge, { width: 8064, height: 6048 }), answer(AnswerKind.Rgba), true);
    expect(await decodePhoto(BYTES, 'image/heic', LIMITS, p.all, new Map())).toEqual({ kind: 'too-large', width: 8064, height: 6048 });
    expect(p.module).toHaveBeenCalledTimes(1);
    expect(p.module.mock.calls[0][2]).toBe(false);
    expect(p.drawsNatively).not.toHaveBeenCalled();
    expect(p.encodeRgba).not.toHaveBeenCalled();
  });

  it('that the browser draws is drawn from the original, and decoded by nobody else', async () => {
    const p = ports(answer(AnswerKind.Fits, { width: 64, height: 48, flag: true }), answer(AnswerKind.Rgba), true);
    expect(await decodePhoto(BYTES, 'image/heic', LIMITS, p.all, new Map())).toEqual({ kind: 'decoded', blob: null, width: 64, height: 48 });
    expect(p.module).toHaveBeenCalledTimes(1);
  });

  it('that the browser cannot draw is decoded to pixels, and the browser is not asked again', async () => {
    const p = ports(answer(AnswerKind.Fits, { width: 64, height: 48, flag: true }), answer(AnswerKind.Rgba, { width: 64, height: 48, flag: true }), false);
    const memo: NativeMemo = new Map();
    const first = await decodePhoto(BYTES, 'image/heic', LIMITS, p.all, memo);
    expect(first).toMatchObject({ kind: 'decoded', width: 64, height: 48 });
    expect(p.encodeRgba).toHaveBeenCalledWith(expect.any(Uint8Array), 64, 48, 1, true);
    await decodePhoto(BYTES, 'image/heic', LIMITS, p.all, memo);
    expect(p.drawsNatively).toHaveBeenCalledTimes(1);
  });

  it('that neither decoder reads does not mark the format as one the browser lacks', async () => {
    const p = ports(answer(AnswerKind.Fits, { width: 64, height: 48, flag: true }), answer(AnswerKind.Malformed, { detail: 'truncated' }), false);
    const memo: NativeMemo = new Map();
    expect(await decodePhoto(BYTES, 'image/heic', LIMITS, p.all, memo)).toEqual({ kind: 'unreadable', detail: 'truncated' });
    expect(memo.size).toBe(0);
  });

  it('whose browser drawing is not the right picture (a later TIFF image) is never drawn natively', async () => {
    const p = ports(answer(AnswerKind.Fits, { width: 4, height: 4, flag: false }), answer(AnswerKind.Rgba, { width: 4, height: 4 }), true);
    await decodePhoto(BYTES, 'image/tiff', LIMITS, p.all, new Map());
    expect(p.drawsNatively).not.toHaveBeenCalled();
    expect(p.encodeRgba).toHaveBeenCalledTimes(1);
  });

  it("from a camera RAW is its JPEG preview, sized upright", async () => {
    const jpeg: Uint8Array = new Uint8Array([0xff, 0xd8, 0xff]);
    const p = ports(answer(AnswerKind.Jpeg, { width: 600, height: 400, orientation: 6 }, jpeg), answer(AnswerKind.Rgba), true);
    const got = await decodePhoto(BYTES, 'image/tiff', LIMITS, p.all, new Map());
    expect(got).toMatchObject({ kind: 'decoded', width: 400, height: 600 });
    expect(p.encodeJpeg).toHaveBeenCalledWith(jpeg, 600, 400, 6);
    expect(p.module).toHaveBeenCalledTimes(1);
    expect(p.drawsNatively).not.toHaveBeenCalled();
  });

  it('the decoder cannot read says what it lacks', async () => {
    const p = ports(answer(AnswerKind.Unsupported, { detail: 'inter prediction' }), answer(AnswerKind.Rgba), true);
    expect(await decodePhoto(BYTES, 'image/heic', LIMITS, p.all, new Map())).toEqual({ kind: 'unsupported', detail: 'inter prediction' });
  });
});
