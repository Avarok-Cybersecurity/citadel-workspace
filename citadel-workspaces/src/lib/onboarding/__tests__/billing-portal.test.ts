/**
 * "Manage subscription": the portal request, which workspaces offer it, and
 * what each refusal says.
 *
 * The request is driven through contract-fake.ts at the fetch boundary, so the
 * request building and error mapping under test are the production ones. The
 * refusal bodies are the control plane's own (tenants.mjs openPortal).
 */
import { describe, it, expect } from 'vitest';
import {
  ControlPlaneError,
  createControlPlane,
  PORTAL_ORIGIN,
  type ControlPlane,
  type FetchLike,
} from '../control-plane-client';
import {
  describePortalRefusal,
  hostedWorkspaceSlug,
  planAndBillingSlug,
  type PortalRefusal,
} from '../billing-portal';
import { contractFake, type ContractFake } from './contract-fake';

// A well-formed claim code (64 hex): a fixture, never a real one.
const CODE: string = 'ab'.repeat(32);
const PORTAL: string = `${PORTAL_ORIGIN}/p/session/test_fixture`;

async function refusal(promise: Promise<unknown>): Promise<ControlPlaneError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof ControlPlaneError) return error;
    throw error;
  }
  throw new Error('expected a ControlPlaneError, got success');
}

function refusedWith(status: number, error: string): ContractFake {
  const fake: ContractFake = contractFake();
  fake.portalReplies.push({ status, body: { error, detail: 'server sentence' } });
  return fake;
}

describe('opening the billing portal', () => {
  it('posts the claim code in the body, never the URL, and returns the portal address', async () => {
    const fake: ContractFake = contractFake();
    fake.portalReplies.push({ status: 200, body: { portal_url: PORTAL } });
    const seen: Array<{ url: string; contentType: string | null }> = [];
    const recording: FetchLike = async (input: string, init?: RequestInit): Promise<Response> => {
      seen.push({ url: input, contentType: new Headers(init?.headers).get('content-type') });
      return fake.fetch(input, init);
    };
    const api: ControlPlane = createControlPlane(recording, '/api');

    expect(await api.openPortal('acme', CODE)).toBe(PORTAL);
    expect(fake.requests).toEqual([{ method: 'POST', path: '/api/tenants/acme/portal', body: { claim_code: CODE } }]);
    expect(seen[0].url).not.toContain(CODE);
    expect(seen[0].contentType).toBe('application/json');
  });

  it('refuses a portal address that is not Stripe billing', async () => {
    const fake: ContractFake = contractFake();
    fake.portalReplies.push({ status: 200, body: { portal_url: 'https://billing.stripe.com.evil.example/p' } });
    expect((await refusal(createControlPlane(fake.fetch, '/api').openPortal('acme', CODE))).status).toBe(502);
  });

  it('refuses a reply without a portal address', async () => {
    const fake: ContractFake = contractFake();
    fake.portalReplies.push({ status: 200, body: {} });
    expect((await refusal(createControlPlane(fake.fetch, '/api').openPortal('acme', CODE))).status).toBe(502);
  });

  it('keeps the control plane\'s refusal code, including on a 503', async () => {
    const owner: ControlPlaneError = await refusal(
      createControlPlane(refusedWith(403, 'not-owner').fetch, '/api').openPortal('acme', CODE));
    expect([owner.status, owner.code]).toEqual([403, 'not-owner']);
    const portal: ControlPlaneError = await refusal(
      createControlPlane(refusedWith(503, 'portal-not-configured').fetch, '/api').openPortal('acme', CODE));
    expect([portal.status, portal.code]).toEqual([503, 'portal-not-configured']);
  });
});

describe('which workspaces are hosted', () => {
  it('reads the slug from a typed or dialled hosted address', () => {
    expect(hostedWorkspaceSlug('acme.work.avarok.net')).toBe('acme');
    expect(hostedWorkspaceSlug('wss://acme.work.avarok.net/')).toBe('acme');
    expect(hostedWorkspaceSlug('  Acme.Work.Avarok.net ')).toBe('acme');
  });

  it('finds no slug for a self-hosted or malformed address', () => {
    expect(hostedWorkspaceSlug('citadel.example.com:12400')).toBeUndefined();
    expect(hostedWorkspaceSlug('work.avarok.net')).toBeUndefined();
    expect(hostedWorkspaceSlug('a.b.work.avarok.net')).toBeUndefined();
    expect(hostedWorkspaceSlug('acme.work.avarok.net.evil.example')).toBeUndefined();
    expect(hostedWorkspaceSlug(undefined)).toBeUndefined();
  });

  it('offers Plan & billing only to whoever configures the workspace, on a hosted workspace, where a control plane exists', () => {
    const hosted: string = 'acme.work.avarok.net';
    expect(planAndBillingSlug({ configuresWorkspace: true, serverAddress: hosted, controlPlaneBase: '/api' })).toBe('acme');
    expect(planAndBillingSlug({ configuresWorkspace: false, serverAddress: hosted, controlPlaneBase: '/api' })).toBeUndefined();
    expect(planAndBillingSlug({ configuresWorkspace: true, serverAddress: 'citadel.example.com', controlPlaneBase: '/api' }))
      .toBeUndefined();
    expect(planAndBillingSlug({ configuresWorkspace: true, serverAddress: hosted, controlPlaneBase: undefined })).toBeUndefined();
  });
});

describe('what a refusal says', () => {
  const said = (status: number, code: string | undefined): PortalRefusal =>
    describePortalRefusal(new ControlPlaneError(status, 'server sentence', code));

  it('says a wrong code does not own the workspace, and lets them try again', () => {
    expect(said(403, 'not-owner')).toEqual({ message: "That claim code doesn't own this workspace", retry: true });
  });

  it('says the Free plan has nothing to manage, and offers no retry', () => {
    expect(said(404, 'no-subscription')).toEqual({
      message: "This workspace is on the Free plan — there's no subscription to manage",
      retry: false,
    });
  });

  it('says billing is not available yet when either half is unconfigured', () => {
    const expected: PortalRefusal = { message: "Billing management isn't available yet", retry: false };
    expect(said(503, 'portal-not-configured')).toEqual(expected);
    expect(said(503, 'billing-not-configured')).toEqual(expected);
  });

  it('does not call another 403 a wrong code', () => {
    expect(said(403, 'cross-origin').message).not.toBe("That claim code doesn't own this workspace");
    expect(said(403, 'cross-origin').retry).toBe(true);
  });

  it('says a network failure is one, and something unknown is not blamed on the code', () => {
    expect(said(0, undefined).message).toMatch(/connection/i);
    expect(describePortalRefusal(new Error('boom')).message).toMatch(/try again/i);
  });
});
