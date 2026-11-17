/**
 * The client's half of document integrity. Its rule has to match the Rust
 * helper's exactly, so both pin the same published SHA-256 constants rather
 * than comparing each implementation to itself.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { webcrypto } from 'node:crypto';
import { hashDocument, verifyDocument } from '../mdx-integrity';
import type { IntegrityVerdict } from '@/lib/mdx-integrity';

// jsdom ships no SubtleCrypto. Node's real WebCrypto is the same algorithm the
// browser runs, so this exercises the actual digest rather than a stub -- which
// matters here, because the constants below are the whole point.
beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
});

describe('hashDocument', () => {
  it('matches the published SHA-256 of the empty string', async () => {
    expect(await hashDocument('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the published SHA-256 of "abc"', async () => {
    // The same constant the Rust test pins. If either side changes its rule,
    // one of the two fails — which is the only way two implementations of one
    // hash can be kept honest.
    expect(await hashDocument('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('does not normalise unicode', async () => {
    // é as one codepoint vs e + combining acute: identical on screen, different
    // bytes. Normalising on one side only would make correct documents refuse
    // to render, which is a worse failure than the one this prevents.
    expect(await hashDocument('café')).not.toBe(await hashDocument('café'));
  });
});

describe('verifyDocument', () => {
  it('verifies content that matches its stored hash', async () => {
    const content: "# Hello" = '# Hello';
    expect(await verifyDocument(content, await hashDocument(content))).toEqual({
      status: 'verified',
    });
  });

  it('reports a mismatch when the content was altered', async () => {
    const stored: string = await hashDocument('# Hello');
    const verdict: IntegrityVerdict = await verifyDocument('# Hello<script>', stored);

    expect(verdict.status).toBe('mismatch');
  });

  it('reports a mismatch when the HASH was altered', async () => {
    const verdict: IntegrityVerdict = await verifyDocument('# Hello', 'deadbeef');
    expect(verdict.status).toBe('mismatch');
  });

  it('distinguishes "no hash stored" from "hash does not match"', async () => {
    // A document written before the field existed has none, and treating that
    // as a mismatch would make every old document refuse to render.
    expect((await verifyDocument('# Hello', null)).status).toBe('unhashed');
    expect((await verifyDocument('# Hello', undefined)).status).toBe('unhashed');
    expect((await verifyDocument('# Hello', '')).status).toBe('unhashed');
  });

  it('carries both hashes on a mismatch, so the report can say what differed', async () => {
    const verdict: IntegrityVerdict = await verifyDocument('# Hello', 'deadbeef');
    if (verdict.status !== 'mismatch') throw new Error('expected a mismatch');

    expect(verdict.expected).toBe('deadbeef');
    expect(verdict.actual).toBe(await hashDocument('# Hello'));
  });
});
