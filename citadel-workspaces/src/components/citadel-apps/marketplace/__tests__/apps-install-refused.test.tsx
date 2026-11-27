/**
 * A refused install is never a dead end: against the kernel fake, each refusal is drawn by its
 * surface's plan (recovery-route/surfaces/apps.ts). `Unavailable` asks the admins with the app's
 * link in it and offers every app; someone who manages apps is told what it can mean; a passing
 * failure is sent again by itself with the same grant, and stops when the policy runs out; an
 * unreadable answer is retried by hand and reported to us; "already installed" shows the install.
 * The recovery ports are the only stand-in beyond the kernel fake (fake-ports.ts says why).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { AppListing, AppsRequest } from 'citadel-workspace-client-ts';
import { catalogueText, harness, openModal, viewerHolding, type Harness } from './marketplace-harness';
import { cap, listingOf } from '@/test/app-manifests';
import { CONSENT_VISIBLE_MS } from '@/lib/citadel-apps/consent-gate';
import { UNAVAILABLE_FOR_MANAGERS } from '@/lib/citadel-apps/refused-install';
import { readAppsAnswer, type AppsAnswer } from '@/lib/citadel-apps/wire/apps-answer';
import { recoveryPortsStore } from '@/lib/recovery-route/ports-store';
import { recordingPorts, type PortCall } from '@/lib/recovery-route/__tests__/fake-ports';
import { AppsModal } from '../AppsModal';

const NOTES: AppListing = listingOf({ id: 'com.acme.notes', name: 'Notes', capabilities: [cap('canvas')] }, 'workspace');
const MAY: ReadonlySet<string> = new Set(['AppInstall']);
const UNREACHABLE: unknown = { Refused: 'ArtifactUnreachable' };
let calls: PortCall[] = [];

beforeEach(() => {
  const recorded: ReturnType<typeof recordingPorts> = recordingPorts({ kind: 'sent', admins: 2 });
  calls = recorded.calls;
  recoveryPortsStore.set(recorded.ports);
});
afterEach(() => { recoveryPortsStore.set(null); vi.useRealTimers(); });

async function refusedWith(h: Harness, answers: readonly unknown[], held: ReadonlySet<string> = MAY): Promise<ReturnType<typeof openModal>> {
  const shown: ReturnType<typeof openModal> = openModal(h, viewerHolding(held));
  fireEvent.mouseDown(screen.getByTestId('apps-tab-workspace'));
  fireEvent.click(await screen.findByTestId('apps-listing-card'));
  fireEvent.click(screen.getByTestId('apps-detail-install'));
  fireEvent.click(screen.getByTestId('apps-scope-self'));
  fireEvent.click(screen.getByTestId('apps-scope-continue'));
  await screen.findByTestId('apps-consent');
  h.kernel.scripted.push(...answers);
  fireEvent.pointerMove(window);
  act(() => { h.clock.advance(CONSENT_VISIBLE_MS); });
  fireEvent.click(screen.getByTestId('apps-consent-install'));
  await screen.findByTestId('apps-install-failed');
  return shown;
}
const isInstall = (q: AppsRequest): boolean => typeof q === 'object' && 'Install' in q;
const installsSent = (h: Harness): AppsRequest[] => h.kernel.requests.filter(isInstall);
const controls = (): (string | undefined)[] =>
  [...screen.getByTestId('apps-install-failed').querySelectorAll('button')].map((b: HTMLButtonElement) => b.dataset.testid);
const portArgs = (port: PortCall['port']): (readonly unknown[])[] => calls.filter((c: PortCall) => c.port === port).map((c: PortCall) => c.args);

describe('after a refused install', () => {
  it('a member told Unavailable asks the admins, with the app’s link, and is offered every app', async () => {
    const h: Harness = harness({ visible: [NOTES], permissions: new Set(MAY) }, catalogueText([]));
    const shown: ReturnType<typeof openModal> = await refusedWith(h, [{ Refused: 'Unavailable' }]);
    expect(screen.getByTestId('recovery-apps.Unavailable').textContent).toContain('Notes was not installed. This app is not available to you.');
    expect(screen.queryByTestId('apps-install-failed-managers')).toBeNull();
    expect(controls()).toEqual(['recovery-control-ask-admin', 'recovery-control-navigate']);
    fireEvent.click(screen.getByTestId('recovery-control-ask-admin'));
    expect((await screen.findByTestId('recovery-said')).textContent).toBe('Sent to 2 admins. It is in their Scratchpads.');
    const [[kind, about]] = portArgs('askAdmins');
    expect(kind).toBe('app-access');
    expect(about).toContain('https://work.example/workspace?app=com.acme.notes&v=1.4.0');
    expect(about).toContain('This app is not available to you.');
    fireEvent.click(screen.getByTestId('recovery-control-navigate'));
    expect(portArgs('navigate')).toEqual([['apps-browse']]);
    // What the port does (apps-modal-store): the open modal is asked again to show every app.
    shown.rerender(<AppsModal open onOpenChange={() => {}} request={{ kind: 'browse' }} deps={h.deps} viewer={viewerHolding(MAY)} />);
    await screen.findByTestId('apps-tab-global');
    expect(screen.queryByTestId('apps-install-failed')).toBeNull();
  });

  it('someone who manages apps is told what Unavailable can mean; control: a member is not (above)', async () => {
    const h: Harness = harness({ visible: [NOTES], permissions: new Set(MAY) }, catalogueText([]));
    await refusedWith(h, [{ Refused: 'Unavailable' }], new Set([...MAY, 'AppManage']));
    expect(screen.getByTestId('apps-install-failed-managers').textContent).toBe(UNAVAILABLE_FOR_MANAGERS);
  });

  it('a download that could not be reached is sent again by itself with the same grant, and installs', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const h: Harness = harness({ visible: [NOTES], permissions: new Set(MAY) }, catalogueText([]));
    await refusedWith(h, [UNREACHABLE]);
    expect(screen.getByTestId('recovery-status').textContent).toMatch(/^Trying again \(1 of 3\)/);
    expect(installsSent(h)).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    await screen.findByTestId('apps-install-done');
    const [first, second] = installsSent(h);
    expect(second).toEqual(first);
  });

  it('a download that stays unreachable stops when the policy runs out, and waits for a press', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const h: Harness = harness({ visible: [NOTES], permissions: new Set(MAY) }, catalogueText([]));
    await refusedWith(h, [UNREACHABLE, UNREACHABLE, UNREACHABLE, UNREACHABLE]);
    for (const ms of [2_000, 5_000, 10_000]) await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    await screen.findByTestId('recovery-control-retry');
    expect(installsSent(h)).toHaveLength(4);
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(installsSent(h)).toHaveLength(4);
  });

  it('an answer that cannot be read is tried again by hand, and can be reported to us', async () => {
    const h: Harness = harness({ visible: [NOTES], permissions: new Set(MAY) }, catalogueText([]));
    const kernel: Harness['kernel'] = h.kernel;
    let unreadable: number = 1;
    h.deps.transport = {
      request: async (request: AppsRequest, isOurs: (a: AppsAnswer) => boolean): Promise<AppsAnswer> => {
        if (isInstall(request) && unreadable-- > 0) { kernel.requests.push(request); return readAppsAnswer({ NotAnAnswer: {} }); }
        return kernel.request(request, isOurs);
      },
    };
    await refusedWith(h, []);
    expect(screen.getByTestId('recovery-apps.Malformed')).toBeTruthy();
    expect(controls()).toEqual(['recovery-control-retry', 'recovery-control-report-bug']);
    fireEvent.click(screen.getByTestId('recovery-control-report-bug'));
    expect(portArgs('reportBug')).toEqual([['apps.Malformed']]);
    const retry: HTMLElement = screen.getByTestId('recovery-control-retry');
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry);
    await screen.findByTestId('apps-install-done');
    expect(installsSent(h)).toHaveLength(2);
  });

  it('an app installed already is shown among the installed apps', async () => {
    const h: Harness = harness({ visible: [NOTES], permissions: new Set(MAY) }, catalogueText([]));
    await refusedWith(h, [{ Refused: { AlreadyInstalled: { install_id: 'i-9' } } }]);
    fireEvent.click(screen.getByTestId('recovery-control-acknowledge'));
    await waitFor(() => expect(screen.getByTestId('apps-tab-installed').getAttribute('data-state')).toBe('active'));
    expect(screen.queryByTestId('apps-install-failed')).toBeNull();
  });
});
