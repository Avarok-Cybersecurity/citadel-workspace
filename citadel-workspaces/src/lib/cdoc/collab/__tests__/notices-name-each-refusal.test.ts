/**
 * Every refusal reaches the person by its kernel name and as its own notice, the hardening
 * kinds included.
 */
import { describe, expect, it } from 'vitest';
import type { DocumentRefusal } from 'citadel-workspace-client-ts';
import { DocumentSessionError, noticeKind, refusalName } from '../session-errors';

const NEWER: DocumentRefusal = { ClientIdForeign: { node_id: 'n', crdt_client: 9_007_199_254_740_993n } };

describe('refusal notices', () => {
  it('names a refusal by its kernel variant, unit or struct', () => {
    expect(refusalName('NoSession')).toBe('NoSession');
    expect(refusalName({ AwarenessRateLimited: { node_id: 'n' } })).toBe('AwarenessRateLimited');
    expect(refusalName(NEWER)).toBe('ClientIdForeign');
    expect(new DocumentSessionError({ kind: 'refused', refusal: NEWER }).message).toContain('ClientIdForeign');
  });

  it('gives each refusal kind its own notice, and every other problem one per kind', () => {
    const kinds: string[] = [
      noticeKind({ kind: 'refused', refusal: { NoSuchNode: { node_id: 'n' } } }),
      noticeKind({ kind: 'refused', refusal: NEWER }),
      noticeKind({ kind: 'refused', refusal: 'NotConfigured' }),
      noticeKind({ kind: 'permissionDenied', message: 'Permission denied: EditMdx required' }),
    ];
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(noticeKind({ kind: 'refused', refusal: { NoSuchNode: { node_id: 'other' } } })).toBe(kinds[0]);
  });
});
