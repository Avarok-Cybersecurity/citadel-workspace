/**
 * The apps requests, against the contract fake of the kernel, both directly and through the
 * production transport (the session's sender and the raw-response event), so the fake and the
 * wire agree. Strict reading: an answer that is not exactly a known shape is a refusal, and an
 * answer about another app or install is not taken for ours.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AppsRequest, PeerForMe } from 'citadel-workspace-client-ts';
import { eventEmitter } from '@/lib/event-emitter';
import type { WorkspaceProtocolRequestTS } from '@/types/workspace-protocol';
import {
  getListing, installApp, listCatalogue, listInstalls, protocolAppsTransport, setDisabledForMe, uninstallApp, type InstallsView,
  type AppsResult, type AppsTransport,
} from '../apps-operations';
import type { ProtocolSender } from '../workspace-operations';
import { FakeAppsKernel, type FakeKernelWorld } from '@/test/apps-kernel-fake';
import { installOf, listingOf, PUBLISHER_KEY } from '@/test/app-manifests';
import { listingOffer } from '@/lib/citadel-apps/listing-offer';
import type { ListingOffer } from 'citadel-workspace-client-ts';

const world = (): FakeKernelWorld => ({
  me: 'alice',
  visible: [listingOf({ id: 'com.acme.kanban' })],
  hidden: [listingOf({ id: 'com.acme.secret', audience: { kind: 'members', usernames: ['bob'] } }, 'workspace')],
  installs: [installOf('com.acme.lint', { SelfOnly: 'alice' })],
  permissions: new Set(['AppInstall', 'AppInstallAllowNodeRead']),
  disabled: new Set(),
});

/** The production transport over a sender whose answers come from the fake, as raw responses. */
function overTheWire(fake: FakeAppsKernel, before: unknown[] = []): AppsTransport {
  const sender: ProtocolSender = {
    currentCid: 7n,
    sendProtocolRequest: vi.fn(async (request: WorkspaceProtocolRequestTS): Promise<void> => {
      const apps: AppsRequest = request.Apps as AppsRequest;
      fake.requests.push(apps);
      for (const raw of [...before, fake.answer(apps)]) setTimeout(() => eventEmitter.emit('workspace:raw-response', { Apps: raw }), 0);
    }),
  };
  return protocolAppsTransport(sender);
}

describe.each([
  ['directly', (f: FakeAppsKernel): AppsTransport => f],
  ['over the wire', (f: FakeAppsKernel): AppsTransport => overTheWire(f)],
])('apps requests, %s', (_how: string, transportOf: (f: FakeAppsKernel) => AppsTransport) => {
  it('lists the catalogue the kernel filtered, and the installs', async () => {
    const fake: FakeAppsKernel = new FakeAppsKernel(world());
    const listings: AppsResult<unknown[]> = await listCatalogue(transportOf(fake));
    expect(listings.ok && listings.value.length).toBe(1);
    const installs: AppsResult<InstallsView> = await listInstalls(transportOf(fake));
    expect(installs.ok && installs.value.installs.length).toBe(1);
    expect(installs.ok && installs.value.disabledForMe).toEqual([]);
  });

  it('turned off for me is the server’s: the next ListInstalls says so, and turning it on again clears it', async () => {
    const fake: FakeAppsKernel = new FakeAppsKernel(world());
    expect(await setDisabledForMe(transportOf(fake), 'install-com.acme.lint', true)).toEqual({ ok: true, value: true });
    const after: AppsResult<InstallsView> = await listInstalls(transportOf(fake));
    expect(after.ok && after.value.disabledForMe).toEqual(['install-com.acme.lint']);
    await setDisabledForMe(transportOf(fake), 'install-com.acme.lint', false);
    const again: AppsResult<InstallsView> = await listInstalls(transportOf(fake));
    expect(again.ok && again.value.disabledForMe).toEqual([]);
  });

  it('a hidden app and a missing one get the same answer', async () => {
    const fake: FakeAppsKernel = new FakeAppsKernel(world());
    expect(await getListing(transportOf(fake), 'com.acme.secret')).toEqual({ ok: false, refusal: 'Unavailable' });
    expect(await getListing(transportOf(fake), 'com.acme.nothing')).toEqual({ ok: false, refusal: 'Unavailable' });
    expect((await getListing(transportOf(fake), 'com.acme.kanban')).ok).toBe(true);
  });

  it('installs for yourself, and is refused a capability the installer may not grant', async () => {
    const fake: FakeAppsKernel = new FakeAppsKernel(world());
    const listing: ListingOffer = listingOffer(listingOf({ id: 'com.acme.kanban' }));
    const base = { appId: 'com.acme.kanban', version: '1.4.0', listing, scope: { SelfOnly: 'alice' }, pinnedPublisherKey: PUBLISHER_KEY, injectRequirement: false } as const;
    expect(await installApp(transportOf(fake), { ...base, granted: ['canvas', 'nodes.read', 'storage.user'] }))
      .toEqual({ ok: false, refusal: { CapabilityNotGrantable: 'storage.user' } });
    const done: AppsResult<{ app_id: string }> = await installApp(transportOf(fake), { ...base, granted: ['canvas', 'nodes.read'] });
    expect(done.ok && done.value.app_id).toBe('com.acme.kanban');
    expect(fake.requests.at(-1)).toEqual({ Install: { app_id: 'com.acme.kanban', version: '1.4.0', listing, scope: { SelfOnly: 'alice' }, granted: ['canvas', 'nodes.read'], pinned_publisher_key: PUBLISHER_KEY, inject_requirement: false } });
    const elsewhere: ListingOffer = listingOffer(listingOf({ id: 'com.acme.kanban', version: '9.9.9' }));
    expect(await installApp(transportOf(fake), { ...base, listing: elsewhere, granted: ['canvas', 'nodes.read'] })).toEqual({ ok: false, refusal: 'Unavailable' });
  });

  it('uninstall states purge_storage, and disable-for-me names the install', async () => {
    const fake: FakeAppsKernel = new FakeAppsKernel(world());
    expect(await uninstallApp(transportOf(fake), 'install-com.acme.lint', true)).toEqual({ ok: true, value: 'install-com.acme.lint' });
    expect(fake.requests.at(-1)).toEqual({ Uninstall: { install_id: 'install-com.acme.lint', purge_storage: true } });
    expect(await setDisabledForMe(transportOf(fake), 'x', true)).toEqual({ ok: false, refusal: 'Unavailable' });
  });
});

