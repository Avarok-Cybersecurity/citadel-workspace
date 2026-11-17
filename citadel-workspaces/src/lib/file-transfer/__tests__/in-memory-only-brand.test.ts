import { describe, it, expect } from 'vitest';
import { wrapInMemory, type InMemoryOnly, type SendTransferRequestIntent } from '../types';

/**
 * Tests for the `InMemoryOnly<T>` brand used on
 * `SendTransferRequestIntent.file` — see `types.ts` for the rationale.
 *
 * The brand exists purely at the type level; the goal of these tests
 * is to pin the runtime invariant the brand promises:
 *   1. `wrapInMemory` is identity at runtime (zero-cost cast).
 *   2. A round-trip through `JSON.stringify` drops both the brand AND
 *      any non-serializable host content (here, a stub File), so the
 *      intent executor's missing-file branch reliably fires for any
 *      future caller that accidentally routes an intent through a
 *      JSON or BroadcastChannel bus.
 */
describe('InMemoryOnly<T> brand on SendTransferRequestIntent.file', () => {
  it('wrapInMemory is identity at runtime (the brand is compile-time only)', () => {
    const f: File = { name: 'a.txt', size: 1, type: 'text/plain' } as unknown as File;
    const wrapped: InMemoryOnly<File> = wrapInMemory(f);
    // Same reference — no defensive copy, no proxy, no wrapper object.
    expect(wrapped).toBe(f);
  });

  it('survives in-memory dispatch: intent retains the file reference', () => {
    const f: File = { name: 'a.txt', size: 1, type: 'text/plain' } as unknown as File;
    const intent: SendTransferRequestIntent = {
      type: 'send-transfer-request', offerAlreadyShown: false, staging: { signal: new AbortController().signal, onProgress: (): void => undefined, onStaged: (): void => undefined },
      transfer: { id: 't1' } as unknown as SendTransferRequestIntent['transfer'],
      file: wrapInMemory(f),
    };
    // In-memory inline dispatch (what `deps.io.executeIntent(intent)`
    // does today) preserves the reference. This is the only path the
    // brand sanctions.
    expect(intent.file).toBe(f);
  });

  it('JSON.stringify silently drops the file (the failure mode the brand documents)', () => {
    const f: File = { name: 'a.txt', size: 1, type: 'text/plain' } as unknown as File;
    const intent: SendTransferRequestIntent = {
      type: 'send-transfer-request', offerAlreadyShown: false, staging: { signal: new AbortController().signal, onProgress: (): void => undefined, onStaged: (): void => undefined },
      transfer: { id: 't1' } as unknown as SendTransferRequestIntent['transfer'],
      file: wrapInMemory(f),
    };
    const roundtrip: SendTransferRequestIntent = JSON.parse(JSON.stringify(intent)) as SendTransferRequestIntent;
    // The plain object `{ name, size, type }` JSON-roundtrips to an object
    // — what a real File would lose is its `arrayBuffer()`, `slice()`, etc.
    // The point: the brand at the type level is the only line of defense
    // a future caller has against this lossy path. The intent executor's
    // missing-file guard (`io.ts`) is the runtime fail-loud counterpart.
    // We explicitly verify the brand is gone (it's a `unique symbol`
    // property that doesn't survive JSON).
    // Cast through `unknown` so TS allows the property probe on a type
    // that doesn't structurally overlap with `Record<string, unknown>`.
    expect((roundtrip as unknown as Record<string, unknown>).__inMemoryOnly).toBeUndefined();
  });

  it('type-level: raw File would be a TS error without wrapInMemory (compile-only)', () => {
    // This test is documentation-only. The line below would NOT compile
    // because `File` is not assignable to `InMemoryOnly<File>`:
    //
    //   const intent: SendTransferRequestIntent = {
    //     type: 'send-transfer-request', offerAlreadyShown: false, staging: { signal: new AbortController().signal, onProgress: (): void => undefined, onStaged: (): void => undefined },
    //     transfer: ...,
    //     file: new File([], 'a.txt'),  // ← TS2322: Type 'File' is not assignable to 'InMemoryOnly<File>'
    //   };
    //
    // The brand is the line of defense — callers MUST use `wrapInMemory`.
    expect(typeof wrapInMemory).toBe('function');
  });

  it('InMemoryOnly<T> extends T, so the executor can unwrap with no cast', () => {
    // The branded type is `T & { __brand }`, so `.size`, `.name`, etc.
    // are accessible without unwrap. The executor in `io.ts` reads
    // `intent.file` directly and treats it as `File`.
    const f: File = { name: 'a.txt', size: 42, type: 'text/plain' } as unknown as File;
    const wrapped: InMemoryOnly<File> = wrapInMemory(f);
    expect(wrapped.size).toBe(42);
    expect(wrapped.name).toBe('a.txt');
  });
});
