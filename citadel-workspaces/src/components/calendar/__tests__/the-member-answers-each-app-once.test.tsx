/**
 * The member's consent to apps that change their calendar (design §3.8): the prompt shows one app
 * at a time, its three answers each a 44px target; an answer goes to the app it was asked about
 * and the next one is shown; a prompt still open when the Calendar closes lets nothing through.
 * The apps panel lists every remembered answer and takes one back, after which the app is asked
 * again.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { realEngine } from '@/lib/calendar/__tests__/engine-rig';
import { portsRig } from '@/lib/calendar/__tests__/ports-rig';
import type { ConsentAnswer } from '@/lib/calendar/sdk-host';
import { readConsent, saveConsent } from '@/lib/calendar/sdk-store';
import { SdkAppsPanel } from '../SdkAppsPanel';
import { SdkConsentPrompt } from '../SdkConsentPrompt';
import { useSdkConsent, type SdkConsent } from '../use-sdk-consent';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';

const engine: CalendarEngine = realEngine();

function Prompt({ grab }: { grab: (c: SdkConsent) => void }): JSX.Element {
  const consent: SdkConsent = useSdkConsent();
  grab(consent);
  return <SdkConsentPrompt consent={consent} />;
}

describe('the consent prompt', () => {
  it('asks about one app at a time and hands each answer to the app it asked about', async () => {
    let consent: SdkConsent | null = null;
    const { unmount } = render(<Prompt grab={(c): void => { consent = c; }} />);
    const ask = (app: string): Promise<ConsentAnswer> => (consent as unknown as SdkConsent).ask(app);
    let kanban: Promise<ConsentAnswer> = Promise.resolve('unanswered');
    let notes: Promise<ConsentAnswer> = Promise.resolve('unanswered');
    let third: Promise<ConsentAnswer> = Promise.resolve('allow');
    act((): void => { kanban = ask('com.acme.kanban'); notes = ask('com.acme.notes'); third = ask('com.acme.third'); });
    expect(await screen.findByText('Let com.acme.kanban change your calendar?')).toBeTruthy();
    for (const name of ['Refuse', 'Allow once', 'Allow']) expect(screen.getByRole('button', { name }).className).toContain('h-[44px]');

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(await kanban).toBe('allow');
    expect(await screen.findByText('Let com.acme.notes change your calendar?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refuse' }));
    expect(await notes).toBe('refuse');
    unmount();
    expect(await third).toBe('unanswered');
  });
});

describe('the apps panel', () => {
  it('lists each remembered answer, and "Ask again" forgets it', async () => {
    const { ports } = portsRig('amy');
    await saveConsent(ports, engine, 'com.acme.kanban', 'allow');
    await saveConsent(ports, engine, 'com.acme.spam', 'refuse');
    render(<SdkAppsPanel ports={ports} engine={engine} />);
    expect(await screen.findByText('com.acme.kanban · may change your calendar')).toBeTruthy();
    expect(screen.getByText('com.acme.spam · refused')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Ask com.acme.spam again' }));
    expect(await screen.findByText('com.acme.spam will be asked again.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('com.acme.spam · refused')).toBeNull());
    expect(await readConsent(ports, engine, 'com.acme.spam')).toBeNull();
    expect(await readConsent(ports, engine, 'com.acme.kanban')).toBe('allow');
  });
});
