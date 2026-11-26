/**
 * DocumentHost mounts the Docs canvas through React.lazy(() => import('./DocsCanvas')). Under
 * vitest that import is Vite transforming the editor's whole module subtree on demand, through
 * the one transform server every worker shares: about a quarter of a second alone, past a
 * second under full-suite load. A test whose findBy/waitFor runs on the default clock right
 * after rendering DocumentHost was therefore timing the transform, not the document.
 *
 * Such a test awaits this in beforeAll: the chunk is a promise it can wait on, so it does, and
 * its clock covers only the document's opening. React.lazy still calls its own import when the
 * host mounts; that resolves from the module cache, so the production path runs unchanged.
 */
export async function docsCanvasLoaded(): Promise<void> {
  await import('@/components/documents/DocsCanvas');
}
