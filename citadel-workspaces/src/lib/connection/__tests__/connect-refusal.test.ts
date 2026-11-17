/**
 * A refused Connect becomes the error its form acts on: the agent's wrong-server
 * refusal is the typed one the sign-in form shows on the username field, not a raw
 * message, and not an admission refusal that would reset the human check.
 */
import { describe, expect, it } from 'vitest';
import { connectRefusal, UNKNOWN_REASON_COPY } from '../connect-refusal';
import { AdmissionRefusal } from '@/lib/admission/refusal';
import { SIGN_IN_SERVER_COPY, SignInServerRefusal } from '@/lib/sessions/sign-in-server';
import type { FailureReason } from 'citadel-workspace-client-ts';

const failed = (reasonCode: FailureReason | null): Parameters<typeof connectRefusal>[0] =>
  ({ kind: 'failed', cid: 0n, message: 'agent says no', reasonCode, challenge: null });

describe('a refused Connect', () => {
  it('on another server: the typed refusal, with the form’s copy', () => {
    const error: Error = connectRefusal(failed('account_on_another_server'), 'alice');
    expect(error).toBeInstanceOf(SignInServerRefusal);
    expect((error as SignInServerRefusal).reason).toBe('account_on_another_server');
    expect(error.message).toBe(SIGN_IN_SERVER_COPY.account_on_another_server('alice'));
  });

  it('no such account: the typed refusal', () => {
    expect((connectRefusal(failed('no_such_account'), 'alice') as SignInServerRefusal).reason).toBe('no_such_account');
  });

  it('a human check: the admission refusal, as before', () => {
    const error: Error = connectRefusal(failed('admission_required'), 'alice');
    expect(error).toBeInstanceOf(AdmissionRefusal);
    expect(error).not.toBeInstanceOf(SignInServerRefusal);
  });

  it('a reason newer than this page: reload it, not the raw message', () => {
    const error: Error = connectRefusal(failed('unknown'), 'alice');
    expect(error.message).toBe(UNKNOWN_REASON_COPY);
    expect(error).not.toBeInstanceOf(AdmissionRefusal);
  });

  it('no reason: the message', () => {
    const error: Error = connectRefusal(failed(null), 'alice');
    expect(error.message).toBe('agent says no');
    expect(error).not.toBeInstanceOf(AdmissionRefusal);
  });
});
