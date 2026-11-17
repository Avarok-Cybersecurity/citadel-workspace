/**
 * The member list for one domain, and whether it is still loading.
 *
 * Extracted from MembersSection, which had grown past the repo's 250-line
 * limit. The three effects belong together — they are one conversation with the
 * server — so lifting them out is structure rather than line-shuffling.
 *
 * The subtlety they encode: `WorkspaceService.listMembers()` resolves when the
 * request has been SENT. The members arrive separately on a `members:loaded`
 * event. Clearing the loading flag in a `finally` on that send therefore ended
 * the load with the list still empty, and the sidebar rendered its empty state —
 * "No members yet. Use the + button to discover peers" — about a workspace that
 * had members and was merely fetching them. That was KNOWN_ISSUES #6.
 */
import { useEffect, useState } from 'react';
import { isForDomain } from '@/lib/workspace-events/is-for-domain';
import WorkspaceService from '@/lib/workspace-service';
import { workspaceEvents, type MembersPayload } from '@/lib/workspace-events';
import { runAsyncSetup } from '@/lib/utils/async-utils';
import { debugLog } from '@/lib/debug-config';
import type { User as WorkspaceMember } from '@/types/workspace-entities';
import { withAccess } from '@/lib/member-access';

/**
 * A reply that never comes must not leave the section spinning forever. Falling
 * back to the empty state after this long is a worse answer than the real list
 * and a better one than an indefinite "Loading members...".
 */
const MEMBER_LOAD_TIMEOUT_MS: number = 15_000;

export interface DomainMembers {
  members: WorkspaceMember[];
  isLoadingMembers: boolean;
  /**
   * The list was asked for and did not arrive — the send failed, or nothing
   * answered within `MEMBER_LOAD_TIMEOUT_MS`.
   *
   * Distinct from an empty list, because the section renders an empty list as
   * "Nobody else is here yet. Invite someone…" — a claim about the workspace,
   * made on the strength of a request that failed. The note on the timeout
   * above frames it as a choice between an indefinite spinner and that empty
   * state; there is a third answer, which is to say what actually happened.
   */
  membersUnavailable: boolean;
  /** An admin has hidden this domain's roster from this user (members:hidden). */
  membersHidden: boolean;
}

/**
 * The list in hand, and WHICH domain it belongs to -- one value, not two.
 *
 * They were separate: `members` and a `loadedForDomain` flag. Nothing ever
 * unset the flag, while the domain-change effect cleared the list, so on
 * A -> B -> A the hook said "loaded, for A" while holding nothing. That pair is
 * exactly what renders "Nobody else is here yet".
 *
 * Keeping them in ONE value makes that state unrepresentable: a list is always
 * accompanied by the domain it is a list OF, so the two cannot drift apart.
 */
interface LoadedMembers {
  readonly domain: string;
  readonly members: WorkspaceMember[];
}

/**
 * Returned when the loaded domain is not the active one. Module-level and
 * frozen so the identity is stable -- a fresh `[]` each render would make
 * `members` a new reference every time and re-fire every dependent effect.
 */
const NO_MEMBERS: WorkspaceMember[] = [];
// Frozen as a statement, not an expression: `Object.freeze([]) as WorkspaceMember[]`
// is a cast from `readonly never[]` that tsc rejects outright. This gets the
// runtime guarantee without weakening the declared type the consumers use.
Object.freeze(NO_MEMBERS);