describe('answers that are not ours, or not answers', () => {
  it.each([
    ['an unknown variant', { Teleported: {} }],
    ['an extra field', { Catalogue: { listings: [], extra: 1 } }],
    ['a listing of the wrong type', { Catalogue: { listings: [{ source: 'Upload', manifest_bytes: [300], signature: '' }] } }],
    ['an unknown refusal', { Refused: 'Nope' }],
    ['a refusal naming an unknown permission', { Refused: { PermissionRequired: 'BeGod' } }],
    ['a bare string', 'Catalogue'],
  ])('%s is a refusal, not data', async (_why: string, raw: unknown) => {
    const fake: FakeAppsKernel = new FakeAppsKernel(world());
    fake.scripted.push(raw);
    expect(await listCatalogue(fake)).toEqual({ ok: false, refusal: 'Malformed' });
  });

  it('the kernel’s Installs answer carries disabled_for_me and peer_for_me; one without either is not the kernel’s shape', async () => {
    const fake: FakeAppsKernel = new FakeAppsKernel(world());
    const install: unknown = installOf('com.acme.lint', { SelfOnly: 'alice' });
    const peer: PeerForMe = { install_id: 'install-com.acme.lint', consent: { serve: true, call: false, topics: false, at_ms: 5n }, blocked: ['mallory'] };
    fake.scripted.push(
      { Installs: { installs: [install], disabled_for_me: ['install-com.acme.lint'], peer_for_me: [peer] } },
      { Installs: { installs: [install], peer_for_me: [] } },
      { Installs: { installs: [install], disabled_for_me: [] } },
      { Installs: { installs: [install], disabled_for_me: [], peer_for_me: [{ ...peer, consent: { ...peer.consent, at_ms: 5 } }] } },
    );
    expect(await listInstalls(fake)).toEqual({ ok: true, value: { installs: [install], disabledForMe: ['install-com.acme.lint'], peerForMe: [peer] } });
    expect(await listInstalls(fake)).toEqual({ ok: false, refusal: 'Malformed' });
    expect(await listInstalls(fake)).toEqual({ ok: false, refusal: 'Malformed' });
    // A u64 crosses the wasm boundary as a BigInt; a plain number is not the kernel's shape.
    expect(await listInstalls(fake)).toEqual({ ok: false, refusal: 'Malformed' });
  });

  it('control: the same answer, well formed, is data', async () => {
    const fake: FakeAppsKernel = new FakeAppsKernel(world());
    fake.scripted.push({ Catalogue: { listings: [] } });
    expect(await listCatalogue(fake)).toEqual({ ok: true, value: [] });
  });

  it('an answer about another app or install is skipped on the wire', async () => {
    const fake: FakeAppsKernel = new FakeAppsKernel(world());
    const other: unknown = { Listing: { listing: listingOf({ id: 'com.acme.other' }) } };
    expect((await getListing(overTheWire(fake, [other]), 'com.acme.kanban')).ok).toBe(true);
    expect(await uninstallApp(overTheWire(fake, [{ Uninstalled: { install_id: 'someone-else' } }]), 'install-com.acme.lint', false))
      .toEqual({ ok: true, value: 'install-com.acme.lint' });
  });
});
