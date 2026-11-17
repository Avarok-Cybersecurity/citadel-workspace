/**
 * TEST DOUBLE: the tab and glue halves of a runtime, for a test about zones. Such a test mounts no app tab, so
 * one asked for is a test mounting something it did not mean to, and it says so.
 */
import type { AppZoneHandle, AppZoneRuntime, GlueHandle } from '../../app-zone-environment';

export const NO_TABS: AppZoneRuntime['mountPane'] = (): AppZoneHandle => {
  throw new Error('this zone test mounts no app tab');
};

/** The glue half, for the same tests: they bind no first-party app's ports either. */
export const NO_GLUE: AppZoneRuntime['bindGlue'] = (): GlueHandle => {
  throw new Error('this zone test binds no glue app');
};
