/**
 * The member list must not claim a workspace is empty while it is still loading.
 *
 * `WorkspaceService.listMembers()` only SENDS the request — the members arrive
 * later on a `members:loaded` event — but the sidebar cleared its loading flag
 * in a `finally` attached to that send. For the whole gap between request and
 * response it rendered the definitive empty state: "No members yet. Use the +
 * button to discover peers", about a workspace that had members and was merely
 * fetching them. That is KNOWN_ISSUES #6, which had stood as "needs
 * re-verification".
 *
 * The admin panel's own members tab already did this correctly — it clears
 * loading in the event handler — so the right implementation existed in the
 * codebase and the sidebar simply never got it.
 *
 * Asserting the END state would not catch this: the list is correct a moment
 * later. This samples continuously across the load and fails if the empty state
 * is ever shown, which is the only way a transient wrong answer is visible to a
 * test.
 */
import { expect } from '@playwright/test';
import { adminMemberTest } from '../fixtures/multi-user.fixture.js';
import { hierarchyTree } from '../lib/focused-tree.js';

/**
 * The sidebar's empty state, addressed by TESTID.
 *
 * This was `/No members yet/i`, matched with `getByText`. The sidebar has never
 * rendered that sentence: `MembersEmptyState.tsx` says "Nobody else is here yet.
 * Invite someone with the share button above". The only "No members yet" in the
 * app is `pages/DirectoryTabContent.tsx`, a different screen this spec never
 * opens.
 *
 * So `sawEmptyState` was structurally false and `expect(sawEmptyState).toBe(false)`
 * — the one assertion this spec exists for — could not fail. The loading fix in
 * `MembersSection.tsx` could be reverted whole and this stayed green.
 *
 * A testid rather than copy, because copy is what drifted: the header above still
 * quotes the old sentence as the bug's symptom, which is exactly how a stale
 * locator survives review.
 */
const EMPTY_STATE_TESTID = 'members-empty';

