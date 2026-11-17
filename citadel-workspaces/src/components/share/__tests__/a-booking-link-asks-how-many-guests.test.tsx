/**
 * The secure half of the share dialog on a booking page: guests from outside are offered, Create
 * waits for how many, a count the server would refuse is said, and a link with guests is never
 * sent one-time (the server refuses it: guests keep access while the link lives). The real panel
 * and flow hook; the server is the `api` the flow takes as an argument, so nothing is mocked.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { shareTarget, type ShareTarget } from '@/lib/share/share-target';
import type { SecureLinksApi } from '@/lib/share/secure-links-api';
import type { CreateOutcome, NewSecureLink } from '@/lib/workspace-service/secure-links-operations';
import { SecureLinkPanel, SECURE_COPY } from '../SecureLinkPanel';
import { GUEST_COPY } from '../BookingGuestsField';
import { useShareLinkFlow, type ShareLinkFlow } from '../use-share-link-flow';

const TARGET: ShareTarget = shareTarget({ kind: 'booking-page', nodeId: 'n-1', host: 'ana', nodeName: 'Platform' }, null) as ShareTarget;

function api(): Pick<SecureLinksApi, 'list' | 'create'> & { created: NewSecureLink[] } {
  const created: NewSecureLink[] = [];
  return {
    created,
    list: async (): ReturnType<SecureLinksApi['list']> => ({ links: [], quota: { live: 0, perMember: 5, pool: 0, poolUsed: 0 } }),
    create: async (link: NewSecureLink): Promise<CreateOutcome> => {
      created.push(link);
      return { kind: 'created', token: 'T'.repeat(43), info: { id: 'l1', target: link.target, label: link.label, grants: link.grants, one_time: false, created_ms: 0n, expires_ms: 1n, uses: 0, last_used_ms: null } };
    },
  };
}

function Panel({ a, target = TARGET }: { a: ReturnType<typeof api>; target?: ShareTarget }): JSX.Element {
  const flow: ShareLinkFlow = useShareLinkFlow(target, { api: a, origin: 'https://app.example', server: 'work.example.com' });
  return <SecureLinkPanel flow={flow} target={target} members={[]} roles={[]} isAdmin={false} onManageLinks={() => {}} />;
}

const create = (): HTMLButtonElement => screen.getByTestId('share-create-secure') as HTMLButtonElement;
const count = (): HTMLInputElement => screen.getByTestId('share-booking-guest-count') as HTMLInputElement;

describe('a booking link', () => {
  it('offers guests only on a booking page', async () => {
    render(<Panel a={api()} target={shareTarget({ kind: 'node', nodeId: 'n-1', name: 'Platform' }, null) as ShareTarget} />);
    await screen.findByTestId('share-quota');
    expect(screen.queryByTestId('share-add-booking-guests')).toBeNull();
  });

  it('waits for how many guests, says a count the server refuses, and sends the one given', async () => {
    const a: Pick<SecureLinksApi, "list" | "create"> & { created: NewSecureLink[]; } = api();
    render(<Panel a={a} />);
    await screen.findByTestId('share-quota');
    await userEvent.click(screen.getByTestId('share-add-booking-guests'));
    expect(screen.getByText(GUEST_COPY.add, { selector: 'span' })).toBeTruthy();
    expect(create().disabled).toBe(true);
    expect(screen.getByText(SECURE_COPY.guestCount)).toBeTruthy();

    for (const refused of ['0', '51']) {
      await userEvent.clear(count());
      await userEvent.type(count(), refused);
      expect(count().getAttribute('aria-invalid'), refused).toBe('true');
      expect(screen.getByText(GUEST_COPY.invalid)).toBeTruthy();
      expect(create().disabled, refused).toBe(true);
    }
    await userEvent.clear(count());
    await userEvent.type(count(), '3');
    expect(count().getAttribute('aria-invalid')).toBe('false');
    expect(create().disabled).toBe(false);
    await userEvent.click(create());
    await screen.findByTestId('share-secure-created');
    expect(a.created).toEqual([{
      target: TARGET.href, label: 'Book ana on Platform',
      grants: [{ NodeViewers: 'n-1' }, { BookingGuest: { node_id: 'n-1', page: 'ana', max_guests: 3 } }],
      lifetime: { Expires: { ttl_ms: 86_400_000n } },
    }]);
  });

  it('is never sent one-time, even when one-time was chosen before the guests', async () => {
    const a: Pick<SecureLinksApi, "list" | "create"> & { created: NewSecureLink[]; } = api();
    render(<Panel a={a} />);
    await screen.findByTestId('share-quota');
    await userEvent.click(screen.getByTestId('share-one-time'));
    await userEvent.click(screen.getByTestId('share-add-booking-guests'));
    const oneTime: HTMLElement = screen.getByTestId('share-one-time');
    expect(oneTime.getAttribute('aria-checked')).toBe('false');
    expect(oneTime.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(SECURE_COPY.oneTimeGuests)).toBeTruthy();
    await userEvent.type(count(), '2');
    await userEvent.click(create());
    await screen.findByTestId('share-secure-created');
    expect(a.created[0].lifetime).toEqual({ Expires: { ttl_ms: 86_400_000n } });
  });
});
