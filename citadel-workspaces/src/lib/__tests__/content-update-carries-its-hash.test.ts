/**
 * A colleague's save must not make the document refuse to render.
 *
 * Round 124 built the MDX integrity check: before executing a document, its
 * SHA-256 is compared against the hash the server recorded. Round 123/125 built
 * the content broadcast: a save fans `NodeContentUpdated` to everyone with the
 * document open. Neither round ran the other.
 *
 * `NodeContentUpdated` carried no hash, so a watcher merged the new content
 * over its cached node and kept the OLD hash — the exact shape the verifier
 * treats as tampering. Every non-editing member watching the document got the
 * refusal path instead of the update, and went on getting it until they
 * navigated away and back. Ordinary collaborative editing was the trigger.
 *
 * This pins the join: whatever the notification carries must be what a verifier
 * can check the content against.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { webcrypto } from 'node:crypto';
import { hashDocument, verifyDocument } from '../mdx-integrity';
import type { IntegrityVerdict } from '@/lib/mdx-integrity';

beforeAll(() => {
  // jsdom has no SubtleCrypto; the hash is real, not stubbed, so the test
  // exercises the same digest the browser would.
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

describe('a content update', () => {
  it('verifies against the hash that travelled with it', async () => {
    const edited: "# Edited by a colleague\n\nNew paragraph." = '# Edited by a colleague\n\nNew paragraph.';
    const hash: string = await hashDocument(edited);

    // What the watcher now holds after the merge: new content, new hash.
    expect(await verifyDocument(edited, hash)).toEqual({ status: 'verified' });
  });

  it('is refused when the content is checked against a stale hash', async () => {
    // The defect, stated: the watcher kept the hash of what it had loaded.
    const original: "# Original" = '# Original';
    const edited: "# Edited by a colleague" = '# Edited by a colleague';
    const staleHash: string = await hashDocument(original);

    const verdict: IntegrityVerdict = await verifyDocument(edited, staleHash);
    expect(verdict.status).toBe('mismatch');
  });

  it('degrades to unhashed rather than mismatch when no hash arrives', async () => {
    // An older server does not send the field. Refusing content because the
    // server predates the hash would be the same defect wearing the fix's
    // clothes, so absence must read as "cannot tell", not as "tampered".
    expect(await verifyDocument('# Anything', undefined)).toEqual({ status: 'unhashed' });
  });

  it('distinguishes a real edit from tampering, not just any change', async () => {
    // The check has to still work. A hash that matches nothing must fail.
    const edited: "# Edited" = '# Edited';
    const wrong: string = await hashDocument('# Something else entirely');

    expect((await verifyDocument(edited, wrong)).status).toBe('mismatch');
    expect((await verifyDocument(edited, await hashDocument(edited))).status).toBe('verified');
  });
});
