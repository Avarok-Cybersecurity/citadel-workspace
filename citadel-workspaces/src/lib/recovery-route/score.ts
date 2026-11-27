/**
 * The UX score (RECOVERY-DESIGN.md §4.2): the weighted share of cheap ways out, 0 to 100. Pure;
 * scripts/ux-score.mjs feeds it the surface registry and the dead-end gate's candidates.
 *
 *   s: steps ≤ 1 → 1.0 · 2 → 0.6 · ≥ 3 → 0.3 · a dead-end candidate → 0
 *      a wait counts as its `then` route, ×0.9 (time is a cost)
 *   w: page 4 · modal 3 · banner 2 · toast 1 · inline 1, × 1.5 when the cause is ours
 *   A plan whose primary is `acknowledge` is left out: there is nothing to recover.
 *   A dead-end candidate weighs 1 (its presentation and cause are unknown).
 */
import type { Presentation, RecoveryPlan, RecoveryRoute } from './route';
import { stepsOf } from './steps';

const PRESENTATION_WEIGHT: { readonly [K in Presentation]: number } = { page: 4, modal: 3, banner: 2, toast: 1, inline: 1 };

function stepScore(steps: number): number {
  return steps <= 1 ? 1 : steps === 2 ? 0.6 : 0.3;
}

function routeScore(route: RecoveryRoute): number {
  if (route.kind === 'wait') return stepScore(stepsOf(route.then)) * 0.9;
  if (route.kind === 'retry-auto') return stepScore(stepsOf(route.then));
  return stepScore(stepsOf(route));
}

export interface ScoreInput {
  readonly plans: readonly RecoveryPlan[];
  readonly deadEnds: number;
}

export interface Score {
  readonly score: number;
  readonly surfaces: number;
  readonly deadEnds: number;
}

export function uxScore({ plans, deadEnds }: ScoreInput): Score {
  let weighted: number = 0;
  let weights: number = 0;
  let counted: number = 0;
  for (const plan of plans) {
    if (plan.primary.kind === 'acknowledge') continue;
    const weight: number = PRESENTATION_WEIGHT[plan.presentation] * (plan.cause === 'ours' ? 1.5 : 1);
    weighted += weight * routeScore(plan.primary);
    weights += weight;
    counted += 1;
  }
  weights += deadEnds;
  const score: number = weights === 0 ? 100 : Math.round((1000 * weighted) / weights) / 10;
  return { score, surfaces: counted, deadEnds };
}
