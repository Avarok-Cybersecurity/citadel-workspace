/**
 * TEST DOUBLE: the tab, page and glue halves of a runtime, for a test about zones. Such a test mounts no app tab
 * and no app page, so one asked for is a test mounting something it did not mean to, and it says so.
 */
import type { AppZoneHandle, AppZoneRuntime, GlueHandle } from '../../app-zone-environment';

export const NO_TABS: AppZoneRuntime['mountPane'] = (): AppZoneHandle => {
  throw new Error('this zone test mounts no app tab');
};

export const NO_PAGES: AppZoneRuntime['mountPage'] = (): AppZoneHandle => {
  throw new Error('this test mounts no app page');
};

/** The glue half, for the same tests: they bind no first-party app's ports either. */
export const NO_GLUE: AppZoneRuntime['bindGlue'] = (): GlueHandle => {
  throw new Error('this zone test binds no glue app');
};
