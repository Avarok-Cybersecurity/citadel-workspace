/**
 * The binary the page ships (public/photo, built by scripts/build-photo-decode.mjs) with its glue
 * (vendor/photo): loaded here as the worker loads it, and asked to decode each format. Also the
 * pairing: the glue fetches the binary from PHOTO_DECODE_WASM_URL, PROVENANCE.json names these
 * exact bytes, and decode-photo.ts's AnswerKind is the module's.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as glue from '../../../../vendor/photo/photo_decode.js';
import { PHOTO_DECODE_WASM_URL } from '../asset-urls';
import { AnswerKind } from '../decode-photo';

const UI: string = process.cwd();
const WASM: Buffer = readFileSync(join(UI, 'public', PHOTO_DECODE_WASM_URL));
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(UI, '..', 'crates', 'photo-decode', 'tests', 'fixtures', name)));
const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const CAPS: [number, number] = [40_000_000, 16_384];

beforeAll(() => {
  glue.initSync({ module: WASM });
});

describe('the vendored photo decoder', () => {
  it('is the pair PROVENANCE.json names, fetching its binary from the stable URL', () => {
    const provenance: Record<string, string | number> = JSON.parse(readFileSync(join(UI, 'vendor', 'photo', 'PROVENANCE.json'), 'utf8')) as Record<string, string | number>;
    const js: Buffer = readFileSync(join(UI, 'vendor', 'photo', 'photo_decode.js'));
    expect(provenance.wasm_sha256).toBe(sha(WASM));
    expect(provenance.wasm_bytes).toBe(WASM.length);
    expect(provenance.glue_sha256).toBe(sha(js));
    expect(js.toString('utf8')).toContain(JSON.stringify(PHOTO_DECODE_WASM_URL));
  });

  it('answers with the kinds decode-photo.ts reads', () => {
    for (const [name, value] of Object.entries(AnswerKind)) expect(glue.AnswerKind[name as keyof typeof glue.AnswerKind]).toBe(value);
  });

  it('decodes a HEIC photo to RGBA', () => {
    const answer = glue.decode_photo(fixture('checker-64.heic'), ...CAPS, true);
    expect([answer.kind, answer.width, answer.height, answer.flag]).toEqual([AnswerKind.Rgba, 64, 64, true]);
    expect(answer.take_data()).toHaveLength(64 * 64 * 4);
  });

  it('probes a HEIC photo without decoding it', () => {
    const answer = glue.decode_photo(fixture('checker-64.heic'), ...CAPS, false);
    expect([answer.kind, answer.width, answer.height, answer.flag]).toEqual([AnswerKind.Fits, 64, 64, true]);
    expect(answer.take_data()).toHaveLength(0);
  });

  it('decodes an LZW TIFF exactly', () => {
    const answer = glue.decode_photo(fixture('quadrants-48-lzw.tif'), ...CAPS, true);
    expect(answer.kind).toBe(AnswerKind.Rgba);
    const data: Uint8Array = answer.take_data();
    expect(Array.from(data.subarray(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(data.subarray((48 * 48 - 1) * 4))).toEqual([255, 255, 255, 255]);
  });

  it('refuses a photo over the caps it is given, before decoding', () => {
    const answer = glue.decode_photo(fixture('checker-64.heic'), 64 * 64 - 1, 16_384, true);
    expect([answer.kind, answer.width, answer.height]).toEqual([AnswerKind.TooLarge, 64, 64]);
  });

  it('answers garbage with a refusal, not a trap', () => {
    const garbage: Uint8Array = fixture('checker-64.heic').slice(0, 40);
    expect(glue.decode_photo(garbage, ...CAPS, true).kind).toBe(AnswerKind.Malformed);
    expect(glue.decode_photo(fixture('quadrants-48.png'), ...CAPS, true).kind).toBe(AnswerKind.Malformed);
  });
});
