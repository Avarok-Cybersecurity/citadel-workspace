/**
 * "Manage subscription" for a hosted workspace: which workspaces offer it, and
 * what each answer -- the session's (`OpenBillingPortal`) or the control
 * plane's to a claim code -- says.
 *
 * No I/O here. The requests are the workspace service's and the control-plane
 * client's (`openPortal`); the new tab is the caller's (`PortalTab`). What is
 * left is the decision logic, testable without a browser or a network.
 */
import type { BillingPortalAnswer } from 'citadel-workspace-client-ts';
import { dialledHost } from '@/lib/sessions/same-server';
import { isTenantHost } from '@/lib/workspace-address';
import { ControlPlaneError } from './control-plane-client';

/** The new tab the portal opens in, opened before the request so no popup blocker intervenes. */
export interface PortalTab {
  navigate(url: string): void;
  close(): void;
}

/** What to tell the owner, and whether asking again could change the answer. */
export interface PortalRefusal {
  readonly message: string;
  readonly retry: boolean;
}

export interface PlanAndBillingInputs {
  /**
   * The reader is known to hold EditWorkspaceConfig. The plan is the workspace's configuration;
   * the claim code the portal asks for is what actually decides.
   */
  readonly configuresWorkspace: boolean;
  readonly serverAddress: string | undefined;
  readonly controlPlaneBase: string | undefined;
}

/** `acme` for a hosted workspace address (`acme.work.avarok.net`, typed or dialled); undefined otherwise. */
export function hostedWorkspaceSlug(serverAddress: string | undefined): string | undefined {
  if (serverAddress === undefined) return undefined;
  const host: string = dialledHost(serverAddress).toLowerCase();
  if (!isTenantHost(host)) return undefined;
  return host.slice(0, host.indexOf('.'));
}

/**
 * The slug to manage billing for, or undefined when "Plan & billing" is not
 * offered: not someone who configures the workspace, a self-hosted server (it has no plan), or a
 * page with no control plane to ask.
 */
export function planAndBillingSlug(inputs: PlanAndBillingInputs): string | undefined {
  if (!inputs.configuresWorkspace || inputs.controlPlaneBase === undefined) return undefined;
  return hostedWorkspaceSlug(inputs.serverAddress);
}

const WRONG_CODE: PortalRefusal = { message: "That claim code doesn't own this workspace", retry: true };
const FREE_PLAN: PortalRefusal = {
  message: "This workspace is on the Free plan — there's no subscription to manage",
  retry: false,
};
const NOT_AVAILABLE: PortalRefusal = { message: "Billing management isn't available yet", retry: false };
const UNREACHABLE: PortalRefusal = {
  message: 'Could not reach Citadel. Check your connection and try again.',
  retry: true,
};
const UNKNOWN: PortalRefusal = {
  message: "Billing couldn't be opened just now. Please try again.",
  retry: true,
};

/** The sentence for a refused portal request, keyed on the control plane's code rather than its status. */
export function describePortalRefusal(error: unknown): PortalRefusal {
  if (!(error instanceof ControlPlaneError)) return UNKNOWN;
  switch (error.code) {
    case 'not-owner': return WRONG_CODE;
    case 'no-subscription': return FREE_PLAN;
    case 'portal-not-configured':
    case 'billing-not-configured': return NOT_AVAILABLE;
    default: return error.status === 0 ? UNREACHABLE : UNKNOWN;
  }
}

/** What the session's answer means for the dialog: a portal to open, or what to say instead. */
export type SessionPortalOutcome =
  | { readonly kind: 'opened'; readonly portalUrl: string }
  | { readonly kind: 'refused'; readonly refusal: PortalRefusal };

/**
 * The server's answer to `OpenBillingPortal`, for a member it admitted. (A member it did not admit
 * gets an Error answer instead, and the dialog offers the claim code.)
 */
export function sessionPortalOutcome(answer: BillingPortalAnswer): SessionPortalOutcome {
  if (answer === 'NoSubscription') return { kind: 'refused', refusal: FREE_PLAN };
  if (answer === 'NotConfigured') return { kind: 'refused', refusal: NOT_AVAILABLE };
  if ('Opened' in answer) return { kind: 'opened', portalUrl: answer.Opened.portal_url };
  return { kind: 'refused', refusal: UNKNOWN };
}
