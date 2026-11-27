/**
 * The last surfaces shown and routes taken in this page, for a bug report's "recovery trail"
 * (RECOVERY-DESIGN.md §3.1). Ids and route kinds only: never a message, a name or a CID.
 */
import type { RouteKind } from './route';

export type TrailEvent =
  | { readonly at: number; readonly kind: 'shown'; readonly surface: string }
  | { readonly at: number; readonly kind: 'taken'; readonly surface: string; readonly route: RouteKind };

export const TRAIL_LIMIT: number = 20;

const events: TrailEvent[] = [];

export function recordTrail(event: TrailEvent): void {
  events.push(event);
  if (events.length > TRAIL_LIMIT) events.splice(0, events.length - TRAIL_LIMIT);
}

export function trailSnapshot(): readonly TrailEvent[] {
  return [...events];
}
