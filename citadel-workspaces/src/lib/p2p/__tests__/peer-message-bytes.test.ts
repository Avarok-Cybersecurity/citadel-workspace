import { describe, it, expect } from 'vitest';
import { peerMessageBytes } from '../peer-message-bytes';

describe('peerMessageBytes', () => {
  it('accepts the agent JSON encoding and a byte view alike', () => {
    expect(Array.from(peerMessageBytes([1, 2, 3]) ?? [])).toEqual([1, 2, 3]);
    expect(Array.from(peerMessageBytes(new Uint8Array([4, 5])) ?? [])).toEqual([4, 5]);
  });

  it('accepts a byte view that is not a Uint8Array, which `instanceof` rejects', () => {
    // Stand-in for the real case: a Uint8Array built in another realm (the WASM
    // client, a worker, jsdom) is not `instanceof Uint8Array` here, and the old
    // inline branch dropped it as "unexpected". A clamped array and a DataView
    // fail that same check for the same reason and can be built in one realm.
    const clamped: Uint8ClampedArray = new Uint8ClampedArray([7, 8]);
    expect(clamped instanceof Uint8Array, 'the premise: instanceof says no').toBe(false);
    expect(Array.from(peerMessageBytes(clamped) ?? [])).toEqual([7, 8]);
    const view: DataView = new DataView(new Uint8Array([9, 10]).buffer);
    expect(Array.from(peerMessageBytes(view) ?? [])).toEqual([9, 10]);
  });

  it('refuses what is not bytes', () => {
    expect(peerMessageBytes('nope')).toBeNull();
    expect(peerMessageBytes(null)).toBeNull();
    expect(peerMessageBytes({ length: 2 })).toBeNull();
  });
});
