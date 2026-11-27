/**
 * A refused install is never a dead end: against the kernel fake, `Unavailable` gives a member a
 * request for an admin with the app's link in it, tells someone who manages apps what it can mean,
 * a passing failure is sent again with the same grant, and "already installed" shows the install.
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { AppListing, AppsRequest } from 'citadel-workspace-client-ts';
import { catalogueText, harness, openModal, viewerHolding, type Harness } from './marketplace-harness';
import { cap, listingOf } from '@/test/app-manifests';
import { CONSENT_VISIBLE_MS } from '@/lib/citadel-apps/consent-gate';
import { UNAVAILABLE_FOR_MANAGERS } from '@/lib/citadel-apps/refusal-next-step';

const NOTES: AppListing = listingOf({ id: 'com.acme.notes', name: 'Notes', capabilities: [cap('canvas')] }, 'workspace');
const MAY: ReadonlySet<string> = new Set(['AppInstall']);

async function refusedWith(h: Harness, answer: unknown, held: ReadonlySet<string> = MAY): Promise<void> {
  openModal(h, viewerHolding(held));
  fireEvent.mouseDown(screen.getByTestId('apps-tab-workspace'));
  fireEvent.click(await screen.findByTestId('apps-listing-card'));
  fireEvent.click(screen.getByTestId('apps-detail-install'));
  fireEvent.click(screen.getByTestId('apps-scope-self'));
  fireEvent.click(screen.getByTestId('apps-scope-continue'));
  await screen.findByTestId('apps-consent');
  h.kernel.scripted.push(answer);
  fireEvent.pointerMove(window);
  act(() => { h.clock.advance(CONSENT_VISIBLE_MS); });
  fireEvent.click(screen.getByTestId('apps-consent-install'));
  await screen.findByTestId('apps-install-failed');
}
const installsSent = (h: Harness): AppsRequest[] => h.kernel.requests.filter((q: AppsRequest) => typeof q === 'object' && 'Install' in q);

describe('after a refused install', () => {
  it('a member who is told Unavailable can copy a request for an admin with the app’s link', async () => {
    const h: Harness = harness({ visible: [NOTES], permissions: new Set(MAY) }, catalogueText([]));
    await refusedWith(h, { Refused: 'Unavailable' });
    expect(screen.getByRole('alert').textContent).toBe('Notes was not installed. This app is not available to you.');
    expect(screen.queryByTestId('apps-install-failed-managers')).toBeNull();
    fireEvent.click(screen.getByTestId('apps-next-ask-admin'));
    expect((await screen.findByTestId('apps-next-copied')).textContent).toBe('Copied. Send it to a workspace admin.');
    expect(h.copied).toHaveLength(1);
    expect(h.copied[0]).toContain('https://work.example/workspace?app=com.acme.notes&v=1.4.0');
    expect(h.copied[0]).toContain('This app is not available to you.');
  });

  it('someone who manages apps is told what Unavailable can mean; control: a member is not', async () => {
    const h: Harness = harness({ visible: [NOTES], permissions: new Set(MAY) }, catalogueText([]));
    await refusedWith(h, { Refused: 'Unavailable' }, new Set([...MAY, 'AppManage']));
    expect(screen.getByTestId('apps-install-failed-managers').textContent).toBe(UNAVAILABLE_FOR_MANAGERS);
    expect(screen.queryByTestId('apps-next-ask-admin')).toBeNull();
    fireEvent.click(screen.getByTestId('apps-next-report-bug'));
    await screen.findByTestId('apps-next-copied');
    expect(h.copied[0]).toContain('Answer: Unavailable');
  });

  it('a download that could not be reached is tried again with the same grant, and installs', async () => {
    const h: Harness = harness({ visible: [NOTES], permissions: new Set(MAY) }, catalogueText([]));
    await refusedWith(h, { Refused: 'ArtifactUnreachable' });
    expect(installsSent(h)).toHaveLength(1);
    fireEvent.click(screen.getByTestId('apps-next-retry'));
    await screen.findByTestId('apps-install-done');
    const [first, second] = installsSent(h);
    expect(second).toEqual(first);
  });

  it('an app installed already is shown among the installed apps', async () => {
    const h: Harness = harness({ visible: [NOTES], permissions: new Set(MAY) }, catalogueText([]));
    await refusedWith(h, { Refused: { AlreadyInstalled: { install_id: 'i-9' } } });
    fireEvent.click(screen.getByTestId('apps-next-installed-app'));
    await waitFor(() => expect(screen.getByTestId('apps-tab-installed').getAttribute('data-state')).toBe('active'));
    expect(screen.queryByTestId('apps-install-failed')).toBeNull();
  });

  it('when the clipboard cannot be reached, the request is shown to copy by hand', async () => {
    const h: Harness = harness({ visible: [NOTES], permissions: new Set(MAY) }, catalogueText([]));
    h.deps.copyText = async (): Promise<void> => { throw new Error('denied'); };
    await refusedWith(h, { Refused: 'Unavailable' });
    fireEvent.click(screen.getByTestId('apps-next-ask-admin'));
    expect((await screen.findByTestId('apps-next-not-copied')).textContent).toContain('com.acme.notes');
  });
});
