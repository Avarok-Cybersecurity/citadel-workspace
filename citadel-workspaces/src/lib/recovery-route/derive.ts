/**
 * What a plan offers once the rules nobody writes by hand are applied (RECOVERY-DESIGN.md §2.3):
 * every failure that is ours offers a bug report, so no surface can forget to.
 */
import type { ManualRoute, RecoveryPlan } from './route';

const REPORT_BUG: ManualRoute = { kind: 'report-bug' };

export function alternativesOf(plan: RecoveryPlan): readonly ManualRoute[] {
  const listed: readonly ManualRoute[] = plan.alternatives;
  if (plan.cause !== 'ours') return listed;
  const offered: boolean = plan.primary.kind === 'report-bug' || listed.some((r: ManualRoute): boolean => r.kind === 'report-bug');
  return offered ? listed : [...listed, REPORT_BUG];
}

/** The route a person acts on first: a wait's or an automatic retry's fallback, else the primary. */
export function manualPrimary(plan: RecoveryPlan): ManualRoute {
  const primary: RecoveryPlan['primary'] = plan.primary;
  return primary.kind === 'wait' || primary.kind === 'retry-auto' ? primary.then : primary;
}
