/**
 * The Installed tab's direct connections: shown only for an install granted a P2P or topic
 * capability; a switch sends this member's whole answer and shows what the server answered; a
 * block names one person, and unblocking takes them off. The kernel is the in-memory fake
 * (src/test/apps-kernel-fake.ts), the modal and the store the production ones.
 */
import { describe, expect, it } from 'vitest';
import { cleanup, fireEvent, renderHook, screen, waitFor, type RenderHookResult } from '@testing-library/react';
import type { AppInstall, AppListing, AppsRequest } from 'citadel-workspace-client-ts';
import { catalogueText, harness, openModal, viewerHolding, type Harness } from './marketplace-harness';
import { installOf, listingOf } from '@/test/app-manifests';
import { adoptPeerForMe } from '@/lib/citadel-apps/peer-for-me';
import { usePeerAnswering } from '@/lib/citadel-apps/peer-answering';

const POOL: AppListing = listingOf({ id: 'com.acme.kanban', name: 'Kanban' });
const P2P: AppInstall = installOf('com.acme.kanban', { SelfOnly: 'alice' }, { id: 'i-p2p', granted: ['ihttp.p2p.serve', 'ihttp.p2p.call', 'group.topic.publish'] });

async function installed(install: AppInstall): Promise<Harness> {
  cleanup();
  adoptPeerForMe([]);
  const h: Harness = harness({ visible: [POOL], installs: [install] }, catalogueText([]));
  openModal(h, viewerHolding(new Set()));
  fireEvent.mouseDown(screen.getByTestId('apps-tab-installed'));
  await screen.findByTestId('apps-installed-row');
  return h;
}
const sent = (h: Harness, name: string): AppsRequest[] => h.kernel.requests.filter((r: AppsRequest) => typeof r === 'object' && name in r);
const ask = (plane: string): HTMLElement => document.querySelector(`[data-testid="apps-peer-ask"][data-plane="${plane}"]`) as HTMLElement;

describe('a member’s direct connections', () => {
  it('are offered only for an install granted P2P or topics (control: granted, they are)', async () => {
    await installed(installOf('com.acme.kanban', { SelfOnly: 'alice' }, { id: 'i-plain', granted: ['storage.user'] }));
    expect(screen.queryByTestId('apps-installed-peer-toggle')).toBeNull();
    await installed(P2P);
    fireEvent.click(screen.getByTestId('apps-installed-peer-toggle'));
    expect(['serve', 'call', 'topics'].map((p: string) => ask(p).dataset.allowed)).toEqual(['null', 'null', 'null']);
    expect(screen.getAllByTestId('apps-peer-disclosure')).toHaveLength(2);
  });

  it('a switch sends the whole answer and shows the server’s', async () => {
    const h: Harness = await installed(P2P);
    fireEvent.click(screen.getByTestId('apps-installed-peer-toggle'));
    fireEvent.click(screen.getByTestId('apps-peer-allow-serve'));
    await waitFor(() => expect(ask('serve').dataset.allowed).toBe('true'));
    expect(sent(h, 'SetPeerConsentForMe')).toEqual([{ SetPeerConsentForMe: { install_id: 'i-p2p', serve: true, call: false, topics: false } }]);
    expect(ask('call').dataset.allowed).toBe('false');
    fireEvent.click(screen.getByTestId('apps-peer-allow-serve'));
    await waitFor(() => expect(ask('serve').dataset.allowed).toBe('false'));
  });

  it('say they are being answered while open, and stop saying so when hidden or gone', async () => {
    // A zone that has not started its app waits while they are open (AppZone.tsx).
    await installed(P2P);
    const answering: RenderHookResult<ReadonlySet<string>, unknown> = renderHook(() => usePeerAnswering());
    expect(answering.result.current.has('i-p2p')).toBe(false);
    fireEvent.click(screen.getByTestId('apps-installed-peer-toggle'));
    expect(answering.result.current.has('i-p2p')).toBe(true);
    fireEvent.click(screen.getByTestId('apps-installed-peer-toggle'));
    expect(answering.result.current.has('i-p2p')).toBe(false);
    fireEvent.click(screen.getByTestId('apps-installed-peer-toggle'));
    expect(answering.result.current.has('i-p2p')).toBe(true);
    cleanup();
    expect(renderHook(() => usePeerAnswering()).result.current.has('i-p2p')).toBe(false);
  });

  it('blocks one person and unblocks them', async () => {
    const h: Harness = await installed(P2P);
    fireEvent.click(screen.getByTestId('apps-installed-peer-toggle'));
    fireEvent.change(screen.getByTestId('apps-peer-block-input'), { target: { value: 'mallory' } });
    fireEvent.click(screen.getByTestId('apps-peer-block'));
    await screen.findByTestId('apps-peer-blocked-row');
    expect(screen.getByTestId('apps-peer-blocked-row').dataset.username).toBe('mallory');
    fireEvent.click(screen.getByTestId('apps-peer-unblock'));
    await screen.findByTestId('apps-peer-blocked-empty');
    expect(sent(h, 'SetPeerBlockedForMe').map((r) => (r as { SetPeerBlockedForMe: { blocked: boolean } }).SetPeerBlockedForMe.blocked)).toEqual([true, false]);
  });
});
