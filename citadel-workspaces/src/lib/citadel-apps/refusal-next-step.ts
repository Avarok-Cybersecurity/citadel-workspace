/**
 * What a person can do next about an apps refusal, as data beside its words (refusal-copy.ts):
 * the install modal draws each step as a button, and a general recovery framework can map the
 * same kinds. Every refusal has at least one step, chosen by the refusal alone and whether the
 * person manages apps here; nobody is left at an error with nothing to press.
 *
 * `Unavailable` stays one answer for "does not exist" and "not for you": the steps are the same
 * either way. Someone who manages apps (`AppManage` on the workspace) is told what the answer can
 * mean, since they may see every listing anyway; nobody is told which it was. Pure.
 */
import type { AppsRefusal } from 'citadel-workspace-client-ts';
import type { AppsFailure } from '@/lib/workspace-service/apps-operations';

export type RefusalNextStep =
  /** Send the same request again: the cause may have passed. */
  | { kind: 'retry' }
  /** Back to where to install it and what to allow. */
  | { kind: 'change-choice' }
  /** Copy a message for a workspace admin, prefilled with the app, the place and the answer. */
  | { kind: 'ask-admin' }
  /** Show the install that is already there. */
  | { kind: 'open-installed'; installId: string }
  /** Copy the details for a problem report. */
  | { kind: 'report' };

export interface RefusalGuidance {
  steps: readonly [RefusalNextStep, ...RefusalNextStep[]];
  /** More words for someone who manages apps; null for everyone else. */
  forManagers: string | null;
}

/** What a step's button says. */
export const NEXT_STEP_LABEL: Record<RefusalNextStep['kind'], string> = {
  retry: 'Try again',
  'change-choice': 'Change where or what',
  'ask-admin': 'Copy a request for an admin',
  'open-installed': 'Show the installed app',
  report: 'Copy details for a report',
};

export const UNAVAILABLE_FOR_MANAGERS: string =
  'The server says this when the app is no longer offered to you here, or the page you chose is not there. Choose another page, or report it.';

type Unit = Extract<AppsRefusal, string>;
type Keyed = Exclude<AppsRefusal, string>;
type KeysOf<T> = T extends unknown ? keyof T : never;
type Key = KeysOf<Keyed>;
/** Whose step it is: the person (`change-choice`), an admin, the publisher or the network. */
type Remedy = 'choice' | 'admin' | 'publisher' | 'transient';

const UNIT_REMEDY: Record<Unit | 'Malformed' | 'NoAnswer', Remedy> = {
  Unavailable: 'admin',
  ScopeNotSupported: 'choice',
  ScopeOutsideAudience: 'choice',
  BadSignature: 'publisher',
  ArtifactMismatch: 'publisher',
  VersionNotNewer: 'choice',
  NotActive: 'choice',
  Policy: 'admin',
  NoHost: 'transient',
  HeaderManaged: 'admin',
  ServerFeatureUnavailable: 'admin',
  InstallRequestsNotOffered: 'admin',
  ArtifactUnreachable: 'transient',
  Malformed: 'transient',
  NoAnswer: 'transient',
};

const KEYED_REMEDY: Record<Exclude<Key, 'AlreadyInstalled'>, Remedy> = {
  PermissionRequired: 'admin',
  CapabilityNotGrantable: 'admin',
  FirstPartyOnly: 'choice',
  NotRequested: 'choice',
  RequiredCapabilityLeftOut: 'choice',
  Ungranted: 'choice',
  InvalidManifest: 'publisher',
  Limit: 'admin',
};

function steps(remedy: Remedy, manages: boolean): RefusalGuidance['steps'] {
  switch (remedy) {
    case 'choice': return [{ kind: 'change-choice' }];
    // Someone who manages apps is the admin: a report reaches further than asking themselves.
    case 'admin': return manages ? [{ kind: 'change-choice' }, { kind: 'report' }] : [{ kind: 'ask-admin' }, { kind: 'change-choice' }];
    case 'publisher': return [{ kind: 'report' }];
    case 'transient': return [{ kind: 'retry' }, { kind: 'report' }];
  }
}

/** The steps for `refusal`, for a person who does (`manages`) or does not manage apps here. */
export function refusalNextSteps(refusal: AppsFailure, manages: boolean): RefusalGuidance {
  if (typeof refusal === 'object' && 'AlreadyInstalled' in refusal) {
    return { steps: [{ kind: 'open-installed', installId: refusal.AlreadyInstalled.install_id }], forManagers: null };
  }
  const remedy: Remedy = typeof refusal === 'string' ? UNIT_REMEDY[refusal] : KEYED_REMEDY[Object.keys(refusal)[0] as Exclude<Key, 'AlreadyInstalled'>];
  return { steps: steps(remedy, manages), forManagers: manages && refusal === 'Unavailable' ? UNAVAILABLE_FOR_MANAGERS : null };
}

/** The refusal's name, for a report: the variant, never its words. */
export const refusalCode = (refusal: AppsFailure): string => (typeof refusal === 'string' ? refusal : Object.keys(refusal)[0]);

export interface RefusedInstall {
  appName: string;
  appId: string;
  version: string;
  /** Where it was to be installed, in words (scope-sentence.ts). */
  where: string;
  /** The link that opens this app's listing (app-link.ts `appLinkUrl`). */
  link: string;
  refusal: AppsFailure;
  /** The refusal in words (refusal-copy.ts). */
  copy: string;
}

export const adminRequestText = (r: RefusedInstall): string =>
  `Could you install ${r.appName} ${r.version} for: ${r.where}? It opens here: ${r.link}\nWhen I tried, it said: ${r.copy}`;

export const reportText = (r: RefusedInstall): string =>
  `${r.appName} ${r.version} (${r.appId}) was not installed.\nFor: ${r.where}\nAnswer: ${refusalCode(r.refusal)}\n${r.copy}\nListing: ${r.link}`;
