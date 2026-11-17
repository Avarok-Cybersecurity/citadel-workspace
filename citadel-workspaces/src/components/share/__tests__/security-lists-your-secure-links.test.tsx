/**
 * Settings -> Security -> Secure links: each row says what the link opens, for whom, for how long
 * and how often it was used; Extend, Regenerate (confirmed, new link shown once) and Delete
 * (confirmed) reach the server, and the list is re-read after each. The real list and hook; the
 * server is the `api` the hook takes (its I/O boundary).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SecureLinkInfo } from 'citadel-workspace-client-ts';
import type { SecureLinksApi } from '@/lib/share/secure-links-api';
import type { LinkQuota } from '@/lib/share/link-lifetime';
import { SecureLinksList } from '../SecureLinksSection';
import { useSecureLinks, type SecureLinks } from '../use-secure-links';

const HOUR: number = 3_600_000;
const NOW: number = Date.now();
const link = (over: Partial<SecureLinkInfo>): SecureLinkInfo => ({
  id: 'a', target: '/workspace?nodeId=n-1', label: 'Design', grants: [{ NodeViewers: 'n-1' }], one_time: false,
  created_ms: BigInt(NOW - HOUR), expires_ms: BigInt(NOW + 3 * 24 * HOUR + HOUR), uses: 2, last_used_ms: BigInt(NOW - HOUR), ...over,
});

type Calls = string[];
function server(links: SecureLinkInfo[], quota: LinkQuota): Pick<SecureLinksApi, 'list' | 'extend' | 'regenerate' | 'remove'> & { calls: Calls } {
  const calls: Calls = [];
  let held: SecureLinkInfo[] = links;
  return {
    calls,
    list: async (): ReturnType<SecureLinksApi['list']> => { calls.push('list'); return { links: held, quota }; },
    extend: async (id: string, ttl: bigint): ReturnType<SecureLinksApi['extend']> => { calls.push(`extend ${id} ${ttl}`); return { kind: 'extended', info: held[0] }; },
    regenerate: async (id: string): ReturnType<SecureLinksApi['regenerate']> => { calls.push(`regenerate ${id}`); return { kind: 'regenerated', info: held[0], token: 'N'.repeat(43) }; },
    remove: async (id: string): ReturnType<SecureLinksApi['remove']> => { calls.push(`remove ${id}`); held = held.filter((l) => l.id !== id); return { kind: 'deleted' }; },
  };
}

type TestServer = ReturnType<typeof server>;

function Section({ api }: { api: TestServer }): JSX.Element {
  const links: SecureLinks = useSecureLinks(api, 'https://app.example', 'work.example.com');
  return <SecureLinksList links={links} roleName={(id: string) => (id === 'member' ? 'Member' : id)} />;
}

beforeAll(() => { Element.prototype.scrollIntoView = (): void => {}; });

describe('the Security tab\'s secure links', () => {
  it('a row: label, kind, who, how long, how often', async () => {
    render(<Section api={server([link({}), link({ id: 'b', label: 'Ops chat', target: '/groups/g', grants: [{ Roles: ['member'] }, { Members: ['bob'] }], one_time: true, uses: 0, last_used_ms: null })], { live: 2, perMember: 5, pool: 0, poolUsed: 0 })} />);
    const rows: HTMLElement[] = await screen.findAllByTestId('secure-link-row');
    expect(rows[0].textContent).toContain('Design');
    expect(rows[0].textContent).toContain('Page · Anyone who can see the page');
    expect(within(rows[0]).getByTestId('secure-link-expiry').textContent).toMatch(/^Expires in 3 days · Used 2 times · last /);
    expect(rows[1].textContent).toContain('Group chat · Member · bob');
    expect(within(rows[1]).getByTestId('secure-link-expiry').textContent).toMatch(/^One-time · Expires in 3 days · Not used yet$/);
    expect(screen.getByTestId('security-links-quota-text').textContent).toBe('2 of 5 yours');
  });

  it('Extend sends the chosen preset and re-reads the list', async () => {
    const api: TestServer = server([link({})], { live: 1, perMember: 5, pool: 0, poolUsed: 0 });
    render(<Section api={api} />);
    await userEvent.click(await screen.findByTestId('secure-link-extend'));
    await userEvent.click(screen.getByRole('option', { name: '7 days' }));
    expect(await screen.findByText('Link extended.')).toBeTruthy();
    expect(api.calls).toEqual(['list', `extend a ${7n * 24n * 3_600_000n}`, 'list']);
  });

  it('Regenerate asks first, then shows the new link once', async () => {
    const api: TestServer = server([link({})], { live: 1, perMember: 5, pool: 0, poolUsed: 0 });
    render(<Section api={api} />);
    await userEvent.click(await screen.findByTestId('secure-link-regenerate'));
    expect(api.calls).toEqual(['list']);
    expect(screen.getByText('Make a new link?')).toBeTruthy();
    await userEvent.click(screen.getByTestId('confirm-secure-link-action'));
    const field: HTMLInputElement = (await screen.findByTestId('security-links-fresh-link-field')) as HTMLInputElement;
    expect(field.value).toBe(`https://app.example/?redirect=${'N'.repeat(43)}&server=work.example.com`);
    expect(api.calls).toContain('regenerate a');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByTestId('security-links-fresh')).toBeNull();
  });

  it('Delete asks first, then the row is gone', async () => {
    const api: TestServer = server([link({})], { live: 1, perMember: 5, pool: 0, poolUsed: 0 });
    render(<Section api={api} />);
    await userEvent.click(await screen.findByTestId('secure-link-delete'));
    await userEvent.click(screen.getByTestId('confirm-secure-link-action'));
    expect(await screen.findByTestId('security-links-empty')).toBeTruthy();
    expect(api.calls).toEqual(['list', 'remove a', 'list']);
  });

  it('at the limit, the meter says so and where packs are added', async () => {
    render(<Section api={server([link({})], { live: 12, perMember: 5, pool: 7, poolUsed: 7 })} />);
    expect((await screen.findByTestId('security-links-quota-text')).textContent).toBe('5 of 5 yours · 7 of 7 shared pool');
    expect(screen.getByTestId('security-links-limit').textContent).toContain('Manage subscription');
  });
});
