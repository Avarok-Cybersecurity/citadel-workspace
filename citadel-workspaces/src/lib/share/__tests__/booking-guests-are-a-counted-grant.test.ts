/**
 * Booking guests as the share dialog drafts them: a member's booking page is a shareable node
 * target that offers guests; the grant is sent only with a count the server accepts; and the cap
 * is the server's, read from its source so a change on one side only turns this red.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bookingTargetOf } from '@/lib/calendar/booking-link';
import { MAX_BOOKING_GUESTS, bookingIncomplete, describeGrants, draftOf, grantsOf, type GrantDraft } from '../grant-draft';
import { kindOfTarget, shareTarget, validateShareTarget, type ShareTarget } from '../share-target';

const RUST: string = resolve(__dirname, '../../../../../citadel-workspace-types/src/secure_links.rs');

function bookingPage(): ShareTarget {
  const t: ShareTarget | null = shareTarget({ kind: 'booking-page', nodeId: 'n-1', host: 'ana', nodeName: 'Platform' }, null);
  if (t === null) throw new Error('no target');
  return t;
}

function withGuests(maxGuests: number | null): GrantDraft {
  return { ...draftOf({ NodeViewers: 'n-1' }), booking: { nodeId: 'n-1', page: 'ana', maxGuests } };
}

describe('booking guests', () => {
  it('a booking page is a node link to that member’s page, and the one target that offers guests', () => {
    const t: ShareTarget = bookingPage();
    expect(validateShareTarget(t.href)).toBe(true);
    expect(kindOfTarget(t.href)).toBe('node');
    expect(bookingTargetOf(t.href.slice(t.href.indexOf('?')), 'n-1')).toEqual({ node: 'n-1', host: 'ana', typeId: null });
    expect(t.booking).toEqual({ nodeId: 'n-1', page: 'ana' });
    expect(t.defaultGrant).toEqual({ NodeViewers: 'n-1' });
    expect(shareTarget({ kind: 'node', nodeId: 'n-1', name: 'Platform' }, null)?.booking).toBeNull();
  });

  it('sends the grant only with a whole count from 1 to the cap', () => {
    for (const bad of [null, 0, MAX_BOOKING_GUESTS + 1, 2.5, Number.NaN]) {
      expect(bookingIncomplete(withGuests(bad)), String(bad)).toBe(true);
      expect(grantsOf(withGuests(bad)), String(bad)).toEqual([{ NodeViewers: 'n-1' }]);
    }
    for (const good of [1, MAX_BOOKING_GUESTS]) {
      expect(bookingIncomplete(withGuests(good))).toBe(false);
      expect(grantsOf(withGuests(good))).toEqual([{ NodeViewers: 'n-1' }, { BookingGuest: { node_id: 'n-1', page: 'ana', max_guests: good } }]);
    }
    expect(bookingIncomplete(draftOf('Workspace'))).toBe(false);
  });

  it('reads back from a stored link and says how many', () => {
    const grant: { BookingGuest: { node_id: string; page: string; max_guests: number; }; } = { BookingGuest: { node_id: 'n-1', page: 'ana', max_guests: 3 } };
    expect(grantsOf(draftOf(grant))).toEqual([grant]);
    expect(describeGrants([grant], (id: string) => id)).toBe('Up to 3 guests from outside');
    expect(describeGrants([{ BookingGuest: { ...grant.BookingGuest, max_guests: 1 } }], (id: string) => id)).toBe('Up to 1 guest from outside');
  });

  it.skipIf(!existsSync(RUST))(`the cap is the server's (${RUST})`, () => {
    const declared: RegExpMatchArray | null = readFileSync(RUST, 'utf8').match(/pub const MAX_BOOKING_GUESTS: u8 = (\d+);/);
    expect(declared, 'MAX_BOOKING_GUESTS is declared').not.toBeNull();
    expect(Number(declared?.[1])).toBe(MAX_BOOKING_GUESTS);
  });
});
