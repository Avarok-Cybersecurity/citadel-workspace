/**
 * "We could not load the people here" and "nobody else is here" are different
 * sentences, and the sidebar said the second when it meant the first.
 *
 * `use-domain-members` clears its loading flag when the request to `listMembers`
 * fails, and again when nothing answers within `MEMBER_LOAD_TIMEOUT_MS`. Both
 * leave the list empty, and the section renders an empty list as:
 *
 *     Nobody else is here yet. Invite someone with the share button above…
 *
 * a claim about the workspace, on the strength of a request that never arrived.
 * The hook's own note frames the timeout as a choice between an indefinite
 * spinner and that empty state. There is a third answer.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MembersEmptyState } from '../MembersEmptyState';

describe('what the member list says with nobody to show', () => {
  it('does not claim the room is empty when the list could not be loaded', () => {
    render(<MembersEmptyState unavailable domainId="workspace-root" />);

    expect(screen.queryByText(/Nobody else is here yet/i)).toBeNull();
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByText(/Nobody has been ruled out/i)).toBeInTheDocument();
  });

  it('still says the room is empty when it genuinely is', () => {
    // The positive control. Without it, always rendering the failure line would
    // satisfy the test above — and somebody genuinely alone in a workspace
    // needs to be told how to invite people, not that something went wrong.
    render(<MembersEmptyState unavailable={false} domainId="workspace-root" />);

    expect(screen.getByText(/Nobody else is here yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded/i)).toBeNull();
  });

  it('says whose list it is, on both branches', () => {
    // member-list-loading.spec.ts decides REAL vs STALE FRAME from this
    // attribute. Without it the verdict degrades to "unknown" and the next
    // failure is back to inference. A distinct id per render, so a value
    // carried over from the first render cannot satisfy the second.
    const { unmount } = render(<MembersEmptyState unavailable={false} domainId="office-a" />);
    expect(screen.getByTestId('members-empty').getAttribute('data-domain-id')).toBe('office-a');
    unmount();

    render(<MembersEmptyState unavailable domainId="office-b" />);
    expect(screen.getByTestId('members-unavailable').getAttribute('data-domain-id')).toBe('office-b');
  });
});
