/**
 * The control-plane client against its contract: what each answer becomes, and
 * what each refusal says. Driven through contract-fake.ts at the fetch
 * boundary, so the parsing under test is the production parsing.
 */
import { describe, it, expect } from 'vitest';
import {
  ControlPlaneError,
  createControlPlane,
  isCheckoutUrl,
  type ControlPlane,
  type CreateTenantResult,
  type FetchLike,
} from '../control-plane-client';
import { contractFake, type ContractFake } from './contract-fake';

function client(fake: ContractFake): ControlPlane {
  return createControlPlane(fake.fetch, '/api');
}

async function refusal(promise: Promise<unknown>): Promise<ControlPlaneError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof ControlPlaneError) return error;
    throw error;
  }
  throw new Error('expected a ControlPlaneError, got success');
}

describe('slug availability', () => {
  it('reads available, and each reason it is not', async () => {
    const fake: ContractFake = contractFake();
    fake.unavailable.set('taken-one', 'taken');
    fake.unavailable.set('www', 'reserved');
    fake.unavailable.set('odd', 'something-new');
    const api: ControlPlane = client(fake);

    expect(await api.checkSlug('acme')).toEqual({ available: true });
    expect(await api.checkSlug('taken-one')).toEqual({ available: false, reason: 'taken' });
    expect(await api.checkSlug('www')).toEqual({ available: false, reason: 'reserved' });
    // An unknown reason is still NOT available -- it must never read as a yes.
    expect(await api.checkSlug('odd')).toEqual({ available: false, reason: undefined });
    expect(fake.requests[0].path).toBe('/api/slug/acme');
  });

  it('refuses a reply without an availability', async () => {
    const api: ControlPlane = createControlPlane(async () => new Response('{"ok":1}', { status: 200 }), '/api');
    expect((await refusal(api.checkSlug('acme'))).status).toBe(502);
  });
});

describe('errors', () => {
  it('names 503 as "not configured", with its own sentence', async () => {
    const fake: ContractFake = contractFake();
    fake.createReplies.push({ status: 503, body: { error: 'STRIPE_SECRET unset' } });
    const error: ControlPlaneError = await refusal(
      client(fake).createTenant({ slug: 'acme', display_name: 'Acme', tier: 'free', turnstile_token: 't', accepted_customer_terms_version: 1 }),
    );
    expect(error.notConfigured).toBe(true);
    expect(error.transient).toBe(false);
    // The operator's configuration detail is not the visitor's business.
    expect(error.message).not.toContain('STRIPE');
    expect(error.message).toMatch(/not available yet/i);
  });

  it('passes a stated 4xx reason through', async () => {
    const fake: ContractFake = contractFake();
    fake.createReplies.push({ status: 403, body: { error: 'Human verification failed.' } });
    const error: ControlPlaneError = await refusal(
      client(fake).createTenant({ slug: 'acme', display_name: 'Acme', tier: 'free', turnstile_token: 't', accepted_customer_terms_version: 1 }),
    );
    expect(error.status).toBe(403);
    expect(error.message).toBe('Human verification failed.');
    expect(error.transient).toBe(false);
  });

  it('describes a failure with no body', async () => {
    const api: ControlPlane = createControlPlane(async () => new Response('<html>', { status: 500 }), '/api');
    const error: ControlPlaneError = await refusal(api.checkSlug('acme'));
    expect(error.status).toBe(500);
    expect(error.transient).toBe(true);
  });

  it('turns a network failure into status 0, transient', async () => {
    const offline: FetchLike = async () => {
      throw new TypeError('Failed to fetch');
    };
    const error: ControlPlaneError = await refusal(createControlPlane(offline, '/api').checkSlug('acme'));
    expect(error.status).toBe(0);
    expect(error.transient).toBe(true);
  });

  it('lets an abort through as an abort, not as "offline"', async () => {
    const fake: ContractFake = contractFake();
    const controller: AbortController = new AbortController();
    controller.abort();
    await expect(client(fake).checkSlug('acme', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('creating a tenant', () => {
  it('sends the contract body and reads a free workspace', async () => {
    const fake: ContractFake = contractFake();
    fake.createReplies.push({ status: 200, body: { claim_code: 'CLAIM-1', workspace_host: 'acme.work.avarok.net' } });
    const result: CreateTenantResult = await client(fake).createTenant({
      slug: 'acme', display_name: 'Acme', tier: 'free', turnstile_token: 'tok', accepted_customer_terms_version: 1,
    });
    expect(result).toEqual({ kind: 'created', claimCode: 'CLAIM-1', workspaceHost: 'acme.work.avarok.net' });
    expect(fake.requests[0]).toEqual({
      method: 'POST',
      path: '/api/tenants',
      body: { slug: 'acme', display_name: 'Acme', tier: 'free', turnstile_token: 'tok', accepted_customer_terms_version: 1 },
    });
  });

  it('reads a paid signup as a Checkout redirect', async () => {
    const fake: ContractFake = contractFake();
    fake.createReplies.push({ status: 200, body: { checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_1' } });
    expect(await client(fake).createTenant({
      slug: 'acme', display_name: 'Acme', tier: 'team', interval: 'year', seats: 4, storage_blocks: 1, turnstile_token: 't', accepted_customer_terms_version: 1,
    })).toEqual({ kind: 'checkout', checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' });
  });

  it('refuses to send the visitor anywhere but Stripe Checkout', async () => {
    const fake: ContractFake = contractFake();
    fake.createReplies.push({ status: 200, body: { checkout_url: 'https://checkout.stripe.com.evil.example/pay' } });
    const error: ControlPlaneError = await refusal(
      client(fake).createTenant({ slug: 'a1b', display_name: 'A', tier: 'team', turnstile_token: 't', accepted_customer_terms_version: 1 }),
    );
    expect(error.status).toBe(502);
    expect(isCheckoutUrl('https://checkout.stripe.com/x')).toBe(true);
    expect(isCheckoutUrl('http://checkout.stripe.com/x')).toBe(false);
    expect(isCheckoutUrl('javascript:alert(1)')).toBe(false);
  });

  it('refuses a free reply missing its claim code', async () => {
    const fake: ContractFake = contractFake();
    fake.createReplies.push({ status: 200, body: { workspace_host: 'acme.work.avarok.net' } });
    expect((await refusal(
      client(fake).createTenant({ slug: 'acme', display_name: 'Acme', tier: 'free', turnstile_token: 't', accepted_customer_terms_version: 1 }),
    )).status).toBe(502);
  });
});

describe('tenant status', () => {
  it('asks with the session id and reads pending, then active', async () => {
    const fake: ContractFake = contractFake();
    fake.statusReplies.push({ status: 200, body: { status: 'pending' } });
    fake.statusReplies.push({ status: 200, body: { status: 'active', claim_code: 'C', workspace_host: 'acme.work.avarok.net' } });
    const api: ControlPlane = client(fake);
    expect(await api.tenantStatus('acme', 'cs_test_1')).toEqual({ status: 'pending' });
    expect(await api.tenantStatus('acme', 'cs_test_1')).toEqual({
      status: 'active', claimCode: 'C', workspaceHost: 'acme.work.avarok.net',
    });
    expect(fake.requests[0].path).toBe('/api/tenants/acme/status?session_id=cs_test_1');
  });

  it('reads an active tenant whose code was already issued', async () => {
    const fake: ContractFake = contractFake();
    fake.statusReplies.push({ status: 200, body: { status: 'active' } });
    expect(await client(fake).tenantStatus('acme', 's')).toEqual({ status: 'active', claimCode: undefined, workspaceHost: undefined });
  });
});
