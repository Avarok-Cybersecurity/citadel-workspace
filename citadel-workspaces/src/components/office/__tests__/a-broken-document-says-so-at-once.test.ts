/**
 * A stored document that cannot render says so immediately, instead of showing the previous one.
 *
 * Live (owner, 2026-09-27): applying a template that could not render left the OLD document on
 * screen with no error; only a reload showed "could not be displayed". The hook kept the last good
 * render on every failure -- right while typing, wrong for a stored document.
 *
 * No mocks: the hook and the real MDX renderer; the broken input is a component the registry does
 * not define, which is exactly what the templates did.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCompiledMdx } from '../use-compiled-mdx';
import { components } from '../mdxComponents';

const GOOD: string = '# Hello';
const BROKEN: string = '# Hello\n\n<SprintBoard />';

describe('a document that stops rendering', () => {
  it('outside the editor, replaces the old render with the error', async () => {
    const { result, rerender } = renderHook(({ src }: { src: string }) => useCompiledMdx(src, components, undefined, false), { initialProps: { src: GOOD } });
    await waitFor(() => expect(result.current.compiled).not.toBeNull());
    rerender({ src: BROKEN });
    await waitFor(() => expect(result.current.renderError).not.toBeNull());
    expect(result.current.compiled, 'the previous document was still shown').toBeNull();
  });

  it('while editing, keeps the last good render so half-typed markup does not blank the page', async () => {
    const { result, rerender } = renderHook(({ src }: { src: string }) => useCompiledMdx(src, components, undefined, true), { initialProps: { src: GOOD } });
    await waitFor(() => expect(result.current.compiled).not.toBeNull());
    rerender({ src: BROKEN });
    await waitFor(() => expect(result.current.renderError).not.toBeNull());
    expect(result.current.compiled).not.toBeNull();
  });
});
