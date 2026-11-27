/**
 * The ways out of an error, as data (RECOVERY-DESIGN.md §2).
 *
 * A surface that shows a failure declares a `RecoveryPlan`: whose problem it is, how it is shown,
 * and the route a person takes to get unstuck. There is no default route and no "unspecified"
 * value, so the type forces a choice. Runtime values a route needs (the operation to retry, the
 * member to message) are not here: they are the surface's binding (binding.ts), whose type is
 * derived from the plan, so a plan that names a route cannot be rendered without what it needs.
 *
 * Not lib/recovery/: that is account recovery (phrase, console).
 */
import type { SettingsTab } from '@/lib/settings-request';

/** Whose problem it is: drives the derived bug-report route and the score's weighting. */
export type Cause = 'user' | 'ours' | 'policy' | 'peer' | 'environment';

export type Presentation = 'inline' | 'toast' | 'banner' | 'modal' | 'page';

/** How an automatic retry spaces its attempts; each policy's delays live in retry-policy.ts. */
export type BackoffPolicyId = 'short' | 'server';

/** Where `navigate` goes: a page in the app, or the apps catalogue. */
export type Destination = 'connect' | 'home' | 'apps-browse' | 'agent';

export type BrowserPermission =
  | 'loopback-network' | 'notifications' | 'camera' | 'microphone' | 'screen' | 'clipboard' | 'popups' | 'storage';

/** What is being asked of the admins; the sentence itself is the binding's `askAbout`. */
export type AdminRequestKind =
  | 'permission' | 'app-access' | 'policy' | 'storage-quota' | 'remote-storage' | 'membership' | 'initialize-workspace';

/** Why a member is being written to; the draft itself is the binding's. */
export type MemberTopic = 'topic-owner' | 'booking-host' | 'peer-refused' | 'inviter' | 'storage-peer' | 'admins';

/** What a wait waits for. The wake-up signal is the binding's `wake`, so no wait is a promise alone. */
export type WaitCondition =
  | 'agent-online' | 'agent-reconnect' | 'server-reachable' | 'server-restart' | 'network-online'
  | 'peer-online' | 'peer-accepts' | 'admin-decision' | 'member-opens-app' | 'workspace-loaded' | 'schema-loaded';

export type RetryRoute = { readonly kind: 'retry' };
export type ReloadRoute = { readonly kind: 'reload' };
export type ApplyUpdateRoute = { readonly kind: 'apply-update' };
export type ClaimSessionRoute = { readonly kind: 'claim-session' };
export type SignInAgainRoute = { readonly kind: 'sign-in-again' };
export type FixInputRoute = { readonly kind: 'fix-input' };
export type OpenSettingRoute = { readonly kind: 'open-setting'; readonly tab: SettingsTab };
export type NavigateRoute = { readonly kind: 'navigate'; readonly to: Destination };
export type AskAdminRoute = { readonly kind: 'ask-admin'; readonly request: AdminRequestKind };
export type ContactMemberRoute = { readonly kind: 'contact-member'; readonly about: MemberTopic };
export type InstallAgentRoute = { readonly kind: 'install-agent'; readonly reason: 'missing' | 'outdated' };
export type GrantPermissionRoute = { readonly kind: 'grant-permission'; readonly permission: BrowserPermission };
export type ReportBugRoute = { readonly kind: 'report-bug' };
export type AcknowledgeRoute = { readonly kind: 'acknowledge'; readonly why: 'informational' | 'final-outcome' };

/** A route a person acts on: what a wait or an automatic retry falls back to. */
export type ManualRoute =
  | RetryRoute | ReloadRoute | ApplyUpdateRoute | ClaimSessionRoute | SignInAgainRoute | FixInputRoute
  | OpenSettingRoute | NavigateRoute | AskAdminRoute | ContactMemberRoute | InstallAgentRoute
  | GrantPermissionRoute | ReportBugRoute | AcknowledgeRoute;

/** Waits until `wake` fires, at most `deadlineMs`, then offers `then`. A `then` is never a wait. */
export type WaitRoute = {
  readonly kind: 'wait';
  readonly until: WaitCondition;
  readonly deadlineMs: number;
  readonly then: ManualRoute;
};

/** Retries by itself on `policy`; when the policy runs out, offers `then`. */
export type RetryAutoRoute = { readonly kind: 'retry-auto'; readonly policy: BackoffPolicyId; readonly then: ManualRoute };

export type RecoveryRoute = ManualRoute | WaitRoute | RetryAutoRoute;

export type RouteKind = RecoveryRoute['kind'];

/** A surface's whole declaration. `primary` is required: there is no default route. */
export interface RecoveryPlan {
  readonly cause: Cause;
  readonly presentation: Presentation;
  readonly primary: RecoveryRoute;
  /** Ordered, may be empty. A cause of 'ours' gets report-bug appended (derive.ts), never listed. */
  readonly alternatives: readonly ManualRoute[];
}

/** Blocking surfaces (a modal, a page) must offer a way out, not only an acknowledgement. */
export type BlockingPresentation = Extract<Presentation, 'modal' | 'page'>;

/**
 * A plan as written in a registry: an acknowledgement is legal as the primary only where nothing
 * is blocked. `as const satisfies Record<string, DeclaredPlan>` checks every entry.
 */
export type DeclaredPlan =
  | (RecoveryPlan & { readonly presentation: Exclude<Presentation, BlockingPresentation> })
  | (RecoveryPlan & { readonly presentation: BlockingPresentation; readonly primary: Exclude<RecoveryRoute, AcknowledgeRoute> });
