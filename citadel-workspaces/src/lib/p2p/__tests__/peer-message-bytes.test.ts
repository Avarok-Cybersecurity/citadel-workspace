import { runInNewContext } from 'node:vm';
import { describe, it, expect } from 'vitest';
import { peerMessageBytes } from '../peer-message-bytes';

describe('peerMessageBytes', () => {
  it('accepts the Uint8Array the WASM client hands over', () => {
    expect(Array.from(peerMessageBytes(new Uint8Array([4, 5])) ?? [])).toEqual([4, 5]);
  });

  it('accepts a Uint8Array from another realm, which `instanceof` rejects', () => {
    // The real case: a Uint8Array built in another realm (the WASM client, a
    // worker, jsdom) is not `instanceof Uint8Array` here, and the old inline
    // branch dropped it as "unexpected".
    const foreign: unknown = runInNewContext('new Uint8Array([7, 8])');
    expect(foreign instanceof Uint8Array, 'the premise: instanceof says no').toBe(false);
    expect(Array.from(peerMessageBytes(foreign) ?? [])).toEqual([7, 8]);
  });

  it('refuses what is not bytes', () => {
    expect(peerMessageBytes('nope')).toBeNull();
    expect(peerMessageBytes(null)).toBeNull();
    expect(peerMessageBytes({ length: 2 })).toBeNull();
  });

  it('refuses a list of numbers or another kind of view: a live byte field is a Uint8Array', () => {
    expect(peerMessageBytes([1, 2, 3])).toBeNull();
    expect(peerMessageBytes(new Uint8ClampedArray([7, 8]))).toBeNull();
    expect(peerMessageBytes(new DataView(new Uint8Array([9, 10]).buffer))).toBeNull();
  });
});
