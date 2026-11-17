/**
 * Coming back to a node you already opened must not say the room is empty.
 *
 * `member-list-loading.spec.ts` failed all three attempts on master and blocked
 * `publish`, which is the job that builds the images production runs. Its own
 * instrumentation refuted the standing hypothesis: exactly ONE `members:loaded`
 * arrived, `{payloadDomainId: workspace-root, activeDomainId: workspace-root,
 * count: 3}`. The load never ended empty, so "an empty payload ended the load"
 * — the theory two previous fixes were aimed at — is wrong.
 *
 * What is left is the pair of values the sidebar branches on disagreeing:
 *
 *   - `loadedForDomain` was set to A when A's members arrived, and NOTHING ever
 *     unset it.
 *   - `members` was cleared by the domain-change effect.
 *
 * So on A -> B -> A, the hook reports `loadedForDomain === activeDomainId`
 * (hence "not loading") while holding an empty list, and `MemberListBody`
 * renders "Nobody else is here yet" about a workspace with three members.
 *
 * Two facts made this hard to see, and both are why the assertion below is
 * shaped the way it is:
 *
 *   1. The spec's DOM capture runs one `evaluate` AFTER the sighting, so it
 *      reported "loading" for a frame that had shown "empty" — the diagnostic
 *      described the state that replaced the defect, not the defect.
 *   2. It is a one-frame window. Reading `result.current` after `renderHook`
 *      measures the settled state, which is correct either way; the sibling
 *      test not-yet-loaded-is-not-empty.test.tsx records the same lesson.
 *
 * So this records the pair on EVERY render and asserts the invariant across all
 * of them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, type RenderResult } from '@testing-library/react';
import type { MembersPayload } from '@/lib/workspace-events';
import type { User as WorkspaceMember } from '@/types/workspace-entities';

vi.mock('@/lib/workspace-service', (): { default: { listMembers: () => Promise<void> } } => ({
  // Resolves: `listMembers` only SENDS. The members arrive on the event below,
  // which is the distinction this whole hook exists to encode.
  default: { listMembers: (): Promise<void> => Promise.resolve() },
}));

/** The live `members:loaded` handler, so the test can deliver a response. */
let deliver: ((payload: MembersPayload) => void) | null = null;

vi.mock('@/lib/workspace-events', (): { workspaceEvents: unknown } => ({
  workspaceEvents: {
    onMemberEvent: (event: string, cb: (payload: MembersPayload) => void): (() => void) => {
      // Only the list: the hook also subscribes to `members:hidden`.
      if (event !== 'members:loaded') return (): void => {};
      deliver = cb;
      return (): void => { deliver = null; };
    },
  },
}));

// `is-for-domain` is a SEPARATE module from the facade above, so it stays real
// and the domain filter under test is the production one.

const { useDomainMembers } = await import('../use-domain-members');

function member(id: string): WorkspaceMember {
  return { id, username: id } as unknown as WorkspaceMember;
}

function payloadFor(domainId: string, members: WorkspaceMember[]): MembersPayload {
  return {
    members,
    domainId,
    connection: { cid: 1n, request_id: 'req' },
  } as MembersPayload;
}

interface Sighting { readonly loading: boolean; readonly count: number; }

describe('a member list for a domain that has already loaded', () => {
  beforeEach((): void => { deliver = null; });

  it('never reports a settled empty list when returning to that domain', (): void => {
    const seen: Sighting[] = [];
    function Probe({ domainId }: { domainId: string | null }): null {
      const { isLoadingMembers, members } = useDomainMembers(domainId);
      seen.push({ loading: isLoadingMembers, count: members.length });
      return null;
    }

    const view: RenderResult = render(<Probe domainId="office-A" />);

    // A's three members arrive. This is the ONLY response in the whole test,
    // matching what CI actually logged.
    expect(deliver, 'the hook must have subscribed to members:loaded').not.toBeNull();
    deliver?.(payloadFor('office-A', [member('m1'), member('m2'), member('m3')]));

    // Everything above is setup; the defect is in what follows.
    seen.length = 0;

    view.rerender(<Probe domainId="office-B" />);
    view.rerender(<Probe domainId="office-A" />);

    expect(seen.length, 'the probe should have rendered').toBeGreaterThan(0);

    // The exact pair `MemberListBody` renders "Nobody else is here yet" for:
    // not loading, and nothing to show.
    const settledEmpty: number = seen.findIndex((s: Sighting): boolean => !s.loading && s.count === 0);
    expect(
      settledEmpty,
      `render #${settledEmpty} reported a settled empty member list for a domain whose ` +
      `three members had already arrived. Renders were: ${JSON.stringify(seen)}`,
    ).toBe(-1);
  });

  it('still reports loading for a domain it has never loaded', (): void => {
    // The discrimination control. A hook that answered "not loading, three
    // members" for every domain would satisfy the assertion above while showing
    // one node's people under another node's name.
    const seen: Sighting[] = [];
    function Probe({ domainId }: { domainId: string | null }): null {
      const { isLoadingMembers, members } = useDomainMembers(domainId);
      seen.push({ loading: isLoadingMembers, count: members.length });
      return null;
    }

    const view: RenderResult = render(<Probe domainId="office-A" />);
    deliver?.(payloadFor('office-A', [member('m1')]));
    seen.length = 0;

    view.rerender(<Probe domainId="office-NEVER-LOADED" />);

    const last: Sighting | undefined = seen[seen.length - 1];
    expect(last?.loading, 'an unvisited domain must read as loading, not as A\'s list').toBe(true);
    expect(last?.count, 'and must not show the previous domain\'s members').toBe(0);
  });
});
