/**
 * Document integrity: the bytes that reach the renderer must be the bytes the
 * server stored.
 *
 * Rendering a workspace document means EXECUTING it — `@mdx-js/mdx` compiles
 * the MDX to JavaScript and runs it — and the production CSP now grants
 * `'unsafe-eval'` so that this works at all. That is a deliberate decision, and
 * this is its compensating control: the server hashes `mdx_content` on every
 * write, the client re-hashes before executing, and a mismatch refuses to run.
 *
 * Be exact about the boundary, because a control believed to cover more than it
 * does is worse than none:
 *
 *  - It DOES catch the document being altered between the server and the
 *    renderer — a corrupted IndexedDB cache, a store-layer bug, another tab
 *    writing over the content, a truncated response.
 *  - It does NOT stop an attacker who already has script execution on the page.
 *    They can patch this function, or alter content and hash together.
 *  - It says NOTHING about whether the document was hostile when it was
 *    written. A member with edit rights who writes malicious MDX gets a
 *    perfectly matching hash. That risk is inherent in executing
 *    member-authored documents at all, and is the reason the sandboxed
 *    alternatives exist.
 *
 * The hash rule must match `citadel_workspace_types::structs::mdx_content_hash`
 * exactly: hex-encoded SHA-256 of the UTF-8 bytes, with NO normalisation. The
 * Rust side has a test pinning the published SHA-256 of "abc"; so does this, so
 * neither can drift into agreeing only with itself.
 */

export type IntegrityVerdict =
  /** Hash present and matching. Safe to execute. */
  | { status: 'verified' }
  /**
   * The server stored no hash for this document. Not a failure: documents
   * written before the field existed have none, and a client must be able to
   * tell that from a mismatch.
   */
  | { status: 'unhashed' }
  /** Hash present and different. Do not execute. */
  | { status: 'mismatch'; expected: string; actual: string };

/** Hex-encoded SHA-256 of the UTF-8 bytes. Mirrors the Rust helper exactly. */
export async function hashDocument(content: string): Promise<string> {
  const bytes: Uint8Array<ArrayBuffer> = new TextEncoder().encode(content);
  const digest: ArrayBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyDocument(
  content: string,
  expected: string | null | undefined,
): Promise<IntegrityVerdict> {
  if (!expected) return { status: 'unhashed' };

  const actual: string = await hashDocument(content);
  // Not a constant-time comparison, deliberately: both values are public
  // properties of a document the caller already holds, so there is no secret
  // for a timing difference to leak.
  if (actual === expected) return { status: 'verified' };
  return { status: 'mismatch', expected, actual };
}
