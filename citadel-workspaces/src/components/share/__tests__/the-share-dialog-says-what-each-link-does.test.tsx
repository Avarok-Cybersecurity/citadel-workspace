/**
 * The share dialog, in each of its states: plain, secure, no permission, limit reached, and the
 * link shown once. The real view, panel and flow hook; the server is the `api` the flow takes as
 * an argument (its I/O boundary), so nothing is module-mocked.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { shareTarget, type ShareTarget } from '@/lib/share/share-target';
import type { SecureLinksApi } from '@/lib/share/secure-links-api';
import type { LinkQuota } from '@/lib/share/link-lifetime';
import type { CreateOutcome, NewSecureLink } from '@/lib/workspace-service/secure-links-operations';
import { ShareLinkDialogView } from '../ShareLinkDialogView';
import { SecureLinkPanel, SECURE_COPY } from '../SecureLinkPanel';
import { SHARE_COPY, secureUnavailableOf } from '../ShareLinkDialog';
import type { ShareMode } from '../ShareModeChoice';
import { useShareLinkFlow, type ShareLinkFlow } from '../use-share-link-flow';

const ORIGIN: string = 'https://app.example';
const TOKEN: string = 'T'.repeat(43);
const TARGET: ShareTarget = shareTarget({ kind: 'node', nodeId: 'n-1', name: 'Design' }, null) as ShareTarget;

type Api = Pick<SecureLinksApi, 'list' | 'create'> & { created: NewSecureLink[] };

function api(quota: LinkQuota, outcome: (link: NewSecureLink) => CreateOutcome): Api {
  const created: NewSecureLink[] = [];
  return {
    created,
    list: async (): ReturnType<SecureLinksApi['list']> => ({ links: [], quota }),
    create: async (link: NewSecureLink): Promise<CreateOutcome> => { created.push(link); return outcome(link); },
  };
}

const ok = (link: NewSecureLink): CreateOutcome => ({
  kind: 'created', token: TOKEN,
  info: { id: 'l1', target: link.target, label: link.label, grants: link.grants, one_time: false, created_ms: 0n, expires_ms: 1n, uses: 0, last_used_ms: null },
});
const FREE: LinkQuota = { live: 3, perMember: 5, pool: 0, poolUsed: 0 };

function Secure({ a, onManage }: { a: Api; onManage: () => void }): JSX.Element {
  const flow: ShareLinkFlow = useShareLinkFlow(TARGET, { api: a, origin: ORIGIN, server: 'work.example.com' });
  return <SecureLinkPanel flow={flow} target={TARGET} members={['bob', 'carol']} roles={[{ id: 'member', name: 'Member' }]} isAdmin onManageLinks={onManage} />;
}

function Dialog({ a, unavailable = null, onManage = vi.fn() }: { a: Api; unavailable?: string | null; onManage?: () => void }): JSX.Element {
  const [mode, setMode] = useState<ShareMode>('plain');
  return (
    <ShareLinkDialogView open onClose={() => {}} targets={[TARGET]} plainLinks={[{ target: TARGET, url: `${ORIGIN}${TARGET.href}` }]}
      plainNote="note" mode={mode} onMode={setMode} secureUnavailable={unavailable}
      secure={mode === 'secure' ? <Secure a={a} onManage={onManage} /> : null} />
  );
}

describe('the share dialog', () => {
  it('plain: the link names where it points, with Copy beside it', () => {
    render(<Dialog a={api(FREE, ok)} />);
    expect((screen.getByTestId('share-plain-link-field') as HTMLInputElement).value).toBe(`${ORIGIN}/workspace?nodeId=n-1`);
    expect(screen.getByTestId('share-plain-link-copy').textContent).toContain('Copy');
    expect(screen.getByText('Anyone with it sees where it points.')).toBeTruthy();
  });

  it('secure: who and how long, the meter, and Create sends the default grant for 24 hours', async () => {
    const a: Api = api(FREE, ok);
    render(<Dialog a={a} />);
    await userEvent.click(screen.getByTestId('share-mode-secure'));
    expect(screen.getByText('Anyone who can see “Design”')).toBeTruthy();
    expect((await screen.findByTestId('share-quota-text')).textContent).toBe('3 of 5 yours');
    await userEvent.click(screen.getByTestId('share-create-secure'));
    await screen.findByTestId('share-secure-created');
    expect(a.created).toEqual([{ target: '/workspace?nodeId=n-1', label: 'Design', grants: [{ NodeViewers: 'n-1' }], lifetime: { Expires: { ttl_ms: 86_400_000n } } }]);
  });

  it('shown once: the secure link carries only the token and the server, with the warning', async () => {
    render(<Dialog a={api(FREE, ok)} />);
    await userEvent.click(screen.getByTestId('share-mode-secure'));
    await userEvent.click(await screen.findByTestId('share-create-secure'));
    const field: HTMLInputElement = (await screen.findByTestId('share-secure-link-field')) as HTMLInputElement;
    expect(field.value).toBe(`${ORIGIN}/?redirect=${TOKEN}&server=work.example.com`);
    expect(field.value).not.toContain('n-1');
    expect(screen.getByTestId('share-shown-once').textContent).toContain('Shown once — copy it now');
    expect(screen.getByTestId('share-status').textContent).toContain('shown once');
  });

  it('a person added from the picker is granted too', async () => {
    Element.prototype.scrollIntoView = (): void => {};
    const a: Api = api(FREE, ok);
    render(<Dialog a={a} />);
    await userEvent.click(screen.getByTestId('share-mode-secure'));
    await userEvent.click(screen.getByTestId('share-add-member'));
    await userEvent.click(screen.getByRole('option', { name: 'carol' }));
    await userEvent.click(await screen.findByTestId('share-create-secure'));
    await screen.findByTestId('share-secure-created');
    expect(a.created[0].grants).toEqual([{ Members: ['carol'] }, { NodeViewers: 'n-1' }]);
  });

  it('one-time: the switch makes a OneTime lifetime', async () => {
    const a: Api = api(FREE, ok);
    render(<Dialog a={a} />);
    await userEvent.click(screen.getByTestId('share-mode-secure'));
    await userEvent.click(screen.getByTestId('share-one-time'));
    await userEvent.click(await screen.findByTestId('share-create-secure'));
    await screen.findByTestId('share-secure-created');
    expect(a.created[0].lifetime).toEqual({ OneTime: { ttl_ms: 86_400_000n } });
  });

  it('no grant left: Create is disabled and says why', async () => {
    render(<Dialog a={api(FREE, ok)} />);
    await userEvent.click(screen.getByTestId('share-mode-secure'));
    await userEvent.click(screen.getByRole('button', { name: 'Remove Anyone who can see “Design”' }));
    expect(screen.getByText(SECURE_COPY.noGrant)).toBeTruthy();
    expect((screen.getByTestId('share-create-secure') as HTMLButtonElement).disabled).toBe(true);
  });

  it('missing permission: Secure is disabled, with the reason', () => {
    const reason: string | null = secureUnavailableOf({ enabled: false, reason: SHARE_COPY.noPermission }, 1, 'work.example.com');
    render(<Dialog a={api(FREE, ok)} unavailable={reason} />);
    expect((screen.getByTestId('share-mode-secure') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('share-secure-unavailable').textContent).toBe(SHARE_COPY.noPermission);
  });

  it('several items: one secure link at a time', () => {
    expect(secureUnavailableOf({ enabled: true, reason: null }, 2, 'work.example.com')).toBe(SHARE_COPY.oneAtATime);
    expect(secureUnavailableOf({ enabled: true, reason: null }, 1, 'work.example.com')).toBeNull();
  });

  it('limit reached on opening: no Create, and the way to manage links', async () => {
    const onManage: () => void = vi.fn<() => void>();
    render(<Dialog a={api({ live: 50, perMember: 50, pool: 100, poolUsed: 100 }, ok)} onManage={onManage} />);
    await userEvent.click(screen.getByTestId('share-mode-secure'));
    await screen.findByTestId('share-limit-reached');
    expect(screen.getByTestId('share-quota-text').textContent).toBe('50 of 50 yours · 100 of 100 shared pool');
    expect(screen.queryByTestId('share-create-secure')).toBeNull();
    expect(screen.getByText(/Manage subscription/)).toBeTruthy();
    await userEvent.click(screen.getByTestId('share-manage-links'));
    expect(onManage).toHaveBeenCalledTimes(1);
  });

  it('limit reached on Create: the server\'s LimitReached is shown, not an error', async () => {
    render(<Dialog a={api(FREE, () => ({ kind: 'limit-reached', perMember: 5, pool: 0 }))} />);
    await userEvent.click(screen.getByTestId('share-mode-secure'));
    await userEvent.click(await screen.findByTestId('share-create-secure'));
    await waitFor(() => expect(screen.getByTestId('share-limit-reached')).toBeTruthy());
  });
});
