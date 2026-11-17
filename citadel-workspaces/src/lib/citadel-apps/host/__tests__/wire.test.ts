/**
 * The wire as the Rust side reads and writes it: bytes arrive as a CBOR byte string, a tag-64
 * typed array or an array of integers (serde_bytes/ciborium accept all three); f32 fields leave
 * as CBOR floats (ciborium refuses an integer for an f32, so an integral dpr would be BAD_CONTEXT);
 * AppEvent is snake_case and u64 is bigint.
 */
import { describe, expect, it } from 'vitest';
import { encodeAppContext, encodeAppEvent } from '../app-event';
import { decodeCbor, encodeCbor, f32, type Decoded } from '../cbor';
import { parseArgs } from '../op-args';
import { FIXTURE_CLOSE_GRACE_MS, fixtureContext } from './app-fixtures';

const text = (s: string): number[] => [0x60 + s.length, ...new TextEncoder().encode(s)];
/** {path: "a", bytes: <value>} with `value` already encoded. */
const filesWrite = (value: readonly number[]): Uint8Array => Uint8Array.from([0xa2, ...text('path'), ...text('a'), ...text('bytes'), ...value]);
const writeArgs = (value: readonly number[]): unknown => {
  const d: Decoded = decodeCbor(filesWrite(value));
  return d.ok ? parseArgs('FilesWrite', d.value) : 'undecodable';
};

describe('byte strings, in every form the Rust side accepts', () => {
  it('a byte string, a tag-64 typed array and an integer array all decode to the same bytes', () => {
    const want: { readonly path: string; readonly bytes: Uint8Array } = { path: 'a', bytes: Uint8Array.of(1, 2) };
    expect(writeArgs([0x42, 1, 2])).toEqual(want);
    expect(writeArgs([0xd8, 0x40, 0x42, 1, 2])).toEqual(want);
    expect(writeArgs([0x82, 1, 2])).toEqual(want);
  });

  it('an integer over 255, a string or a float is not bytes (control above)', () => {
    expect(writeArgs([0x82, 0x01, 0x19, 0x01, 0x00])).toBeNull();
    expect(writeArgs(text('ab'))).toBeNull();
    expect(writeArgs([0xfb, 0x3f, 0xf0, 0, 0, 0, 0, 0, 0])).toBeNull();
  });

  it('bytes leave as a CBOR byte string', () => {
    expect([...encodeCbor(Uint8Array.of(9))]).toEqual([0x41, 9]);
  });
});

describe('floats and integers', () => {
  it('an f32 field is written as a CBOR float even when integral; a bare float is refused (control: f32 wraps it)', () => {
    const ctx: Uint8Array = encodeAppContext(fixtureContext([], FIXTURE_CLOSE_GRACE_MS));
    const at: number = Buffer.from(ctx).indexOf(Buffer.from([0x63, ...new TextEncoder().encode('dpr')]));
    expect(ctx[at + 4]).toBe(0xfb);
    expect(() => encodeCbor({ dpr: 1.5 })).toThrow(/f32/);
    expect(decodeCbor(encodeCbor({ dpr: f32(1.5) }))).toEqual({ ok: true, value: { dpr: 1.5 } });
  });

  it('u64 fields are bigint after decoding, however small', () => {
    const d: Decoded = decodeCbor(encodeCbor({ peer: { username: 'b', cid: 5n, app_id: 'a', install_id: 'i', via: 'p2p' }, stream: 1n }));
    expect(d.ok && parseArgs('IhttpConsumed', d.value)).toEqual({ peer: { username: 'b', cid: 5n, app_id: 'a', install_id: 'i', via: 'p2p' }, stream: 1n });
  });
});

describe('AppEvent', () => {
  it('is snake_case and externally tagged, with pointer coordinates as floats', () => {
    expect(decodeCbor(encodeAppEvent({ reply_ready: { handle: 3 } }))).toEqual({ ok: true, value: { reply_ready: { handle: 3 } } });
    expect(decodeCbor(encodeAppEvent('init'))).toEqual({ ok: true, value: 'init' });
    const wheel: Uint8Array = encodeAppEvent({ wheel: { x: 1, y: 2, dx: 0, dy: 3, modifiers: { shift: false, ctrl: false, alt: false, meta: false } } });
    expect([...wheel].filter((b: number) => b === 0xfb).length).toBe(4);
  });
});
