/**
 * Every account the suite creates sat out the whole post-submit budget.
 *
 * Shard 1/3 of run 44137617709 created 20 accounts. For each one the gap from
 * "React app ready" to "Post-registration step: key" was 30.7s (41s for the
 * first-user ones, which add a 10s modal wait), while the server logged the
 * account connected about 3s after submit: ~10 of the shard's 22 minutes.
 * The shard ran out of global timeout three seconds into the third account of
 * the group-call spec, which read as a hang there.
 *
 * The wait raced the Initialize Workspace modal and the workspace route. Under
 * post-quantum sign-in the app shows neither: it holds the new account on the
 * "Secure your account" card until that is answered, so the race always lost
 * to its own timeout, and its `.catch(() => {})` said nothing.
 *
 * Fake page: Playwright's Page cannot exist under vitest, and the only thing
 * under test is which on-screen signals end the wait. The fake is a scripted
 * screen -- when each selector becomes visible -- and nothing more.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import { awaitRegistrationOutcome, REGISTRATION_OUTCOME_BUDGET_MS } from '../registration-outcome.js';

type Screen = { appearsAt: Record<string, number>; enteredAt?: number };

function scriptedPage(screen: Screen): Pick<Page, 'locator' | 'getByTestId' | 'waitForURL'> {
  const after = (at: number | undefined, timeout: number): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      if (at !== undefined && at <= timeout) setTimeout(resolve, at);
      else setTimeout(() => reject(new Error(`timeout ${timeout}ms`)), timeout);
    });
  const element = (key: string) => ({
    waitFor: ({ timeout }: { timeout: number }): Promise<void> => after(screen.appearsAt[key], timeout),
  });
  return {
    locator: ((selector: string) => element(selector)) as unknown as Page['locator'],
    getByTestId: ((id: string) => element(`testid=${id}`)) as unknown as Page['getByTestId'],
    waitForURL: ((_url: RegExp, { timeout }: { timeout: number }) => after(screen.enteredAt, timeout)) as unknown as Page['waitForURL'],
  };
}

/** 15s with no toast is the successful case; see account.ts. */
const noToast = (): Promise<boolean> => new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 15_000));

async function settle(page: ReturnType<typeof scriptedPage>, rejected: Promise<boolean>): Promise<{ outcome: string; at: number }> {
  const start: number = Date.now();
  let done: { outcome: string; at: number } | null = null;
  void awaitRegistrationOutcome(page, rejected, REGISTRATION_OUTCOME_BUDGET_MS).then((outcome) => {
    done = { outcome, at: Date.now() - start };
  });
  await vi.advanceTimersByTimeAsync(REGISTRATION_OUTCOME_BUDGET_MS + 1_000);
  if (done === null) throw new Error('the outcome wait outlived its own budget');
  return done;
}

describe('what ends the wait after a registration is submitted', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('the "Secure your account" card, as soon as it shows', async () => {
    // The app never navigates until the card is answered, and shows no modal.
    const page = scriptedPage({ appearsAt: { 'testid=post-registration': 2_500 } });
    const { outcome, at } = await settle(page, noToast());
    expect(outcome).toBe('secure-account');
    expect(at).toBe(2_500);
  });

  it('the workspace route, on a server without post-quantum sign-in', async () => {
    const { outcome, at } = await settle(scriptedPage({ appearsAt: {}, enteredAt: 1_200 }), noToast());
    expect(outcome).toBe('entered-workspace');
    expect(at).toBe(1_200);
  });

  it('the Initialize Workspace modal', async () => {
    const { outcome } = await settle(scriptedPage({ appearsAt: { 'input#masterPassword': 900 } }), noToast());
    expect(outcome).toBe('initialise-workspace');
  });

  it('an error toast', async () => {
    const toast = new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 2_000));
    const { outcome, at } = await settle(scriptedPage({ appearsAt: {} }), toast);
    expect(outcome).toBe('rejected');
    expect(at).toBe(2_000);
  });

  it('says so, naming what it waited for, when nothing happens', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { outcome, at } = await settle(scriptedPage({ appearsAt: {} }), noToast());
    expect(outcome).toBe('none');
    expect(at).toBe(REGISTRATION_OUTCOME_BUDGET_MS);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/no outcome within 30000ms \(waited for: .*Secure your account/));
  });
});
