/**
 * One app from card to installed, against the kernel fake: the scope picker's gating with its
 * reasons, the consent screen with an optional permission turned off (left out of what is sent),
 * the progress state while the server works, done, and a refusal in words.
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { AppsRequest } from 'citadel-workspace-client-ts';
import { catalogueText, harness, openModal, viewerHolding, type Harness } from './marketplace-harness';
import type { AppListing } from 'citadel-workspace-client-ts';
import { cap, listingOf } from '@/test/app-manifests';
import { CONSENT_VISIBLE_MS } from '@/lib/citadel-apps/consent-gate';

const NOTES: AppListing = listingOf({ id: 'com.acme.notes', name: 'Notes', capabilities: [cap('canvas'), cap('storage.user', true)] }, 'workspace');
const MAY: ReadonlySet<string> = new Set(['AppInstall', 'AppInstallAllowStorage']);

async function toConsent(h: Harness, held: ReadonlySet<string> = MAY): Promise<void> {
  openModal(h, viewerHolding(held));
  fireEvent.mouseDown(screen.getByTestId('apps-tab-workspace'));
  fireEvent.click(await screen.findByTestId('apps-listing-card'));
  fireEvent.click(screen.getByTestId('apps-detail-install'));
  fireEvent.click(screen.getByTestId('apps-scope-self'));
  fireEvent.click(screen.getByTestId('apps-scope-continue'));
  await screen.findByTestId('apps-consent');
}
const install = (): HTMLButtonElement => screen.getByTestId('apps-consent-install') as HTMLButtonElement;
/** The pointer moves, Install stays closed until the panel has been shown 600 ms, then is pressed. */
function pressInstall(h: Harness): void {
  fireEvent.pointerMove(window);
  act(() => { h.clock.advance(CONSENT_VISIBLE_MS - 1); });
  expect(install().disabled).toBe(true);
  act(() => { h.clock.advance(1); });
  expect(install().disabled).toBe(false);
  fireEvent.click(install());
}
const sent = (h: Harness): Extract<AppsRequest, { Install: unknown }>['Install'] | undefined => {
  const r: AppsRequest | undefined = h.kernel.requests.find((q: AppsRequest) => typeof q === 'object' && 'Install' in q);
  return r !== undefined && typeof r === 'object' && 'Install' in r ? r.Install : undefined;
};

describe('the install flow', () => {
  it('the wider choices name what is missing; control: Just for me is offered', async () => {
    const h: Harness = harness({ visible: [NOTES] }, catalogueText([]));
    openModal(h, viewerHolding(new Set(['AppInstall'])));
    fireEvent.mouseDown(screen.getByTestId('apps-tab-workspace'));
    fireEvent.click(await screen.findByTestId('apps-listing-card'));
    fireEvent.click(screen.getByTestId('apps-detail-install'));
    expect((screen.getByTestId('apps-scope-continue') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('apps-scope-wider'));
    expect((screen.getByTestId('apps-scope-workspace') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId('apps-scope-workspace-reason').textContent).toBe('You need “Install apps for others”. Ask a workspace admin.');
    expect(screen.getByTestId('apps-scope-node').closest('li')?.textContent).toContain('Everyone on “Engineering”');
    expect((screen.getByTestId('apps-scope-self') as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByTestId('apps-scope-self-reason')).toBeNull();
  });

  it('installs with an optional permission turned off left out, showing progress, then done', async () => {
    const h: Harness = harness({ visible: [NOTES], permissions: new Set(MAY) }, catalogueText([]));
    await toConsent(h);
    expect(screen.getByTestId('apps-consent-scope').textContent).toBe('Just you');
    await waitFor(() => expect(screen.getByTestId('apps-consent-fingerprint').textContent).not.toBe('…'));
    fireEvent.click(screen.getByTestId('apps-consent-toggle'));
    h.kernel.pause();
    pressInstall(h);
    expect(screen.getByTestId('apps-install-progress').textContent).toContain('Installing Notes…');
    h.kernel.resume();
    expect((await screen.findByTestId('apps-install-done')).textContent).toContain('For: Just you');
    expect(sent(h)).toMatchObject({ app_id: 'com.acme.notes', scope: { SelfOnly: 'alice' }, granted: ['canvas'] });
  });

  it('control: left on, the optional permission is sent', async () => {
    const h: Harness = harness({ visible: [NOTES], permissions: new Set(MAY) }, catalogueText([]));
    await toConsent(h);
    pressInstall(h);
    await screen.findByTestId('apps-install-done');
    expect(sent(h)?.granted).toEqual(['canvas', 'storage.user']);
  });

  it('a refusal reads as words, and Back returns to the choice of scope', async () => {
    const h: Harness = harness({ visible: [NOTES], permissions: new Set(['AppInstall']) }, catalogueText([]));
    await toConsent(h);
    pressInstall(h);
    expect((await screen.findByTestId('apps-install-failed')).textContent).toBe('Notes was not installed. You cannot allow an app to keep its own data for each person.Back');
    fireEvent.click(screen.getByText('Back'));
    await screen.findByTestId('apps-scope-picker');
  });

  it('an answer that does not read is a refusal, not a crash', async () => {
    const h: Harness = harness({ visible: [NOTES], permissions: new Set(MAY) }, catalogueText([]));
    await toConsent(h);
    h.kernel.scripted.push({ Installed: { install: { id: 'x' } } });
    pressInstall(h);
    expect((await screen.findByTestId('apps-install-failed')).textContent).toContain('The server’s answer could not be read.');
  });
});
