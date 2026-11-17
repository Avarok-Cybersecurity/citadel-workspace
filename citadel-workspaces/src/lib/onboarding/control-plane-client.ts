/**
 * The tenant control plane, as the create-workspace flow sees it.
 *
 * Same origin, at the base path the deployment publishes (control-plane-config.ts,
 * normally `/api`) -- so the page's `connect-src 'self'` already covers
 * it and no CORS is involved. The transport is injected (`FetchLike`) so every
 * branch below is testable against a scripted response, with no network and no
 * module mocking.
 *
 * Every response is parsed, not trusted. A body that does not have the shape the
 * contract promises is an error with a sentence a visitor can read, never an
 * `undefined` that surfaces three screens later.
 */
import type { BillingInterval, TierId } from './tiers';
import { ControlPlaneError } from './control-plane-error';
import { answerFromBody, answerFromError, type CouponPreviewAnswer, type CouponPreviewRequest } from './coupon-preview';

export { ControlPlaneError };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type UnavailableReason = 'invalid' | 'reserved' | 'taken';

export type SlugAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: UnavailableReason | undefined };

export interface CreateTenantRequest {
  readonly slug: string;
  readonly display_name: string;
  readonly tier: TierId;
  readonly interval?: BillingInterval;
  readonly seats?: number;
  readonly storage_blocks?: number;
  /** 50-link packs for the workspace's shared pool; paid tiers only, like storage_blocks. */
  readonly link_packs?: number;
  /** 5000-document packs for the workspace's chat documents; Business only. */
  readonly chat_document_packs?: number;
  readonly turnstile_token: string;
  /** The Customer Terms version the person accepted; the control plane refuses any but the current one. */
  readonly accepted_customer_terms_version: number;
  readonly reservation_token?: string;
  /** A code the visitor applied; paid tiers only. The control plane judges it again at creation. */
  readonly coupon_code?: string;
}

export type CreateTenantResult =
  | { readonly kind: 'created'; readonly claimCode: string; readonly workspaceHost: string }
  | { readonly kind: 'checkout'; readonly checkoutUrl: string; readonly reservationToken: string | undefined };

export type TenantStatus =
  | { readonly status: 'pending' }
  | { readonly status: 'active'; readonly claimCode: string | undefined; readonly workspaceHost: string | undefined };

/** The only place a paid signup may be sent. Anything else in `checkout_url` is refused. */
export const CHECKOUT_ORIGIN: string = 'https://checkout.stripe.com';

/** The only place "Manage subscription" may send an owner. Anything else in `portal_url` is refused. */
export const PORTAL_ORIGIN: string = 'https://billing.stripe.com';

export interface ControlPlane {
  checkSlug(slug: string, signal?: AbortSignal): Promise<SlugAvailability>;
  createTenant(request: CreateTenantRequest): Promise<CreateTenantResult>;
  tenantStatus(slug: string, sessionId: string, signal?: AbortSignal): Promise<TenantStatus>;
  /** A Stripe Billing Portal address for `slug`, for the holder of its claim code. */
  openPortal(slug: string, claimCode: string): Promise<string>;
  /** What a code would do to a plan. Refusals are answers, not throws; only an abort throws. */
  previewCoupon(request: CouponPreviewRequest, signal?: AbortSignal): Promise<CouponPreviewAnswer>;
}

const NOT_CONFIGURED: string =
  'Creating a workspace is not available yet. Please try again later.';
const UNREACHABLE: string =
  'Could not reach Citadel. Check your connection and try again.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value: unknown = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function malformed(what: string): ControlPlaneError {
  return new ControlPlaneError(502, `Citadel sent an unexpected reply (${what}). Please try again.`, undefined);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function send(fetchFn: FetchLike, url: string, init: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchFn(url, { ...init, headers: { Accept: 'application/json', ...init.headers } });
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ControlPlaneError(0, UNREACHABLE, undefined);
  }
  const body: unknown = await readJson(response);
  if (!response.ok) {
    // The control plane answers `{ error: <code>, detail: <sentence> }`: the
    // sentence is for the visitor, the code for logs and for callers that word
    // a refusal themselves.
    const code: string | undefined = isRecord(body) ? optionalString(body, 'error') : undefined;
    if (response.status === 503) throw new ControlPlaneError(503, NOT_CONFIGURED, code);
    const stated: string | undefined = isRecord(body) ? optionalString(body, 'detail') ?? code : undefined;
    throw new ControlPlaneError(response.status, stated ?? `Request failed (${response.status}).`, code);
  }
  if (!isRecord(body)) throw malformed('not an object');
  return body;
}

