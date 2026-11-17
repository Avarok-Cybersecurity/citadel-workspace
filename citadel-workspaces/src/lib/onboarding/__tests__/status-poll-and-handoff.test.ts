/**
 * When the provisioning wait stops, and the claim code's one showing.
 *
 * The poll is driven with a fake clock and an instant sleep, so each stop
 * condition is reached deterministically: active, timed out, refused, too many
 * transient failures, and left.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ControlPlaneError, type TenantStatus } from '../control-plane-client';
import { pollUntilActive, type PollOptions, type PollOutcome } from '../status-poll';
import {
  claimCodeFor,
  createdWorkspaceAddress,
  forgetIssuedClaim,
  recordIssuedClaim,
  revealClaimCode,
} from '../claim-handoff';

type Step = TenantStatus | ControlPlaneError;

function scripted(steps: Step[], overrides: Partial<PollOptions> = {}): { options: PollOptions; calls: () => number } {
  let clock: number = 0;
  let calls: number = 0;
  const options: PollOptions = {
    intervalMs: 1000,
    timeoutMs: 10_000,
    maxConsecutiveFailures: 3,
    signal: new AbortController().signal,
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
    fetchStatus: async () => {
      const step: Step | undefined = steps[Math.min(calls, steps.length - 1)];
      calls += 1;
      if (step instanceof ControlPlaneError) throw step;
      if (!step) throw new Error('nothing scripted');
      return step;
    },
    ...overrides,
  };
  return { options, calls: () => calls };
}

const PENDING: TenantStatus = { status: 'pending' };

describe('pollUntilActive stops', () => {
  it('as soon as the tenant is active, with its code and host', async () => {
    const { options, calls } = scripted([PENDING, PENDING, { status: 'active', claimCode: 'C', workspaceHost: 'h' }]);
    expect(await pollUntilActive(options)).toEqual({ kind: 'active', claimCode: 'C', workspaceHost: 'h' });
    expect(calls()).toBe(3);
  });

  it('at the timeout, having kept asking until then', async () => {
    const { options, calls } = scripted([PENDING]);
    expect(await pollUntilActive(options)).toEqual({ kind: 'timed-out' });
    expect(calls()).toBe(11);
  });

  it('at once on a refusal -- asking again will not change a 404', async () => {
    const notFound: ControlPlaneError = new ControlPlaneError(404, 'No such workspace.', 'not-found');
    const { options, calls } = scripted([notFound]);
    const outcome: PollOutcome = await pollUntilActive(options);
    expect(outcome).toEqual({ kind: 'failed', error: notFound });
    expect(calls()).toBe(1);
  });

  it('at once on 503, which is configuration and not a blip', async () => {
    const { options, calls } = scripted([new ControlPlaneError(503, 'not configured', undefined)]);
    expect((await pollUntilActive(options)).kind).toBe('failed');
    expect(calls()).toBe(1);
  });

  it('rides out transient failures, and resets the count on success', async () => {
    const blip: ControlPlaneError = new ControlPlaneError(0, 'offline', undefined);
    const { options } = scripted([blip, blip, PENDING, blip, blip, { status: 'active', claimCode: undefined, workspaceHost: undefined }]);
    expect((await pollUntilActive(options)).kind).toBe('active');
  });

  it('after too many transient failures in a row', async () => {
    const blip: ControlPlaneError = new ControlPlaneError(502, 'bad gateway', undefined);
    const { options, calls } = scripted([blip]);
    expect(await pollUntilActive(options)).toEqual({ kind: 'failed', error: blip });
    expect(calls()).toBe(3);
  });

  it('when the visitor leaves', async () => {
    const controller: AbortController = new AbortController();
    const { options, calls } = scripted([PENDING], {
      signal: controller.signal,
      sleep: async () => {
        controller.abort();
      },
    });
    expect(await pollUntilActive(options)).toEqual({ kind: 'aborted' });
    expect(calls()).toBe(1);
  });
});

describe('the claim code', () => {
  beforeEach(() => forgetIssuedClaim());

  it('is shown once, and never again', () => {
    recordIssuedClaim('acme.work.avarok.net', 'CLAIM-XYZ');
    expect(revealClaimCode()).toBe('CLAIM-XYZ');
    expect(revealClaimCode()).toBeUndefined();
    expect(revealClaimCode()).toBeUndefined();
  });

  it('is shown for nothing when none was issued', () => {
    expect(revealClaimCode()).toBeUndefined();
  });

  it('still pre-fills the initialization step for that workspace, and only that one', () => {
    recordIssuedClaim('acme.work.avarok.net', 'CLAIM-XYZ');
    revealClaimCode();
    // A hosted tenant is dialled at its bare host over wss -- no port is appended
    // (workspace-address.ts isTenantHost). `:12400` names a different endpoint, which
    // this workspace does not answer on, so it must not receive the claim code.
    expect(createdWorkspaceAddress()).toBe('acme.work.avarok.net');
    expect(claimCodeFor('acme.work.avarok.net')).toBe('CLAIM-XYZ');
    // The tab's connection record holds the dialled URL, not the host.
    expect(claimCodeFor('wss://acme.work.avarok.net/')).toBe('CLAIM-XYZ');
    expect(claimCodeFor('wss://other.work.avarok.net/')).toBeUndefined();
    expect(claimCodeFor('acme.work.avarok.net:12400')).toBeUndefined();
    expect(claimCodeFor('other.work.avarok.net')).toBeUndefined();
    expect(claimCodeFor(undefined)).toBeUndefined();
  });

  it('is gone once forgotten', () => {
    recordIssuedClaim('acme.work.avarok.net', 'CLAIM-XYZ');
    forgetIssuedClaim();
    expect(claimCodeFor('acme.work.avarok.net')).toBeUndefined();
    expect(createdWorkspaceAddress()).toBeUndefined();
  });

  it('is never written to web storage', () => {
    recordIssuedClaim('acme.work.avarok.net', 'CLAIM-XYZ');
    revealClaimCode();
    const everything: string = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(everything).not.toContain('CLAIM-XYZ');
  });
});