adminMemberTest('the sidebar never reports an empty member list while loading', async ({ admin }) => {
    adminMemberTest.setTimeout(300_000);
    const page = admin.page;

    // Every members:loaded event, in order, as the app saw it.
    //
    // Round 724 captured the DOM at first sighting and got as far as "a
    // members:loaded event arrived carrying an empty list and ended the load" —
    // and no further, because the DOM cannot show a payload. The hook now logs
    // each event BEFORE its domain filter, so a discarded event is as visible as
    // an accepted one. Which of these ended the load is the whole question.
    const memberEvents: string[] = [];
    page.on('console', (m): void => {
        const t: string = m.text();
        // `state:settled` reports the four values MemberListBody branches on,
        // straight from the hook. Round 747's DOM sample was trustworthy and
        // still could not say WHICH state produced the empty branch: after
        // round 742, `isLoading === false` should imply the list is the loaded
        // domain's, and the only `members:loaded` carried three members. One of
        // those two things is not what it appears, and only the hook can say
        // which.
        if (t.includes('members:loaded') || t.includes('state:settled')) memberEvents.push(t.slice(0, 240));
    });

    // Switching nodes re-runs the load, which is what makes this reproducible
    // rather than dependent on catching the initial render.
    const nodes = page.locator('[data-testid^="tree-node-menu-"]');
    await expect(nodes.first(), 'the node tree should render').toBeAttached({ timeout: 60_000 });

    // NOTE: an earlier revision claimed `check-specs-search-for-real-copy.mjs`
    // resolves every spec testid against src/. NO SUCH SCRIPT EXISTS -- a repo-wide
    // search for a gate reading `getByTestId` finds none. The claim asserted a
    // guarantee nothing provided, which matters here more than most places,
    // because this spec's central assertion is a NEGATIVE: if the testid were
    // wrong, `sawEmptyState` would be false forever and the spec would pass
    // vacuously. It already did exactly that once, against `/No members yet/i`,
    // a sentence the sidebar has never rendered.
    //
    // The floor is therefore in the spec itself: `members-empty` must be a
    // testid `MembersEmptyState.tsx` really defines, and that component is its
    // only renderer.

    let sawEmptyState = false;
    let sawMembers = false;

    // Click a different node to trigger a reload, then watch the whole window
    // between request and response.
    // Any node row other than the selection: an ancestor, a peer or a child.
    // The old prefix match also took the peek chevrons (`tree-node-toggle-`),
    // which unfold a peer in place and switch nothing.
    const targets = hierarchyTree(page).locator('[role="treeitem"][aria-selected="false"][data-testid^="tree-node-"]');
    if (await targets.count() > 0) {
        await targets.first().click({ force: true });
    }

    // ONE sample per tick, taken inside a single `evaluate`.
    //
    // The previous shape asked `emptyState.isVisible()` and then, in a SEPARATE
    // round trip, captured the DOM. Those are different moments. It reported
    //   {"loading":"Loading members...","empty":"(absent)"}
    // for a frame it had just seen the empty state in -- describing the state
    // that REPLACED the defect, not the defect. That reading cost a wrong
    // inference (two component instances) and it is why three fixes have been
    // aimed at this spec on the strength of code-reading rather than evidence.
    //
    // Sampling in one synchronous turn removes the race from the MEASUREMENT,
    // which has to happen before any further claim about the CODE.
    //
    // `matchCount` is the discriminator. MemberListBody renders exactly one of
    // its four branches, so "loading present AND empty present" is impossible
    // for a single instance. If it is ever > 1, two MembersSections are mounted
    // and the bug is in the layout, not the hook. Playwright's own
    // `getByTestId(...).isVisible()` cannot answer this: it throws on a
    // multi-element match, and the throw was being swallowed by `.catch(() => false)`.
    interface Sample {
        readonly emptyVisible: boolean;
        readonly matchCount: number;
        readonly loading: string;
        readonly empty: string;
        readonly unavailable: string;
        readonly memberRows: number;
        readonly peerRows: number;
        readonly usernameVisible: boolean;
        readonly url: string;
        // WHOSE list the empty state belongs to (MembersEmptyState stamps it),
        // and the node the URL names. Equal: a real false "empty". Different:
        // a stale frame from the node being left. Round 749's evidence pointed
        // at the second; this records it instead of inferring it.
        readonly emptyDomain: string;
        readonly urlNodeId: string;
    }

    const sampleOnce = async (): Promise<Sample> => page.evaluate(
        ({ name, testid }: { name: string; testid: string }): Sample => {
        const visible = (el: Element | null): boolean =>
            el instanceof HTMLElement
            && el.getClientRects().length > 0
            && getComputedStyle(el).visibility !== 'hidden';
        const text = (sel: string): string =>
            document.querySelector(sel)?.textContent?.trim().slice(0, 60) ?? '(absent)';
        const empties = document.querySelectorAll(`[data-testid="${testid}"]`);
        return {
            emptyVisible: Array.from(empties).some(visible),
            matchCount: empties.length,
            loading: text('[data-testid="members-loading"]'),
            empty: text(`[data-testid="${testid}"]`),
            unavailable: text('[data-testid="members-unavailable"]'),
            memberRows: document.querySelectorAll('[data-testid^="member-row-"]').length,
            peerRows: document.querySelectorAll('[data-testid^="peer-row-"]').length,
            usernameVisible: Array.from(document.querySelectorAll('body *'))
                .some((e: Element): boolean => e.children.length === 0
                    && (e.textContent ?? '').includes(name) && visible(e)),
            url: window.location.href,
            emptyDomain: document.querySelector(`[data-testid="${testid}"]`)
                ?.getAttribute('data-domain-id') ?? '(absent)',
            // No nodeId is the workspace view, whose list the sidebar loads for
            // the root (MembersSection); '(none)' would read a root empty state
            // as a STALE FRAME.
            urlNodeId: new URL(window.location.href).searchParams.get('nodeId') ?? 'workspace-root',
        };
    }, { name: admin.username, testid: EMPTY_STATE_TESTID });

    let atFirstSighting = '';
    let firstSighting: Sample | null = null;
    for (let i = 0; i < 100; i++) {
        const s: Sample = await sampleOnce();
        // A stale frame -- the empty state stamped with the node being LEFT while the URL
        // already names the next -- is that node's own, correct state, still on screen
        // because the router runs navigations as transitions (`v7_startTransition`) and
        // keeps the old view until the new one commits. Rounds 747-762 recorded it every
        // time this failed; it is not the defect. The defect is an empty state for the
        // node the URL names, while its list is still loading.
        if (s.emptyVisible && (s.emptyDomain === s.urlNodeId || s.emptyDomain === '(absent)')) {
            if (!sawEmptyState) { atFirstSighting = JSON.stringify(s); firstSighting = s; }
            sawEmptyState = true;
        }
        if (s.usernameVisible) {
            sawMembers = true;
            break;
        }
        await page.waitForTimeout(100);
    }

    // The discriminator, asserted rather than merely reported.
    //
    // MemberListBody returns exactly ONE of its four branches, so a single
    // mounted instance can never show "loading" and "empty" at the same time.
    // The old diagnostic appeared to show precisely that, and the reason could
    // be either (a) the two-round-trip race above, or (b) two MembersSections
    // mounted at once. Counting the matches settles it, and Playwright's
    // `getByTestId(...).isVisible()` could not: it THROWS on a multi-element
    // match, and that throw was swallowed by `.catch(() => false)` -- so the
    // two-instance case was being silently reported as "no empty state".
    const finalSample: Sample = await sampleOnce();
    expect(
        finalSample.matchCount,
        `${finalSample.matchCount} elements carry data-testid="${EMPTY_STATE_TESTID}". ` +
        'More than one means two member lists are mounted, and the defect is in the ' +
        'layout rather than in use-domain-members.',
    ).toBeLessThanOrEqual(1);

    expect(
        sawMembers,
        `the member list never showed ${admin.username}; the workspace has at least this one member`,
    ).toBe(true);
    expect(
        sawEmptyState,
        `${verdictOf(firstSighting)}\n` +
        'the sidebar said "No members yet" while the member list was still loading. ' +
        `At the first sighting the DOM held: ${atFirstSighting}` +
        `\nhook events, in order (members:loaded and state:settled): ${
            memberEvents.length ? memberEvents.join('\n  ') : '(none — so NO event ended the load, and the path is elsewhere)'
        }`,
    ).toBe(false);
});

/** One line a CI log reader can act on without reinterpreting the sample. */
// Structural rather than `Sample`: that interface is declared inside the test
// body, and this needs only the two fields that decide the verdict.
function verdictOf(
    first: { readonly emptyDomain: string; readonly urlNodeId: string } | null,
): string {
    if (first === null) return 'VERDICT: no empty state was sampled';
    if (first.emptyDomain === '(absent)') {
        return 'VERDICT: unknown -- the empty state carried no data-domain-id';
    }
    return first.emptyDomain === first.urlNodeId
        ? `VERDICT: REAL -- the empty list belonged to ${first.urlNodeId}, the node the URL names`
        : `VERDICT: STALE FRAME -- the empty list belonged to ${first.emptyDomain} while the URL `
          + `already named ${first.urlNodeId}; the list lags the navigation by a render`;
}
