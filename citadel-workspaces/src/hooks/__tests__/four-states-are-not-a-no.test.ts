/**
 * Four states are not the answer "no", and each was learned from a surface
 * that had refused somebody something they were entitled to.
 *
 *   allowed     — yes.
 *   loading     — nobody has answered yet.
 *   unanswered  — the retry budget ran out; a failed request, not a refusal.
 *   !answered   — no answer for this domain is stored at all. `hasPermission`
 *                 reports that as `false`, indistinguishable from a refusal.
 *
 * Spelling them at each call site is how they drifted: the office composer had
 * three of the four and withheld itself from every user in a three-user run,
 * the theme editor had two and could show a workspace's own owner a read-only
 * editor, and `BaseOffice` had none and disabled Edit for anyone whose
 * permissions had not loaded.
 */
import { describe, it, expect } from 'vitest';
import { confirms, permits } from '../use-permission-result';
import type { UsePermissionResult } from '../use-permission-result';

function answer(over: Partial<UsePermissionResult>): UsePermissionResult {
  return {
    allowed: false,
    loading: false,
    reason: null,
    unanswered: false,
    answered: true,
    refresh: async (): Promise<void> => {},
    ...over,
  } as UsePermissionResult;
}

describe('what permits a control', () => {
  it('permits on each of the four states that are not a refusal', () => {
    expect(permits(answer({ allowed: true }))).toBe(true);
    expect(permits(answer({ loading: true }))).toBe(true);
    expect(permits(answer({ unanswered: true }))).toBe(true);
    expect(permits(answer({ answered: false }))).toBe(true);
  });

  it('refuses when the answer really was no', () => {
    // The positive control. Without it, `() => true` satisfies everything above
    // and every permission in the app becomes unenforceable.
    expect(permits(answer({ allowed: false, answered: true }))).toBe(false);
  });
});

describe('what a display claiming the permission may assert', () => {
  it('asserts only a known yes: none of the other three states is one', () => {
    expect(confirms(answer({ allowed: true }))).toBe(true);
    expect(confirms(answer({ loading: true }))).toBe(false);
    expect(confirms(answer({ unanswered: true }))).toBe(false);
    expect(confirms(answer({ answered: false }))).toBe(false);
  });
});
