/**
 * Every surface's plan, by id. The id type is derived from these keys, never written by hand,
 * and the UX score (scripts/ux-score.mjs) reads this registry.
 */
import { APPS_SURFACES } from './apps';
import { CALENDAR_SURFACES } from './calendar';
import { GENERAL_SURFACES } from './general';
import { SESSION_SURFACES } from './session';
import { TOPIC_SURFACES } from './topic';
import { WAVE1_SURFACES } from './wave1';

export const SURFACES = {
  ...APPS_SURFACES,
  ...SESSION_SURFACES,
  ...TOPIC_SURFACES,
  ...GENERAL_SURFACES,
  ...WAVE1_SURFACES,
  ...CALENDAR_SURFACES,
} as const;

export type SurfaceId = keyof typeof SURFACES;

export type SurfacePlan<S extends SurfaceId> = (typeof SURFACES)[S];
