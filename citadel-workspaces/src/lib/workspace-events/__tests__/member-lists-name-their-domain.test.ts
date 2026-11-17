/**
 * A member list has to say which domain it is for.
 *
 * The workspace protocol carries no request id, and the `Members` response used
 * to carry no domain either — so a response could not be attributed to the
 * request that caused it. Four subscribers each accepted any list that arrived
 * and took last-writer-wins: the sidebar, the admin members tab, the
 * user-search corpus, and the group-call roster.
 *
 * A list fetched for one domain therefore rendered inside another. The admin
 * tab was the dangerous one: it would then send role changes and removals
 * naming ITS entity, with users taken from somebody else's list.
 */

import { describe, it, expect } from 'vitest';
import { isForDomain } from '../is-for-domain';

describe('deciding whether a member list is ours', () => {
  it('accepts a list for the domain we asked about', () => {
    expect(isForDomain('office-1', 'office-1')).toBe(true);
  });

  it('rejects a list for a different domain', () => {
    // The whole defect: this used to be unaskable, so the answer was always yes.
    expect(isForDomain('office-2', 'office-1')).toBe(false);
  });

  it('accepts when the server did not say', () => {
    // A server that predates the field sends no domain. Discarding those would
    // empty every member list in the app against an older server — a filter
    // that silently drops everything is worse than the ambiguity it replaces.
    expect(isForDomain(undefined, 'office-1')).toBe(true);
  });

  it('accepts when the subscriber has no particular domain', () => {
    expect(isForDomain('office-1', undefined)).toBe(true);
  });

  it('is not fooled by a similar id', () => {
    expect(isForDomain('office-1', 'office-10')).toBe(false);
  });
});
