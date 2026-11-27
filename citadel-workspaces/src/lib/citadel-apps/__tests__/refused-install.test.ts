/**
 * Every apps refusal is answered by a declared surface, and what that surface's ask-admin sends
 * names the app, the place, its link and the answer, short enough for the server to take it
 * (refused-install.ts, recovery-route/surfaces/apps.ts). Someone who manages apps is told more
 * about `Unavailable`, and about nothing else.
 */
import { describe, expect, it } from 'vitest';
import type { AppsFailure } from '@/lib/workspace-service/apps-operations';
import { askSentence } from '@/lib/admin-requests/words';
import { SURFACES } from '@/lib/recovery-route/surfaces';
import { appsSurface } from '@/lib/recovery-route/surfaces/apps';
import { adminAskAbout, managersLine, UNAVAILABLE_FOR_MANAGERS, type RefusedInstall } from '../refused-install';

/** One of every variant the kernel sends, and the client's own two. */
const EVERY: readonly AppsFailure[] = [
  'Unavailable', 'ScopeNotSupported', 'ScopeOutsideAudience', 'BadSignature', 'ArtifactMismatch', 'VersionNotNewer',
  'NotActive', 'Policy', 'NoHost', 'HeaderManaged', 'ServerFeatureUnavailable', 'InstallRequestsNotOffered',
  'ArtifactUnreachable', 'Malformed', 'NoAnswer',
  { PermissionRequired: 'AppInstallScoped' }, { CapabilityNotGrantable: 'canvas' }, { FirstPartyOnly: 'documents' },
  { NotRequested: 'canvas' }, { RequiredCapabilityLeftOut: 'canvas' }, { Ungranted: 'canvas' },
  { InvalidManifest: 'bad' }, { Limit: 'installs' }, { AlreadyInstalled: { install_id: 'i-1' } },
];

/** The server's limit on an ask (MAX_ADMIN_REQUEST_CHARS in citadel-workspace-types). */
const MAX_ASK_CHARS: number = 600;

const LONG: RefusedInstall = {
  appName: 'synchronized.work — the live task tree of the whole engineering floor', version: '0.1.0',
  where: 'Everyone on “Quarterly planning for the platform and infrastructure teams” and the pages below it',
  link: 'https://work.example/workspace?app=work.synchronized.app&scope=node:0b5f9a1e-6c3d-4d8e-9a77-2f4c1b8e5d60&v=0.1.0',
  copy: 'This app is not available to you.',
};

describe('an apps refusal', () => {
  it.each(EVERY.map((r: AppsFailure) => [JSON.stringify(r), r] as const))('%s has a declared surface', (_: string, refusal: AppsFailure) => {
    expect(SURFACES[appsSurface(refusal)]).toBeDefined();
  });

  it('the admins are asked about the app, the place, the link and the answer, within the server’s limit', () => {
    const about: string = adminAskAbout(LONG);
    for (const part of [`${LONG.appName} ${LONG.version}`, LONG.where, LONG.link, LONG.copy]) expect(about).toContain(part);
    expect([...askSentence('app-access', about)].length).toBeLessThanOrEqual(MAX_ASK_CHARS);
  });

  it('only someone who manages apps is told what Unavailable can mean, and only about Unavailable', () => {
    expect(managersLine('Unavailable', true)).toBe(UNAVAILABLE_FOR_MANAGERS);
    expect(managersLine('Unavailable', false)).toBeNull();
    for (const refusal of EVERY.filter((r: AppsFailure) => r !== 'Unavailable')) expect(managersLine(refusal, true)).toBeNull();
  });
});
