/**
 * What a person reads when the server refuses an apps request. `Unavailable` is one sentence for
 * an app that does not exist and one outside your audience alike, so neither can be told from
 * the other (the kernel answers both the same way, for the same reason).
 */
import type { AppsRefusal } from 'citadel-workspace-client-ts';
import { PERMISSION_LABELS } from '@/lib/permissions-service/types';
import type { AppsFailure } from '@/lib/workspace-service/apps-operations';
import { CAPABILITY_COPY } from './capability-copy';

export const NOT_AVAILABLE_COPY: string = 'This app is not available to you.';

const UNIT_COPY: Record<Extract<AppsRefusal, string>, string> = {
  Unavailable: NOT_AVAILABLE_COPY,
  ScopeNotSupported: 'This app cannot be installed there.',
  ScopeOutsideAudience: 'Some of the people this would reach may not use this app.',
  BadSignature: 'The publisher’s signature does not match this app, so it was not installed.',
  ArtifactMismatch: 'The app’s download did not match what its publisher signed, so it was not installed.',
  VersionNotNewer: 'This version is not newer than the one installed.',
  NotActive: 'This install is not active.',
  Policy: 'The workspace’s policy does not allow this.',
  NoHost: 'Nobody is running this app’s service right now.',
  HeaderManaged: 'The apps header is managed by workspace admins.',
  ServerFeatureUnavailable: 'This workspace’s server does not offer apps yet.',
  InstallRequestsNotOffered: 'This workspace does not take install requests. Send the app’s link to a workspace admin.',
  ArtifactUnreachable: 'The app’s download could not be reached, so nothing was installed. Try again later.',
};

export function refusalCopy(refusal: AppsFailure): string {
  if (refusal === 'Malformed') return 'The server’s answer could not be read. Try again.';
  if (refusal === 'NoAnswer') return 'The server did not answer. Check your connection and try again.';
  if (typeof refusal === 'string') return UNIT_COPY[refusal];
  if ('PermissionRequired' in refusal) return `You need “${PERMISSION_LABELS[refusal.PermissionRequired]}”. Ask a workspace admin.`;
  if ('CapabilityNotGrantable' in refusal) return `You cannot allow an app to ${CAPABILITY_COPY[refusal.CapabilityNotGrantable].label.toLowerCase()}.`;
  if ('FirstPartyOnly' in refusal) return `Only apps published by Avarok may ${CAPABILITY_COPY[refusal.FirstPartyOnly].label.toLowerCase()}.`;
  if ('NotRequested' in refusal) return 'The app did not ask for one of the permissions sent.';
  if ('RequiredCapabilityLeftOut' in refusal) return `The app cannot work without being able to ${CAPABILITY_COPY[refusal.RequiredCapabilityLeftOut].label.toLowerCase()}.`;
  if ('Ungranted' in refusal) return 'The app was not allowed to do that.';
  if ('InvalidManifest' in refusal) return 'The app’s description is not valid, so it cannot be installed.';
  if ('AlreadyInstalled' in refusal) return 'This app is already installed there.';
  return 'A limit was reached, so nothing was changed.';
}
