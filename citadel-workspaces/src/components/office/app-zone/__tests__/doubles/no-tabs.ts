/**
 * TEST DOUBLE: the tab and glue halves of a runtime, and the server's answer to a choice, for a test about zones. Such a test mounts no app tab, so
 * one asked for is a test mounting something it did not mean to, and it says so.
 */
import type { PeerConsent } from 'citadel-workspace-client-ts';
import type { ConsentChoice } from '@/lib/citadel-apps/member-consent-types';
import type { AppsResult } from '@/lib/workspace-service/apps-operations';
import type { AppZoneHandle, AppZoneRuntime, GlueHandle, ZoneDataPort } from '../../app-zone-environment';

export const NO_TABS: AppZoneRuntime['mountPane'] = (): AppZoneHandle => {
  throw new Error('this zone test mounts no app tab');
};

/** The glue half, for the same tests: they bind no first-party app's ports either. */
export const NO_GLUE: AppZoneRuntime['bindGlue'] = (): GlueHandle => {
  throw new Error('this zone test binds no glue app');
};

/** The server's answer to a member's P2P and topic choice, for tests that never send one: it is taken as sent. */
export const ANSWER_TAKEN: ZoneDataPort['setPeerConsentForMe'] = async (_installId: string, answer: ConsentChoice): Promise<AppsResult<PeerConsent>> => ({ ok: true, value: { ...answer, at_ms: 1n } });
