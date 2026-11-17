import { useEffect, useState, type ReactElement } from 'react';
import type { MDXComponents } from 'mdx/types';
import { renderMdx } from './render-mdx';
import { runAsyncSetup } from '@/lib/utils/async-utils';
import { debugLog } from '@/lib/debug-config';
import { verifyDocument , type IntegrityVerdict } from '@/lib/mdx-integrity';

/**
 * Compile MDX source to a rendered element.
 *
 * Extracted from BaseOffice so the component stays under the file cap. While
 * EDITING, a compile failure keeps the last good render rather than blanking the
 * page: a half-typed `<` should not make the document disappear. Outside the
 * editor it does not: a stored document that fails shows its error at once.
 * Keeping the last render there is what let an applied, broken template display
 * the OLD document with no error until a reload (owner, 2026-09-27).
 */
export interface CompiledMdx {
  compiled: ReactElement | null;
  renderError: string | null;
}

export function useCompiledMdx(
  content: string,
  components: MDXComponents,
  /**
   * The hash the SERVER stored for this content, if any.
   *
   * Rendering executes the document, so the bytes have to be the bytes the
   * server stored. `null`/`undefined` means the server has no hash for it —
   * documents written before the field existed — which renders normally; a hash
   * that is present and different does not. See lib/mdx-integrity.ts for what
   * this covers and, more importantly, what it does not.
   */
  expectedHash: string | null | undefined,
  /** True only while the user is editing the buffer; see the header. */
  keepLastGood: boolean,
): CompiledMdx {
  const [compiled, setCompiled] = useState<ReactElement | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    const compileContent = async (): Promise<void> => {
      try {
        debugLog('BaseOffice', 'Compiling MDX content...');
        // remark-gfm handles strikethrough, tables, autolinks, task-lists.
        // Pre-pass escapes JSX-significant chars inside `~~...~~` regions
        // so `~~value < 5~~` doesn't fail MDX parsing before remark-gfm
        // consumes it. See `applyGfmStrikethrough` for details.
        const verdict: IntegrityVerdict = await verifyDocument(content, expectedHash);
        if (verdict.status === 'mismatch') {
          debugLog('BaseOffice', 'MDX integrity mismatch', verdict);
          setCompiled(null);
          setRenderError(
            'This document was not displayed because it does not match what the ' +
              'server stored. Reload to fetch a fresh copy.',
          );
          return;
        }

        const element: ReactElement = await renderMdx(content, components, window.location.origin);
        debugLog('BaseOffice', 'MDX compilation successful');
        setCompiled(element);
        setRenderError(null);
      } catch (error) {
        // Shown, not only logged. `debugLog` compiles to a no-op outside dev,
        // so a document that cannot render was indistinguishable from an empty
        // one: title chrome, blank body, no error anywhere.
        //
        // That silence is why nobody noticed, for a while, that MDX rendering
        // failed for EVERY document in the production build: `evaluate()` runs
        // the compiled document through `new AsyncFunction`, and the production
        // CSP had no `'unsafe-eval'` while dev added it for HMR — so every dev,
        // tilt and Playwright run rendered fine and no shipped build did.
        //
        // That is no longer the state, and this comment used to say it was.
        // PRODUCTION_CSP in vite.config.ts now reads
        // `script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'`: rendering
        // documents client-side was taken as an explicit product decision, with
        // the weaker origin-wide policy accepted and compensated by the
        // integrity check at the top of this function — the server hashes
        // mdx_content on write and the client re-hashes before executing.
        //
        // So do not "fix" the CSP by removing 'unsafe-eval'. It is load-bearing
        // for this feature, the trade-off is recorded in docs/ROBUSTNESS.md
        // round 124, and the compensating control is the `verifyDocument` call
        // above rather than the policy. The branch below stays because the
        // failure is still possible — a stricter policy at a reverse proxy, or
        // a browser extension — and it must say so rather than blank the page.
        debugLog('BaseOffice', 'Error compiling MDX:', error);
        if (!keepLastGood) setCompiled(null);
        setRenderError(
          error instanceof Error && /unsafe-eval|Content Security Policy|CSP/i.test(error.message)
            ? 'This document could not be displayed: the app is not permitted to render document content in this build.'
            : 'This document could not be displayed. Its content may be malformed.',
        );
      }
    };

    runAsyncSetup(compileContent);
  }, [content, components, expectedHash, keepLastGood]);

  return { compiled, renderError };
}
