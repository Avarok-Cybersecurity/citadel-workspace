/**
 * The new account's Terms / diagnostics writes, while they are in flight.
 *
 * The re-acceptance prompt asks the server what this member has accepted the moment the workspace
 * has loaded -- the same moment sign-up is recording the acceptance. Asked first, it would show
 * the prompt to someone who has just ticked the box. It waits for these instead.
 */
let inFlight: Promise<void> = Promise.resolve();

export function trackSignupConsent(work: Promise<void>): void {
  inFlight = work;
}

/** Resolves when the sign-up writes started so far have finished (they never reject). */
export function signupConsentSettled(): Promise<void> {
  return inFlight;
}
