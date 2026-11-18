import type { Page } from 'playwright';
import { POST_REGISTRATION_CARD } from './post-registration.js';

/** What the app did with a submitted registration, or that it did nothing within the budget. */
export type RegistrationOutcome = 'initialise-workspace' | 'secure-account' | 'entered-workspace' | 'rejected' | 'none';

/** The one place the post-submit wait lives, so its arms and its budget are named once. */
export const REGISTRATION_OUTCOME_BUDGET_MS = 30_000;

type OutcomePage = Pick<Page, 'locator' | 'getByTestId' | 'waitForURL'>;

/**
 * Wait for the first thing the app does with a submitted registration.
 *
 * `rejected` resolves true when an error toast appeared, false when none did; only `true` ends the
 * wait, because "no toast within 15s" is the ordinary successful case.
 *
 * Never throws: a registration that produced nothing is reported as `none`, with a line naming every
 * signal it waited for, so the caller's later checks are not the first to notice.
 */
export async function awaitRegistrationOutcome(
  page: OutcomePage,
  rejected: Promise<boolean>,
  budgetMs: number,
): Promise<RegistrationOutcome> {
  const started: number = Date.now();
  const arm = (p: Promise<unknown>, outcome: RegistrationOutcome): Promise<RegistrationOutcome> =>
    p.then((): RegistrationOutcome => outcome, (): Promise<never> => new Promise<never>(() => {}));
  const arms: Promise<RegistrationOutcome>[] = [
    arm(page.locator('input#masterPassword').waitFor({ state: 'visible', timeout: budgetMs }), 'initialise-workspace'),
    // Post-quantum sign-in holds a new account on "Secure your account" and navigates only once it
    // is answered, so without this arm every successful registration waited out the whole budget.
    arm(page.getByTestId(POST_REGISTRATION_CARD).waitFor({ state: 'visible', timeout: budgetMs }), 'secure-account'),
    arm(page.waitForURL(/\/(workspace|office)/, { timeout: budgetMs }), 'entered-workspace'),
    rejected.then((r: boolean): Promise<RegistrationOutcome> => (r ? Promise.resolve('rejected') : new Promise<never>(() => {}))),
  ];
  let expire: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<RegistrationOutcome>((resolve) => {
    expire = setTimeout((): void => resolve('none'), budgetMs);
  });
  const outcome: RegistrationOutcome = await Promise.race([...arms, deadline]);
  clearTimeout(expire);
  const elapsed: number = Date.now() - started;
  console.log(
    outcome === 'none'
      ? `  Registration produced no outcome within ${budgetMs}ms (waited for: ${OUTCOME_SIGNALS})`
      : `  Registration answered with ${outcome} after ${elapsed}ms`,
  );
  return outcome;
}

const OUTCOME_SIGNALS = 'the Initialize Workspace modal, the Secure your account card, the workspace route, an error toast';
