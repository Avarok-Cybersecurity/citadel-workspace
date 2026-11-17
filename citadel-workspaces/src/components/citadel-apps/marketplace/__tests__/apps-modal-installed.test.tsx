/**
 * The Installed tab: uninstalling needs an explicit answer about the app's data (no default) and
 * sends that answer; turning an app off for yourself; an install waiting for consent says why;
 * only the installer or an admin may uninstall.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, type RenderResult } from '@testing-library/react';
import type { AppInstall, AppListing, AppsRequest } from 'citadel-workspace-client-ts';
import { catalogueText, harness, openModal, viewerHolding, type Harness } from './marketplace-harness';
import { installOf, listingOf } from '@/test/app-manifests';
import { adoptDisabledForMe, recordDisabledForMe } from '@/lib/citadel-apps/disabled-for-me';

const KANBAN: AppListing = listingOf({ id: 'com.acme.kanban', name: 'Kanban' });
const MINE: AppInstall = installOf('com.acme.kanban', { SelfOnly: 'alice' }, { id: 'i-1' });

async function installedTab(h: Harness, held: ReadonlySet<string> = new Set()): Promise<RenderResult> {
  const shown: RenderResult = openModal(h, viewerHolding(held));
  fireEvent.mouseDown(screen.getByTestId('apps-tab-installed'));
  await screen.findByTestId('apps-installed-row');
  return shown;
}
const go = (): HTMLButtonElement => screen.getByTestId('apps-uninstall-go') as HTMLButtonElement;
const uninstallSent = (h: Harness): AppsRequest | undefined => h.kernel.requests.find((r: AppsRequest) => typeof r === 'object' && 'Uninstall' in r);

describe('installed apps', () => {
  it('nothing installed says so', async () => {
    openModal(harness({}, catalogueText([])), viewerHolding(new Set()));
    fireEvent.mouseDown(screen.getByTestId('apps-tab-installed'));
    expect((await screen.findByTestId('apps-installed-empty')).textContent).toBe('No apps are installed for you yet.');
  });

  it('uninstall cannot be confirmed until the data question is answered; control: answered, it sends that answer', async () => {
    const h: Harness = harness({ visible: [KANBAN], installs: [MINE] }, catalogueText([]));
    await installedTab(h);
    fireEvent.click(screen.getByTestId('apps-installed-uninstall'));
    expect((screen.getByTestId('apps-uninstall-keep') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('apps-uninstall-purge') as HTMLInputElement).checked).toBe(false);
    expect(go().disabled).toBe(true);
    fireEvent.click(screen.getByTestId('apps-uninstall-purge'));
    expect(go().disabled).toBe(false);
    fireEvent.click(go());
    await waitFor(() => expect(screen.queryByTestId('apps-installed-row')).toBeNull());
    expect(uninstallSent(h)).toEqual({ Uninstall: { install_id: 'i-1', purge_storage: true } });
  });

  it('keeping the data sends purge_storage false', async () => {
    const h: Harness = harness({ visible: [KANBAN], installs: [MINE] }, catalogueText([]));
    await installedTab(h);
    fireEvent.click(screen.getByTestId('apps-installed-uninstall'));
    fireEvent.click(screen.getByTestId('apps-uninstall-keep'));
    fireEvent.click(go());
    await waitFor(() => expect(uninstallSent(h)).toEqual({ Uninstall: { install_id: 'i-1', purge_storage: false } }));
  });

  it('turns an app off for me and on again', async () => {
    const h: Harness = harness({ visible: [KANBAN], installs: [{ ...MINE, id: 'i-toggle' }] }, catalogueText([]));
    await installedTab(h);
    fireEvent.click(screen.getByTestId('apps-installed-toggle'));
    await waitFor(() => expect(screen.getByTestId('apps-installed-toggle').textContent).toBe('Turn on for me'));
    expect(screen.getByTestId('apps-installed-row').textContent).toContain('Turned off for you');
    fireEvent.click(screen.getByTestId('apps-installed-toggle'));
    await waitFor(() => expect(screen.getByTestId('apps-installed-toggle').textContent).toBe('Turn off for me'));
  });

  it('turned off for me survives a reload: the tab forgets, and the server’s ListInstalls says it again', async () => {
    const h: Harness = harness({ visible: [KANBAN], installs: [{ ...MINE, id: 'i-kept' }] }, catalogueText([]));
    const first: RenderResult = await installedTab(h);
    fireEvent.click(screen.getByTestId('apps-installed-toggle'));
    await waitFor(() => expect(screen.getByTestId('apps-installed-toggle').textContent).toBe('Turn on for me'));
    first.unmount();
    adoptDisabledForMe([]);
    await installedTab(h);
    await waitFor(() => expect(screen.getByTestId('apps-installed-toggle').textContent).toBe('Turn on for me'));
    expect(h.kernel.world.disabled).toEqual(new Set(['i-kept']));
  });

  it('control: an install the server does not list as off reads as on after a reload, whatever the tab held', async () => {
    const h: Harness = harness({ visible: [KANBAN], installs: [{ ...MINE, id: 'i-fresh' }] }, catalogueText([]));
    recordDisabledForMe('i-fresh', true);
    await installedTab(h);
    await waitFor(() => expect(screen.getByTestId('apps-installed-toggle').textContent).toBe('Turn off for me'));
  });

  it('an install waiting for consent says what for; checking for updates reports the answer', async () => {
    const waiting: AppInstall = { ...MINE, state: { NeedsConsent: { version: '1.5.0', reason: 'PublisherKeyChanged' } } };
    const h: Harness = harness({ visible: [KANBAN], installs: [waiting] }, catalogueText([]));
    await installedTab(h);
    expect(screen.getByTestId('apps-installed-state').textContent).toBe('Kanban 1.5.0 is signed with a different key; waiting for an admin.');
    fireEvent.click(screen.getByTestId('apps-installed-update'));
    expect((await screen.findByTestId('apps-installed-note')).textContent).toBe('Up to date.');
  });

  it('someone else’s install cannot be uninstalled by a member; control: an admin can', async () => {
    const theirs: AppInstall = { ...MINE, installed_by: 'bob' };
    const member: Harness = harness({ installs: [theirs] }, catalogueText([]));
    const first: RenderResult = await installedTab(member);
    expect((screen.getByTestId('apps-installed-uninstall') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('apps-installed-row').textContent).toContain('Only the person who installed it, or an admin, can uninstall it.');
    first.unmount();
    await installedTab(harness({ installs: [theirs] }, catalogueText([])), new Set(['AppManage']));
    expect((screen.getByTestId('apps-installed-uninstall') as HTMLButtonElement).disabled).toBe(false);
  });
});
