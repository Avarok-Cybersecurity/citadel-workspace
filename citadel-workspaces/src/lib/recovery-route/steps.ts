/**
 * What each route costs a person, in deliberate actions from the moment the surface appears until
 * they are back on track, assuming the route works (RECOVERY-DESIGN.md §2.2): a click is 1, typing
 * into a field is 1, answering a browser prompt is 1, leaving the app to install something is 2.
 * A wait costs nothing but time, and its deadline bounds that. The one table: the score and the
 * renderer's ordering both read it.
 */
import type { RecoveryRoute, RouteKind } from './route';

export const ROUTE_STEPS: { readonly [K in RouteKind]: number } = {
  'retry-auto': 0,
  wait: 0,
  'claim-session': 1,
  retry: 1,
  reload: 1,
  'apply-update': 1,
  navigate: 1,
  'fix-input': 1,
  'ask-admin': 1,
  acknowledge: 1,
  'report-bug': 2,
  'contact-member': 2,
  'open-setting': 2,
  'grant-permission': 2,
  'sign-in-again': 2,
  'install-agent': 3,
};

/** Steps a route costs once its own fallback is counted: a wait costs what its `then` costs. */
export function stepsOf(route: RecoveryRoute): number {
  if (route.kind === 'wait' || route.kind === 'retry-auto') return ROUTE_STEPS[route.then.kind];
  return ROUTE_STEPS[route.kind];
}