export function useDomainMembers(activeDomainId: string | null): DomainMembers {
  const [loaded, setLoaded] = useState<LoadedMembers | null>(null);
  /**
   * The domain whose load FAILED, not a bare boolean, for the same reason.
   * A stale `true` would report the previous node's failure against this one.
   */
  const [unavailableFor, setUnavailableFor] = useState<string | null>(null);
  /** The domain whose roster an admin hid, for the same reason as above. */
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);

  // Both DERIVED, in the same render as the domain change -- no effect involved,
  // so there is no frame in which they disagree with `activeDomainId`.
  const isLoadingMembers: boolean = activeDomainId !== null && loaded?.domain !== activeDomainId;
  const members: WorkspaceMember[] =
    loaded !== null && loaded.domain === activeDomainId ? loaded.members : NO_MEMBERS;
  const membersUnavailable: boolean = unavailableFor !== null && unavailableFor === activeDomainId;
  const membersHidden: boolean = hiddenFor !== null && hiddenFor === activeDomainId;

  // The four values `MemberListBody` branches on, logged whenever they settle.
  //
  // member-list-loading.spec.ts still fails its first attempt, and round 747's
  // atomic DOM sample proved the reading trustworthy without explaining it: ONE
  // element carries the testid, the empty state really is on screen, and loading
  // really is absent -- while the only `members:loaded` seen carries three
  // members for the active domain. After round 742 `isLoading === false` should
  // imply `members === loaded.members`, so that combination should be
  // unreachable, and the DOM cannot say which of these actually held.
  //
  // Four hypotheses have been spent on this spec and refuted. This is the datum
  // none of them had. `debugLog` is a no-op in production, so it costs a
  // dev-server render and nothing in a shipped build -- the same channel this
  // hook already uses for `members:loaded`.
  useEffect((): void => {
    debugLog('useDomainMembers', 'state:settled', {
      activeDomainId: activeDomainId ?? '(none)',
      loadedForDomain: loaded?.domain ?? '(none)',
      isLoadingMembers,
      memberCount: members.length,
      membersUnavailable,
    });
  }, [activeDomainId, loaded, isLoadingMembers, members, membersUnavailable]);

  useEffect(() => {
    const domain: string | null = activeDomainId;
    const loadMembers = async (): Promise<void> => {
      if (!domain) return;
      // Nothing is cleared here any more. The previous node's members cannot
      // leak onto this one because `members` is derived from the loaded
      // domain -- clearing was a stored-state workaround for a stored-state
      // problem, and it was the half that ran while the flag stayed behind.
      try {
        await WorkspaceService.listMembers(domain);
      } catch (error) {
        debugLog('useDomainMembers', 'Error loading members:', error);
        // Ends the load for THIS domain with nothing, and says why.
        setLoaded({ domain, members: [] });
        setUnavailableFor(domain);
      }
      // Deliberately NOT cleared here — see the note at the top of this file.
    };
    runAsyncSetup(loadMembers);
  }, [activeDomainId]);

  useEffect(() => {
    const handleMembersLoaded = (payload: MembersPayload): void => {
      // Logged BEFORE the domain filter, so an event that is discarded is as
      // visible as one that is accepted. Three code paths can end a load and
      // two of them set `membersUnavailable`; when neither flag is set and the
      // list is empty, THIS is the path that ran, and the only open question is
      // which event did it. See docs/ROBUSTNESS.md round 724 -- the DOM capture
      // narrowed it to here and could go no further, because the DOM cannot
      // show a payload.
      debugLog('useDomainMembers', 'members:loaded', {
        payloadDomainId: payload.domainId ?? '(none)',
        activeDomainId: activeDomainId ?? '(none)',
        count: payload.members?.length ?? -1,
      });
      // See is-for-domain: a list fetched for another domain used to replace
      // this one.
      //
      // NOT the user-search corpus, though this comment said so for a while.
      // `UserSearch.tsx:99` reads the global `state.members`, written by
      // `useMemberEventSetup` -- which is where that guard was missing, because
      // this comment claimed the role and the guard went where it pointed.
      // This hook backs the sidebar's per-domain member list.
      if (!isForDomain(payload.domainId, activeDomainId ?? undefined)) return;
      if (activeDomainId === null) return;
      // The list and the domain it is for, set together -- the response is what
      // ends the load, for THIS domain specifically.
      // Marked with how each has access: a node's list includes people who
      // reach it through a level above (lib/member-access.ts).
      setLoaded({ domain: activeDomainId, members: withAccess(payload.members ?? [], payload.inheritedFrom ?? {}) });
      setUnavailableFor(null);
      setHiddenFor(null);
    };
    // `onMemberEvent` returns its unsubscribe SYNCHRONOUSLY. It used to be
    // wrapped in `runAsyncSetup(async () => await ...)`, which threw the return
    // value away, so every remount left another live listener behind — and this
    // hook lives in AppLayout's MembersSection, which remounts on every route
    // change. Nothing broke visibly (setState on an unmounted component is a
    // no-op), which is exactly why it accumulated: each members:loaded event ran
    // an ever-growing pile of dead handlers, each retaining a dead closure.
    // `use-domain-call-members` subscribes to this same event and has always
    // returned its unsubscribe; the fix was simply never carried across.
    // MembersTab.tsx had the identical defect.
    return workspaceEvents.onMemberEvent('members:loaded', handleMembersLoaded);
  }, [activeDomainId]);

  // The answer that ends the load when an admin hid the roster: settled, and
  // said to be hidden rather than left to read as "Nobody else is here yet".
  useEffect(() => workspaceEvents.onMemberEvent('members:hidden', ({ domainId }): void => {
    if (activeDomainId === null || domainId !== activeDomainId) return;
    setLoaded({ domain: activeDomainId, members: [] });
    setUnavailableFor(null);
    setHiddenFor(activeDomainId);
  }), [activeDomainId]);

  useEffect(() => {
    if (!isLoadingMembers) return;
    const domain: string | null = activeDomainId;
    const timer: number = window.setTimeout((): void => {
      if (domain === null) return;
      // Not silently empty. Nothing answered, and that is what to say.
      setLoaded({ domain, members: [] });
      setUnavailableFor(domain);
    }, MEMBER_LOAD_TIMEOUT_MS);
    return (): void => window.clearTimeout(timer);
  }, [isLoadingMembers, activeDomainId]);

  return { members, isLoadingMembers, membersUnavailable, membersHidden };
}
