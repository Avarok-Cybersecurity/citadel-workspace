/**
 * The ways out of every apps failure: one plan per refusal the kernel can send, and per failure
 * the host adds (Malformed, NoAnswer). Keyed by the failure's tag, so a refusal added to the
 * Rust enum does not compile until it has a plan here (RECOVERY-DESIGN.md §2.6 a). The words
 * stay in lib/citadel-apps/refusal-copy.ts; this says only what a person can do about them.
 */
import type { AppsFailure } from '@/lib/workspace-service/apps-operations';
import type { DeclaredPlan } from '../route';

type ObjectKeys<U> = U extends object ? keyof U : never;

/** A failure's name: the unit variant itself, or the one key of an object variant. */
export type AppsFailureTag = Extract<AppsFailure, string> | ObjectKeys<AppsFailure>;

export function appsFailureTag(failure: AppsFailure): AppsFailureTag {
  if (typeof failure === 'string') return failure;
  const keys: string[] = Object.keys(failure);
  if (keys.length !== 1) throw new Error(`an apps refusal names exactly one variant, not ${keys.length}`);
  return keys[0] as AppsFailureTag;
}

const ASK_APP_ACCESS = { kind: 'ask-admin', request: 'app-access' } as const;
const ASK_POLICY = { kind: 'ask-admin', request: 'policy' } as const;
const FIX = { kind: 'fix-input' } as const;

export const APPS_SURFACES = {
  'apps.NoAnswer': { cause: 'environment', presentation: 'inline', primary: { kind: 'retry-auto', policy: 'short', then: { kind: 'retry' } }, alternatives: [] },
  'apps.Malformed': { cause: 'ours', presentation: 'inline', primary: { kind: 'retry' }, alternatives: [] },
  'apps.ArtifactUnreachable': { cause: 'environment', presentation: 'inline', primary: { kind: 'retry-auto', policy: 'short', then: { kind: 'retry' } }, alternatives: [] },
  'apps.Unavailable': { cause: 'policy', presentation: 'inline', primary: ASK_APP_ACCESS, alternatives: [{ kind: 'navigate', to: 'apps-browse' }] },
  'apps.PermissionRequired': { cause: 'policy', presentation: 'inline', primary: { kind: 'ask-admin', request: 'permission' }, alternatives: [] },
  'apps.Policy': { cause: 'policy', presentation: 'inline', primary: ASK_POLICY, alternatives: [] },
  'apps.HeaderManaged': { cause: 'policy', presentation: 'inline', primary: ASK_POLICY, alternatives: [] },
  'apps.InstallRequestsNotOffered': { cause: 'policy', presentation: 'inline', primary: ASK_APP_ACCESS, alternatives: [] },
  'apps.NotActive': { cause: 'user', presentation: 'inline', primary: { kind: 'open-setting', tab: 'general' }, alternatives: [] },
  'apps.ScopeNotSupported': { cause: 'user', presentation: 'inline', primary: FIX, alternatives: [] },
  'apps.ScopeOutsideAudience': { cause: 'user', presentation: 'inline', primary: FIX, alternatives: [] },
  'apps.CapabilityNotGrantable': { cause: 'user', presentation: 'inline', primary: FIX, alternatives: [] },
  'apps.FirstPartyOnly': { cause: 'user', presentation: 'inline', primary: FIX, alternatives: [] },
  'apps.RequiredCapabilityLeftOut': { cause: 'user', presentation: 'inline', primary: FIX, alternatives: [] },
  'apps.Ungranted': { cause: 'policy', presentation: 'inline', primary: ASK_APP_ACCESS, alternatives: [] },
  'apps.NoHost': { cause: 'peer', presentation: 'inline', primary: { kind: 'wait', until: 'member-opens-app', deadlineMs: 60_000, then: { kind: 'retry' } }, alternatives: [] },
  'apps.AlreadyInstalled': { cause: 'user', presentation: 'inline', primary: { kind: 'acknowledge', why: 'final-outcome' }, alternatives: [] },
  'apps.VersionNotNewer': { cause: 'user', presentation: 'inline', primary: { kind: 'acknowledge', why: 'final-outcome' }, alternatives: [] },
  'apps.Limit': { cause: 'policy', presentation: 'inline', primary: { kind: 'ask-admin', request: 'storage-quota' }, alternatives: [] },
  'apps.ServerFeatureUnavailable': { cause: 'environment', presentation: 'inline', primary: ASK_POLICY, alternatives: [] },
  'apps.BadSignature': { cause: 'ours', presentation: 'inline', primary: { kind: 'report-bug' }, alternatives: [] },
  'apps.ArtifactMismatch': { cause: 'ours', presentation: 'inline', primary: { kind: 'report-bug' }, alternatives: [] },
  'apps.InvalidManifest': { cause: 'ours', presentation: 'inline', primary: { kind: 'report-bug' }, alternatives: [] },
  'apps.NotRequested': { cause: 'ours', presentation: 'inline', primary: { kind: 'report-bug' }, alternatives: [] },
  /** A listing that could not be fetched or read: not the same as one refused (REL-1127 APP-AVAIL). */
  'apps.listing-unreachable': { cause: 'environment', presentation: 'inline', primary: { kind: 'retry-auto', policy: 'short', then: { kind: 'retry' } }, alternatives: [{ kind: 'navigate', to: 'apps-browse' }] },
} as const satisfies { readonly [K in AppsFailureTag as `apps.${K}`]: DeclaredPlan } & Record<string, DeclaredPlan>;
