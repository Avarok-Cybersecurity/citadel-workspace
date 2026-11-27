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

/**
 * The kinds and payload names are the recovery design's (`RecoveryRoute` in RECOVERY-DESIGN.md
 * §2.1), so a general recovery framework takes these over by kind.
 */
export type RefusalNextStep =
  /** Send the same request again: the cause may have passed. */
  | { kind: 'retry' }
  /** Back to where to install it and what to allow. */
  | { kind: 'fix-input'; field: 'install-choice' }
  /** Copy a message for a workspace admin, prefilled with the app, the place and the answer. */
  | { kind: 'ask-admin'; request: { kind: 'app-access' } }
  /** The install that is already there, or every app. */
  | { kind: 'navigate'; to: { kind: 'installed-app'; installId: string } | { kind: 'apps-browse' } }
  /** Copy the details for a problem report. */
  | { kind: 'report-bug' };

export interface RefusalGuidance {
  steps: readonly [RefusalNextStep, ...RefusalNextStep[]];
  /** More words for someone who manages apps; null for everyone else. */
  forManagers: string | null;
}

/** What a step's button says. */
export function nextStepLabel(step: RefusalNextStep): string {
  switch (step.kind) {
    case 'retry': return 'Try again';
    case 'fix-input': return 'Change where or what';
    case 'ask-admin': return 'Copy a request for an admin';
    case 'navigate': return step.to.kind === 'installed-app' ? 'Show the installed app' : 'See all apps';
    case 'report-bug': return 'Copy details for a report';
  }
}

/** A step's test id suffix: its kind, or its destination for a navigation. */
export const nextStepId = (step: RefusalNextStep): string => (step.kind === 'navigate' ? step.to.kind : step.kind);

export const UNAVAILABLE_FOR_MANAGERS: string =
  'The server says this when the app is no longer offered to you here, or the page you chose is not there. Choose another page, or report it.';

type Unit = Extract<AppsRefusal, string>;
type Keyed = Exclude<AppsRefusal, string>;
type KeysOf<T> = T extends unknown ? keyof T : never;
type Key = KeysOf<Keyed>;
/** Whose step it is: the person (`fix-input`), an admin, the publisher or the network. */
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

const RETRY: RefusalNextStep = { kind: 'retry' };
const FIX: RefusalNextStep = { kind: 'fix-input', field: 'install-choice' };
const ASK: RefusalNextStep = { kind: 'ask-admin', request: { kind: 'app-access' } };
const REPORT: RefusalNextStep = { kind: 'report-bug' };
const BROWSE: RefusalNextStep = { kind: 'navigate', to: { kind: 'apps-browse' } };

function steps(remedy: Remedy, manages: boolean): RefusalGuidance['steps'] {
  switch (remedy) {
    case 'choice': return [FIX];
    // Someone who manages apps is the admin: a report reaches further than asking themselves.
    case 'admin': return manages ? [FIX, REPORT] : [ASK, FIX];
    case 'publisher': return [REPORT];
    case 'transient': return [RETRY, REPORT];
  }
}

/** The steps for `refusal`, for a person who does (`manages`) or does not manage apps here. */
export function refusalNextSteps(refusal: AppsFailure, manages: boolean): RefusalGuidance {
  if (typeof refusal === 'object' && 'AlreadyInstalled' in refusal) {
    return { steps: [{ kind: 'navigate', to: { kind: 'installed-app', installId: refusal.AlreadyInstalled.install_id } }], forManagers: null };
  }
  const remedy: Remedy = typeof refusal === 'string' ? UNIT_REMEDY[refusal] : KEYED_REMEDY[Object.keys(refusal)[0] as Exclude<Key, 'AlreadyInstalled'>];
  return { steps: steps(remedy, manages), forManagers: manages && refusal === 'Unavailable' ? UNAVAILABLE_FOR_MANAGERS : null };
}

/**
 * A link that opened the marketplace on one app, when its listing could not be had
 * (use-linked-app.ts): no answer or an unreadable one is tried again; a refusal, or a listing that
 * does not read, is an admin's to grant, with every other app one press away.
 */
export function linkedAppNextSteps(outcome: 'unreachable' | 'unavailable', manages: boolean): RefusalGuidance {
  if (outcome === 'unreachable') return { steps: [RETRY, BROWSE], forManagers: null };
  return { steps: manages ? [BROWSE, REPORT] : [ASK, BROWSE], forManagers: manages ? UNAVAILABLE_FOR_MANAGERS : null };
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
