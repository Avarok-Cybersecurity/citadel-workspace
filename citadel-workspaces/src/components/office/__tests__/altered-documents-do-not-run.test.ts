/**
 * The renderer must refuse content that does not match what the server stored.
 *
 * Rendering a document EXECUTES it, and the production CSP now grants
 * 'unsafe-eval' so that works at all. This is the compensating control, so it
 * has to be tested where it actually runs — the module tests prove the hash is
 * right, and prove nothing about whether anybody consults it.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { webcrypto } from 'node:crypto';
import { renderHook, waitFor } from '@testing-library/react';
import { useCompiledMdx } from '../use-compiled-mdx';
import { hashDocument } from '@/lib/mdx-integrity';

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
});

const components: never = {} as never;

describe('a document whose hash does not match', () => {
  it('is not rendered, and says why', async () => {
    const { result } = renderHook(() =>
      useCompiledMdx('# Tampered', components, 'deadbeef', false),
    );

    await waitFor(() => expect(result.current.renderError).toBeTruthy());
    expect(result.current.compiled).toBeNull();
    expect(result.current.renderError).toMatch(/does not match what the server stored/i);
  });

  it('renders normally when the hash matches', async () => {
    const content: "# Fine" = '# Fine';
    const hash: string = await hashDocument(content);

    const { result } = renderHook(() => useCompiledMdx(content, components, hash, false));

    await waitFor(() => expect(result.current.compiled).not.toBeNull());
    expect(result.current.renderError).toBeNull();
  });

  it('renders a document the server never hashed', async () => {
    // Documents written before the field existed have none. Refusing those
    // would take every old document offline to prevent a tamper that has not
    // happened.
    const { result } = renderHook(() => useCompiledMdx('# Old', components, null, false));

    await waitFor(() => expect(result.current.compiled).not.toBeNull());
    expect(result.current.renderError).toBeNull();
  });

  it('renders an unsaved buffer, which no hash can match', async () => {
    // While editing, the content is the user's own typing. Passing undefined is
    // how BaseOffice says "not the stored document"; refusing to render
    // someone's own draft would be absurd.
    const { result } = renderHook(() => useCompiledMdx('# Draft', components, undefined, false));

    await waitFor(() => expect(result.current.compiled).not.toBeNull());
    expect(result.current.renderError).toBeNull();
  });
});