function parseAvailability(body: Record<string, unknown>): SlugAvailability {
  if (body.available === true) return { available: true };
  if (body.available !== false) throw malformed('availability');
  const reason: unknown = body.reason;
  const known: UnavailableReason | undefined =
    reason === 'invalid' || reason === 'reserved' || reason === 'taken' ? reason : undefined;
  return { available: false, reason: known };
}

function hasOrigin(candidate: string, origin: string): boolean {
  try {
    return new URL(candidate).origin === origin;
  } catch {
    return false;
  }
}

export function isCheckoutUrl(candidate: string): boolean {
  return hasOrigin(candidate, CHECKOUT_ORIGIN);
}

function parsePortal(body: Record<string, unknown>): string {
  const portalUrl: string | undefined = optionalString(body, 'portal_url');
  if (portalUrl === undefined || !hasOrigin(portalUrl, PORTAL_ORIGIN)) throw malformed('billing portal address');
  return portalUrl;
}

function parseCreated(body: Record<string, unknown>): CreateTenantResult {
  const checkoutUrl: string | undefined = optionalString(body, 'checkout_url');
  if (checkoutUrl !== undefined) {
    if (!isCheckoutUrl(checkoutUrl)) throw malformed('checkout address');
    return { kind: 'checkout', checkoutUrl, reservationToken: optionalString(body, 'reservation_token') };
  }
  const claimCode: string | undefined = optionalString(body, 'claim_code');
  const workspaceHost: string | undefined = optionalString(body, 'workspace_host');
  if (claimCode === undefined || workspaceHost === undefined) throw malformed('new workspace');
  return { kind: 'created', claimCode, workspaceHost };
}

function parseStatus(body: Record<string, unknown>): TenantStatus {
  if (body.status === 'pending') return { status: 'pending' };
  if (body.status !== 'active') throw malformed('status');
  return {
    status: 'active',
    claimCode: optionalString(body, 'claim_code'),
    workspaceHost: optionalString(body, 'workspace_host'),
  };
}

export function createControlPlane(fetchFn: FetchLike, base: string): ControlPlane {
  return {
    async checkSlug(slug: string, signal?: AbortSignal): Promise<SlugAvailability> {
      const body: Record<string, unknown> = await send(fetchFn, `${base}/slug/${encodeURIComponent(slug)}`, {
        method: 'GET',
        signal,
      });
      return parseAvailability(body);
    },
    async createTenant(request: CreateTenantRequest): Promise<CreateTenantResult> {
      const body: Record<string, unknown> = await send(fetchFn, `${base}/tenants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      return parseCreated(body);
    },
    async tenantStatus(slug: string, sessionId: string, signal?: AbortSignal): Promise<TenantStatus> {
      const query: string = new URLSearchParams({ session_id: sessionId }).toString();
      const body: Record<string, unknown> = await send(
        fetchFn,
        `${base}/tenants/${encodeURIComponent(slug)}/status?${query}`,
        { method: 'GET', signal },
      );
      return parseStatus(body);
    },
    async openPortal(slug: string, claimCode: string): Promise<string> {
      // The code is the owner's proof: in the body, never the URL, where it
      // would reach logs, history and referrers.
      const body: Record<string, unknown> = await send(fetchFn, `${base}/tenants/${encodeURIComponent(slug)}/portal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_code: claimCode }),
      });
      return parsePortal(body);
    },
    async previewCoupon(request: CouponPreviewRequest, signal?: AbortSignal): Promise<CouponPreviewAnswer> {
      try {
        const body: Record<string, unknown> = await send(fetchFn, `${base}/coupons/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal,
        });
        return answerFromBody(body);
      } catch (error: unknown) {
        return answerFromError(error);
      }
    },
  };
}
