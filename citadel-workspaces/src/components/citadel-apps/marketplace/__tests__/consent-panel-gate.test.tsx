/**
 * The consent panel's Install button on a clock: closed before 600 ms however the pointer moves,
 * closed after 600 ms while the pointer has not moved, open once both hold, closed again when the
 * tab is hidden, and closed whatever happens while a required permission cannot be granted.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ConsentPanel } from '../ConsentPanel';
import { listedApps, type ListedApp } from '@/lib/citadel-apps/listing-model';
import { consentRows, type ConsentRow } from '@/lib/citadel-apps/consent-model';
import type { Tri } from '@/lib/citadel-apps/scope-options';
import type { Clock } from '@/lib/cdoc/collab/ports';
import { ManualClock } from '@/lib/cdoc/collab/__tests__/doubles/manual-clock';
import { cap, listingOf } from '@/test/app-manifests';

const APP: ListedApp = listedApps([listingOf({ capabilities: [cap('canvas'), cap('net.server', true, ['api.acme.com', 'sync.acme.com:8443'])] })])[0];
const ROWS: ConsentRow[] = consentRows(APP.manifest, new Set(), { holds: (): Tri => 'yes' }, 'root');

let clock: ManualClock = new ManualClock();
const panel = (problem: string | null = null, on: Clock = clock): ReturnType<typeof render> => render(
  <ConsentPanel app={APP} scopeSentence="Just you" rows={ROWS} onToggle={() => {}} trust={{ kind: 'first-time' }} problem={problem} onInstall={() => {}} onBack={() => {}} clock={on} />,
);
const install = (): HTMLButtonElement => screen.getByTestId('apps-consent-install') as HTMLButtonElement;
const after = (ms: number): void => { act(() => { clock.advance(ms); }); };
const move = (): void => { act(() => { fireEvent.pointerMove(window); }); };
const setVisibility = (state: DocumentVisibilityState): void => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
};

describe('the consent gate', () => {
  afterEach(() => { setVisibility('visible'); clock = new ManualClock(); });

  it('a move inside the first 600 ms opens Install at 600 ms, not before', () => {
    panel();
    move();
    after(599);
    expect(install().disabled).toBe(true);
    after(1);
    expect(install().disabled).toBe(false);
  });

  it('control: 600 ms on screen without a pointer move stays closed', () => {
    panel();
    after(5000);
    expect(install().disabled).toBe(true);
    move();
    expect(install().disabled).toBe(false);
  });

  it('a focus-moving key counts as presence; a letter does not', () => {
    panel();
    after(700);
    act(() => { fireEvent.keyDown(window, { key: 'a' }); });
    expect(install().disabled).toBe(true);
    act(() => { fireEvent.keyDown(window, { key: 'Tab' }); });
    expect(install().disabled).toBe(false);
  });

  it('hiding the tab closes it and starts the 600 ms again', () => {
    panel();
    move();
    after(700);
    expect(install().disabled).toBe(false);
    setVisibility('hidden');
    expect(install().disabled).toBe(true);
    setVisibility('visible');
    move();
    after(599);
    expect(install().disabled).toBe(true);
    after(1);
    expect(install().disabled).toBe(false);
  });

  it('a permission that cannot be granted keeps it closed; control above opens without one', () => {
    panel('You cannot allow this app to read pages.');
    move();
    after(1000);
    expect(install().disabled).toBe(true);
    expect(screen.getByTestId('apps-consent-problem').textContent).toBe('You cannot allow this app to read pages.');
  });

  it('lists each host on its own, the hash, and what it can never do', () => {
    panel();
    expect(screen.getAllByTestId('apps-consent-host').map((h: HTMLElement) => h.textContent)).toEqual(['api.acme.com', 'sync.acme.com:8443']);
    expect(screen.getByTestId('apps-consent-hash').textContent).toBe(APP.manifest.artifact.sha256);
    expect(screen.getByTestId('apps-consent-never').textContent).toContain('Change roles or who may do what');
    expect(screen.getByTestId('apps-consent-trust').textContent).toContain('first');
  });
});

/**
 * A clock whose timers fire only when the test says, with whatever reading the test names: the
 * first read after a fire returns `first`, every later one `then`. That is a timer firing before
 * its clock says the time is up, and time moving on between two reads in one fire.
 */
class HandClock implements Clock {
  private reads: number[] = [0];
  private armed: (() => void)[] = [];
  now(): number { return this.reads.length > 1 ? this.reads.shift() as number : this.reads[0]; }
  after(_ms: number, fn: () => void): () => void {
    this.armed.push(fn);
    return (): void => { this.armed = this.armed.filter((f: () => void) => f !== fn); };
  }
  fire(first: number, then: number = first): void {
    this.reads = [first, then];
    const due: (() => void)[] = this.armed;
    this.armed = [];
    act(() => { for (const fn of due) fn(); });
  }
  get pending(): number { return this.armed.length; }
}

describe('the consent gate when the timer and the clock disagree', () => {
  it('a timer that fires at 599 ms arms again and opens Install at 600', () => {
    const hand: HandClock = new HandClock();
    panel(null, hand);
    move();
    hand.fire(599);
    expect(install().disabled).toBe(true);
    expect(hand.pending).toBe(1);
    hand.fire(600);
    expect(install().disabled).toBe(false);
  });

  it('time that moves on between two reads in one fire still opens Install', () => {
    const hand: HandClock = new HandClock();
    panel(null, hand);
    move();
    hand.fire(599, 600);
    hand.fire(600);
    expect(install().disabled).toBe(false);
  });

  it('two early fires at the same reading still open Install once the time has run', () => {
    const hand: HandClock = new HandClock();
    panel(null, hand);
    move();
    hand.fire(599);
    hand.fire(599);
    expect(install().disabled).toBe(true);
    hand.fire(600);
    expect(install().disabled).toBe(false);
    expect(hand.pending).toBe(0);
  });
});
