/**
 * "No users found" is an answer about the workspace. A search that threw is not
 * one.
 *
 * `UserSearch` left `results` empty when the search failed, and
 * `UserSearchResults` renders an empty `results` with a search term as "No
 * users found" — so somebody looking for a colleague was told they are not in
 * the workspace, on the strength of a question that was never answered.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UserSearchResults } from '../UserSearchResults';
import { createRef } from 'react';

function panel(searchFailed: boolean): JSX.Element {
  return (
    <UserSearchResults
      resultsRef={createRef<HTMLDivElement>()}
      searchTerm="alice"
      loading={false}
      results={[]}
      searchFailed={searchFailed}
      recentUsers={[]}
      enableInvite={false}
      onSelectUser={() => {}}
    />
  );
}

describe('a search that returned nothing', () => {
  it('does not say nobody matched when the search itself failed', () => {
    render(panel(true));

    expect(screen.queryByText(/No users found/i)).toBeNull();
    expect(screen.getByText(/could not be completed/i)).toBeInTheDocument();
    expect(screen.getByText(/Nobody has been ruled out/i)).toBeInTheDocument();
  });

  it('still says nobody matched when the search worked and nobody did', () => {
    // The positive control. Without it, always rendering the failure line would
    // satisfy the test above — and a search that genuinely matches nobody has
    // to say so, or the user keeps retyping the same name.
    render(panel(false));

    expect(screen.getByText(/No users found/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not be completed/i)).toBeNull();
  });
});
