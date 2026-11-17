/**
 * "Nobody else is here yet" is a claim about the workspace. It must not be made
 * before anyone has been asked.
 *
 * `MembersSection` renders the empty state when `!isLoadingMembers &&
 * members.length === 0`. `useDomainMembers` started `isLoadingMembers` at
 * `false` with `members` at `[]`, and React runs effects AFTER paint — so on the
 * FIRST RENDER both conditions held and the sidebar asserted an empty room.
 * `member-list-loading.spec.ts` caught it in CI across three retries.
 *
 * The assertion is on the FIRST RENDER specifically, and that is the whole
 * difficulty. A test that reads `result.current` after `renderHook` measures the
 * state AFTER effects have flushed — which is `true` either way, so it passes
 * over the broken version too. The first version of this test did exactly that
 * and its negative control came back green.
 *
 * So the value is recorded from inside the render body, which runs before any
 * effect, and the first entry is what is asserted.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useDomainMembers } from '../use-domain-members';

vi.mock('@/lib/workspace-service', (): { default: { listMembers: () => Promise<void> } } => ({
  // Never resolves: the point is the window BEFORE the response, which is the
  // window the sidebar was rendering an assertion into.
  default: { listMembers: (): Promise<void> => new Promise<void>(() => {}) },
}));

/** Every value `isLoadingMembers` held, in render order. */
function loadingPerRender(domainId: string | null): boolean[] {
  const seen: boolean[] = [];
  function Probe(): null {
    const { isLoadingMembers, members } = useDomainMembers(domainId);
    // Record the pair the sidebar actually branches on. An empty list with the
    // flag down is the exact condition that renders "Nobody else is here yet".
    seen.push(isLoadingMembers || members.length > 0);
    return null;
  }
  render(<Probe />);
  return seen;
}

describe('the member list before it has loaded', () => {
  it('never renders as a settled empty list while there is a domain to load', () => {
    const seen: boolean[] = loadingPerRender('office-1');

    expect(seen.length).toBeGreaterThan(0);
    // The FIRST render is the one that reaches the screen first.
    expect(seen[0]).toBe(true);
    // And no later render before the response may drop it either.
    expect(seen.every(Boolean)).toBe(true);
  });

  it('does not claim to be loading when there is no domain to load', () => {
    // The discrimination control: a hook that returned `true` always would
    // satisfy the assertion above and hang a spinner on a workspace with no
    // node selected.
    const seen: boolean[] = loadingPerRender(null);

    expect(seen[0]).toBe(false);
  });
});
