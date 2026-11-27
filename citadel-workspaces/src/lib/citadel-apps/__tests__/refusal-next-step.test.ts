/**
 * Every apps refusal has a next step to press, the same for "does not exist" and "not for you",
 * and someone who manages apps is told more about `Unavailable` (refusal-next-step.ts).
 */
import { describe, expect, it } from 'vitest';
import type { AppsFailure } from '@/lib/workspace-service/apps-operations';
import {
  adminRequestText, linkedAppNextSteps, nextStepId, nextStepLabel, refusalNextSteps, reportText, UNAVAILABLE_FOR_MANAGERS,
  type RefusalNextStep, type RefusedInstall,
} from '../refusal-next-step';

/** One of every variant the kernel sends, and the client's own two. */
const EVERY: readonly AppsFailure[] = [
  'Unavailable', 'ScopeNotSupported', 'ScopeOutsideAudience', 'BadSignature', 'ArtifactMismatch', 'VersionNotNewer',
  'NotActive', 'Policy', 'NoHost', 'HeaderManaged', 'ServerFeatureUnavailable', 'InstallRequestsNotOffered',
  'ArtifactUnreachable', 'Malformed', 'NoAnswer',
  { PermissionRequired: 'AppInstallScoped' }, { CapabilityNotGrantable: 'canvas' }, { FirstPartyOnly: 'documents' },
  { NotRequested: 'canvas' }, { RequiredCapabilityLeftOut: 'canvas' }, { Ungranted: 'canvas' },
  { InvalidManifest: 'bad' }, { Limit: 'installs' }, { AlreadyInstalled: { install_id: 'i-1' } },
];

const kinds = (refusal: AppsFailure, manages: boolean): string[] =>
  refusalNextSteps(refusal, manages).steps.map(nextStepId);

const REFUSED: RefusedInstall = {
  appName: 'synchronized.work', appId: 'work.synchronized.app', version: '0.1.0', where: 'Everyone on “Home”',
  link: 'https://work.example/workspace?app=work.synchronized.app&v=0.1.0', refusal: 'Unavailable', copy: 'This app is not available to you.',
};

describe('the next step after an apps refusal', () => {
  it.each(EVERY.map((r: AppsFailure) => [JSON.stringify(r), r] as const))('%s has a step with a label, for members and managers', (_: string, refusal: AppsFailure) => {
    for (const manages of [false, true]) {
      const steps: readonly RefusalNextStep[] = refusalNextSteps(refusal, manages).steps;
      expect(steps.length).toBeGreaterThan(0);
      for (const step of steps) expect(nextStepLabel(step)).toMatch(/\S/);
    }
  });

  it('a member is sent to an admin for Unavailable and told nothing more', () => {
    expect(kinds('Unavailable', false)).toEqual(['ask-admin', 'fix-input']);
    expect(refusalNextSteps('Unavailable', false).forManagers).toBeNull();
  });

  it('someone who manages apps is told what Unavailable can mean, and may report it', () => {
    expect(kinds('Unavailable', true)).toEqual(['fix-input', 'report-bug']);
    expect(refusalNextSteps('Unavailable', true).forManagers).toBe(UNAVAILABLE_FOR_MANAGERS);
  });

  it('control: no other refusal carries the managers’ words', () => {
    for (const refusal of EVERY.filter((r: AppsFailure) => r !== 'Unavailable')) expect(refusalNextSteps(refusal, true).forManagers).toBeNull();
  });

  it('a passing cause is retried, a publisher’s fault reported, an existing install shown', () => {
    expect(kinds('ArtifactUnreachable', false)).toEqual(['retry', 'report-bug']);
    expect(kinds('NoAnswer', false)[0]).toBe('retry');
    expect(kinds('BadSignature', false)).toEqual(['report-bug']);
    expect(refusalNextSteps({ AlreadyInstalled: { install_id: 'i-1' } }, false).steps).toEqual([{ kind: 'navigate', to: { kind: 'installed-app', installId: 'i-1' } }]);
  });

  it('the request for an admin names the app, the place, the link and the answer', () => {
    const text: string = adminRequestText(REFUSED);
    for (const part of ['synchronized.work 0.1.0', 'Everyone on “Home”', REFUSED.link, REFUSED.copy]) expect(text).toContain(part);
  });

  it('the report names the variant, not only its words', () => {
    expect(reportText({ ...REFUSED, refusal: { PermissionRequired: 'AppInstallScoped' } })).toContain('Answer: PermissionRequired');
  });

  it('a link whose listing did not get through is asked again; one refused goes to an admin', () => {
    expect(linkedAppNextSteps('unreachable', false).steps.map(nextStepId)).toEqual(['retry', 'apps-browse']);
    expect(linkedAppNextSteps('unavailable', false).steps.map(nextStepId)).toEqual(['ask-admin', 'apps-browse']);
    expect(linkedAppNextSteps('unavailable', false).forManagers).toBeNull();
    expect(linkedAppNextSteps('unavailable', true)).toEqual({ steps: [{ kind: 'navigate', to: { kind: 'apps-browse' } }, { kind: 'report-bug' }], forManagers: UNAVAILABLE_FOR_MANAGERS });
  });
});
