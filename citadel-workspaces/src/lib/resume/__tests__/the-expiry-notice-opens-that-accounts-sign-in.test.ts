/**
 * When a session's resume credential runs out the tab that owns it says so once, and its
 * action opens that account's sign-in. Another tab's session says nothing here.
 *
 * Control: build the notice's link without `open: sign-in`, and the link would switch back to
 * the still-live session instead of signing in.
 */
import { describe, expect, it } from 'vitest';
import { readResumeExpired, resumeExpiredNotice, type ResumeExpiredNotice } from '../expiry-notice';
import { parseAccountLink } from '@/lib/onboarding/account-link';

const OWN: { cid: bigint; username: string; server: string } = { cid: 42n, username: 'alice', server: 'acme.example' };
const wire = (cid: bigint | number): unknown => ({ ResumeCredentialExpired: { cid, valid_until_utc: 1_700_000_000_000n, request_id: null } });

describe('the agent says a resume credential has run out', () => {
  it('is read off the wire, bare or under Response', () => {
    expect(readResumeExpired(wire(42n))).toEqual({ cid: 42n, validUntilUtc: 1_700_000_000_000n });
    expect(readResumeExpired({ Response: wire(42) })).toEqual({ cid: 42n, validUntilUtc: 1_700_000_000_000n });
    for (const other of [null, {}, { ServerReconnected: { cid: 42n } }, { ResumeCredentialExpired: { cid: 'x' } }]) {
      expect(readResumeExpired(other)).toBeNull();
    }
  });

  it('shows the owning tab a notice whose action is that account’s sign-in', () => {
    const notice: ResumeExpiredNotice | null = resumeExpiredNotice({ cid: 42n, validUntilUtc: 1n }, OWN);
    expect(notice).not.toBeNull();
    expect(notice?.title).toBe('Sign in again to stay connected');
    expect(notice?.description).toContain('acme.example');
    expect(notice?.description).toContain('still connected');
    const link: ReturnType<typeof parseAccountLink> = parseAccountLink(new URLSearchParams((notice?.signInPath ?? '').slice(2)));
    expect(link).toEqual({ username: 'alice', server: 'acme.example', open: { kind: 'sign-in' } });
  });

  it('says nothing in a tab whose session is another', () => {
    expect(resumeExpiredNotice({ cid: 7n, validUntilUtc: 1n }, OWN)).toBeNull();
  });
});
