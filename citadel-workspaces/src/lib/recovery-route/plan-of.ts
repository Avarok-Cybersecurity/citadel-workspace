/**
 * A surface's plan, read from the registry. Apart from recovery.ts so that naming a surface at a
 * call site (`recovery('id', binding)`) does not put the whole registry on the landing path; what
 * draws the plan (RecoveryNotice, the toast's view) loads it with itself.
 */
import { SURFACES, type SurfaceId } from './surfaces';
import type { RecoveryPlan } from './route';

export function planOf(surface: SurfaceId): RecoveryPlan {
  return SURFACES[surface];
}
