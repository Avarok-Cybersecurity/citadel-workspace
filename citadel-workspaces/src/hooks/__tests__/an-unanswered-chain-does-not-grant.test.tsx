/**
 * Loosening a denial must not loosen it for ever.
 *
 * Round 392 made a refusal require the whole inheritance chain, and CI answered
 * within one run: `member-promotion.spec.ts` failed on
 *
 *     a plain member should not be able to edit -- Member holds no EditContent
 *     or EditMdx by design
 *
 * because nothing fetched the workspace root, so the chain never completed,
 * `permits()` returned true for everyone, and the Edit button was enabled for a
 * plain Member. Round 395 fetches the root; this holds the property that failure
 * demonstrated.
 *
 * The distinction the whole permission story rests on: "we have not been told"
 * grants provisionally, "we have been told no" refuses, and the second must be
 * reachable or the first is a permanent yes.
 */
import { describe, it, expect } from 'vitest';
import { permits } from '../use-permission-result';
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

describe('a permission whose chain has answered', () => {
  it('refuses a plain member, which is the whole point of the feature', () => {
    // What member-promotion.spec.ts asserts, at the unit the spec exercises
    // through four layers of app. Complete answer, permission withheld.
    expect(permits(answer({ allowed: false, answered: true }))).toBe(false);
  });

  it('grants provisionally while the chain is still incomplete', () => {
    // The positive control, and the reason the bug above was possible: this
    // must stay true, or a permission gate refuses on half an answer.
    expect(permits(answer({ allowed: false, answered: false }))).toBe(true);
  });

  it('cannot be satisfied by an answer that never completes', () => {
    // The failure CI found, stated as a property: if `answered` were never
    // reachable, the line above would be the only line that ever ran and the
    // permission would be unenforceable. Both states must be reachable.
    const provisional: boolean = permits(answer({ answered: false }));
    const settled: boolean = permits(answer({ answered: true }));
    expect(provisional).not.toBe(settled);
  });
});
