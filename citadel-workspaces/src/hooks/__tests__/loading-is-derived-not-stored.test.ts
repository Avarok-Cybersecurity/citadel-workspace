import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * "Loading" must be derived from the domain, not stored in a flag.
 *
 * A stored flag is one render behind on a domain CHANGE. `activeDomainId`
 * becomes B while the flag is still false from A's completed load, and the
 * effect that would set it true does not run until after paint — so for one
 * frame the sidebar holds an empty list, believes nothing is loading, and says
 * "Nobody else is here yet".
 *
 * That window is exactly what `member-list-loading.spec.ts` was catching: after
 * the first fix it stopped failing all three retries and started failing its
 * FIRST attempt and passing on retry, which is what a one-frame race looks like
 * in a suite with retries. A shard reports green on a retry-pass, so the
 * remaining defect was invisible in the summary and only readable in the ✘/✓
 * markers.
 *
 * Comparing instead of storing closes it by construction. Pinned as source
 * because the property is the ABSENCE of a stored flag — a render test can show
 * the right output for the wrong reason, and would still pass against a flag
 * that happened to be set early enough on that run.
 *
 * ROUND 742 widened this. Deriving the FLAG was not enough, because the LIST was
 * still stored separately: `loadedForDomain` said "A is loaded" while the
 * domain-change effect had emptied `members`, so A -> B -> A rendered "Nobody
 * else is here yet" about a workspace with three members. CI proved it with a
 * single `members:loaded {count: 3}` — the load never ended empty, which is what
 * two earlier fixes had assumed.
 *
 * The invariant is therefore not "the flag is derived" but "the list and the
 * domain it belongs to are ONE value", which makes the disagreement
 * unrepresentable. The last assertion is the one that would have caught it.
 */
const HOOK: string = readFileSync(
  join(process.cwd(), 'src', 'hooks', 'use-domain-members.ts'),
  'utf8',
);

describe('the member-list loading state', () => {
  it('is derived by comparing the loaded domain with the active one', () => {
    expect(HOOK).toMatch(
      /const isLoadingMembers:\s*boolean\s*=\s*activeDomainId !== null && loaded\?\.domain !== activeDomainId/,
    );
  });

  it('is not stored in a flag that an effect flips', () => {
    // The floor and the point: a setter reintroduces the one-frame window.
    expect(HOOK).not.toMatch(/setIsLoadingMembers/);
  });

  it('records the domain an answer belongs to, not merely that one arrived', () => {
    // The domain travels WITH the list, so an answer for A cannot end the load
    // for B, and cannot outlive the list it arrived with.
    expect(HOOK).toMatch(/setLoaded\(\{ domain: activeDomainId, members:/);
  });

  it('does not keep the member list in a second, separately-settable value', () => {
    // The round-742 defect, as a property: any `useState` holding a bare member
    // array is a value that can be emptied while the domain marker stays put,
    // which is precisely the pair that renders "Nobody else is here yet".
    //
    // The list must only ever be reachable through `LoadedMembers`, which
    // carries its domain.
    expect(HOOK).not.toMatch(/useState<WorkspaceMember\[\]>/);
    expect(HOOK).not.toMatch(/setMembers\(/);
  });

  it('derives the list from the loaded domain rather than returning it raw', () => {
    // The other half: even with one stored value, returning `loaded.members`
    // unconditionally would show A's people under B's name during B's load.
    expect(HOOK).toMatch(/loaded !== null && loaded\.domain === activeDomainId \? loaded\.members : NO_MEMBERS/);
  });
});
