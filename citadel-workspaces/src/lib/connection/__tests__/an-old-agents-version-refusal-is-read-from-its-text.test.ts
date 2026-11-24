/**
 * An agent older than the protocol-version refusal's code passes the server's refusal on as
 * text alone. The page still says what to do about it: the same copy a newer agent's
 * `protocol_version_unsupported` gets, on the sign-in form and after a reconnect that gave up.
 *
 * Control: read only `reason_code` (use `versionRefusalCopy` in connect-refusal.ts), and the
 * form shows the server's raw sentence.
 */
import { describe, expect, it } from 'vitest';
import { connectRefusal } from '../connect-refusal';
import { isVersionRefusalText, VERSION_REFUSAL_COPY, versionRefusalCopyOf } from '../version-refusal-copy';
import { signInAfterLoss } from '@/lib/reconnect/server-reconnect';

/** The SDK's error 550, as a 0.12.5 agent relays a 0.12.6 server's refusal. */
const AS_SENT: string =
  'The other node speaks protocol 0.12.5; this node takes part only with 0.12.6 or a later patch of that release. Update the older node';
const UPDATE: string = VERSION_REFUSAL_COPY.protocol_version_unsupported;

describe('a protocol-version refusal from an agent that names no reason', () => {
  it('is recognised by the server’s sentence, however the agent wrapped it', () => {
    expect(isVersionRefusalText(AS_SENT)).toBe(true);
    expect(isVersionRefusalText(`no answer from the server in 600s: ${AS_SENT}`)).toBe(true);
    for (const other of ['Authentication failed', 'no route to host', 'Update the older node', '', null, undefined]) {
      expect(isVersionRefusalText(other), String(other)).toBe(false);
    }
  });

  it('shows the update copy on the sign-in form', () => {
    const refused: Error = connectRefusal({ kind: 'failed', cid: 0n, message: AS_SENT, reasonCode: null, challenge: null }, 'alice');
    expect(refused.message).toBe(UPDATE);
  });

  it('shows it after a reconnect that gave up, in place of "could not reconnect"', () => {
    expect(signInAfterLoss('alice', 'acme.example', `gave up: ${AS_SENT}`, null).message).toBe(UPDATE);
    expect(signInAfterLoss('alice', 'acme.example', AS_SENT, 'protocol_version_unsupported').message).toBe(UPDATE);
  });

  it('never overrides a reason the agent did name', () => {
    expect(versionRefusalCopyOf('admission_required', AS_SENT)).toBeNull();
    expect(versionRefusalCopyOf('unknown', AS_SENT)).toBeNull();
    expect(versionRefusalCopyOf('protocol_version_unsupported', 'anything')).toBe(UPDATE);
    expect(versionRefusalCopyOf(null, 'Authentication failed')).toBeNull();
  });
});
