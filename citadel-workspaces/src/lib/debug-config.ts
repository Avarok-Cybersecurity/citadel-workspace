/**
 * Debug utilities for logging — gated by environment.
 *
 * In development (import.meta.env.DEV): all log levels emit to console.
 * In production: only error and warn emit; debug/info are no-ops.
 */

import { redactSecrets } from './redact-secrets';

const isDev: boolean = import.meta.env.DEV;

/** No-op function for suppressed log levels in production. */
const noop = (..._args: unknown[]): void => { /* intentionally empty */ };

/**
 * Log debug messages. Only emits in development.
 */
/**
 * Render a value the console can show.
 *
 * A bare `bigint` argument is printed as `undefined` by Playwright's
 * `consoleMessage.text()` -- measured directly:
 *
 *   console.log('x:', 123n)              ->  "x: undefined"
 *   console.log('x:', { cid: 789n })     ->  "x: {cid: 789n}"
 *
 * Every CID in this app is a bigint, so every log line whose whole purpose was
 * to name one has been reporting `undefined` in every captured run. It is worse
 * than no log line, because it gets believed: "Disconnecting session:
 * undefined" is what an open lead about the wire omitting `cid` was founded on,
 * and the wire had never omitted it.
 *
 * Converted here rather than at eighty call sites, so a line written tomorrow
 * is readable without anybody remembering this.
 */
function printable(value: unknown): unknown {
  if (typeof value === 'bigint') return `${value}n`;
  return redactSecrets(value);
}

/**
 * Whether debug logging is on, for guarding EXPENSIVE arguments.
 *
 * `debugLog` is `noop` in production, but its arguments are still evaluated at
 * the call site -- so `debugLog('x', fnv1a64(bytes))` hashes every byte of
 * every message in production and hands the result to a function that discards
 * it. At the 16 MiB inline transfer cap that is close to a second of
 * main-thread time per call site, for no output.
 *
 * Guard the few sites that do real work; the ~1100 that pass strings do not
 * need this. Rollup drops an `if (debugEnabled)` branch from the production
 * bundle entirely, so the guard costs nothing at runtime.
 */
export const debugEnabled: boolean = isDev;

export const debugLog: (category: string, ...args: unknown[]) => void = isDev
  ? (category, ...args): void => console.log(`[${category}]`, ...args.map(printable))
  : noop;

/**
 * Log error messages. Always emits (errors should always be visible).
 */
export function errorLog(category: string, ...args: unknown[]): void {
  console.error(`[${category}]`, ...args.map(printable));
}

/**
 * Log warning messages. Always emits (warnings should always be visible).
 */
export function warnLog(category: string, ...args: unknown[]): void {
  console.warn(`[${category}]`, ...args.map(printable));
}

/**
 * Whether the first-run onboarding surfaces are shown.
 *
 * Onboarding is for users and hidden from us; internals are the reverse, shown
 * only where someone turned on Dev mode (lib/dev-mode.ts).
 *
 * Off in development, because the integration suite creates an account for
 * almost every spec and each one would then have to click through a tour it is
 * not testing. Account creation already costs 9 UI interactions (11 for the
 * first user, who also initialises the workspace) across two full page loads --
 * see integration-tests/src/lib/account.ts. Onboarding on top of that would be
 * paid ~90 times per suite run to assert nothing.
 *
 * On in production, where a first-time operator has no idea that "Create
 * Account" on a bare address is also how they become the administrator.
 *
 * Forced on in any build by an explicit opt-in, which is how the onboarding
 * specs exercise it without a production build:
 *   - `?onboarding=1` in the URL, or
 *   - `localStorage.setItem('citadel:onboarding', 'true')`
 *
 * And forced OFF by `?onboarding=0`, so a production-mode Playwright run can
 * still create its fixtures cheaply and opt in only for the specs under test.
 * Without that, testing onboarding against a production build would mean every
 * setup account pays for it again.
 */
export function isOnboardingEnabled(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const param: string | null = new URLSearchParams(window.location.search).get('onboarding');
    // The explicit off-switch wins over everything, including production.
    if (param === '0') return false;
    if (param === '1') return true;
    if (window.localStorage.getItem('citadel:onboarding') === 'true') return true;
  } catch {
    // Storage can throw in a sandboxed/partitioned context. Fall through to the
    // environment default rather than treating that as an opt-out.
  }

  return !isDev;
}
