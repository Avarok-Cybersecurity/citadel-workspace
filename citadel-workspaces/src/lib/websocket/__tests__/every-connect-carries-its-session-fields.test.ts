/**
 * The fields a Connect (and a PeerConnect) carries besides who and where.
 *
 * `AuthOperations.connect` is the only place the page builds a Connect: the
 * sign-in form, the registration follow-up, the reconnect paths and the
 * switcher all reach the agent through it. When it gained a required server, a
 * call regression was blamed on the rebuild dropping `udp_mode` or the session
 * settings; nothing pinned them, so nothing could say. This pins the whole
 * payload: a field dropped, renamed, defaulted or added fails here.
 *
 * A call's datagram path is negotiated per PEER connection, so the PeerConnect
 * and its answer must ask for UDP; the C2S Connect has always asked for none.
 * Only the agent socket is faked; the request builders are production code.
 */
import { describe, it, expect, vi } from 'vitest';
import { passwordOnly } from '@/lib/sign-in/factors';
import { getDefaultSecuritySettings, type SessionSecuritySettings } from '@/lib/security-utils';
import { P2POperations } from '../p2p-operations';

vi.mock('../../connection', () => ({ connectionManager: {} }));

const { AuthOperations } = await import('../auth-operations');

type Body = Record<string, unknown>;

async function connectPayload(settings?: SessionSecuritySettings): Promise<Body> {
  const sent: Body[] = [];
  const ops: InstanceType<typeof AuthOperations> = new AuthOperations({
    init: async (): Promise<void> => {},
    sendRequest: async (request: unknown): Promise<void> => { sent.push(request as Body); },
  } as never);
  await ops.connect('req-1', 'alice', ' bench.work.avarok.net ', passwordOnly('pw'), settings);
  expect(sent).toHaveLength(1);
  return sent[0].Connect as Body;
}

const HIGH: SessionSecuritySettings = { ...getDefaultSecuritySettings(), security_level: 'High', secrecy_mode: 'Perfect' };

describe('a Connect', () => {
  it('carries exactly these fields', async () => {
    expect(Object.keys(await connectPayload()).sort()).toEqual([
      'admission_token', 'connect_mode', 'keep_alive_timeout', 'password', 'recovery_code',
      'request_id', 'security_key', 'server_address', 'session_security_settings', 'udp_mode', 'username',
    ]);
  });

  it('asks for no C2S UDP, a forced login and no keep-alive override', async () => {
    const body: Body = await connectPayload();
    expect(body.udp_mode).toBe('Disabled');
    expect(body.connect_mode).toEqual({ Standard: { force_login: true } });
    expect(body.keep_alive_timeout).toBeNull();
    expect(body.server_address).toBe('bench.work.avarok.net');
  });

  it('carries the session settings it was given, field for field', async () => {
    expect((await connectPayload(HIGH)).session_security_settings).toEqual({
      security_level: 'High', secrecy_mode: 'Perfect',
      header_obfuscator_settings: HIGH.header_obfuscator_settings, crypto_params: HIGH.crypto_params,
    });
  });

  it('carries the defaults when given none', async () => {
    expect((await connectPayload()).session_security_settings).toEqual(getDefaultSecuritySettings());
  });
});

describe('a peer connection', () => {
  function rig(sent: Body[]): P2POperations {
    return new P2POperations({
      init: async (): Promise<void> => {},
      sendMessage: async (message: unknown): Promise<void> => { sent.push(message as Body); throw new Error('stop'); },
      isLeader: (): boolean => true,
      turnFor: async (): Promise<null> => null,
      securityFor: async (): Promise<'Standard'> => 'Standard',
    });
  }

  it('asks for UDP when opened, which a call needs', async () => {
    const sent: Body[] = [];
    await rig(sent).openP2PConnection(1n, 2n).catch((): undefined => undefined);
    expect((sent[0].PeerConnect as Body).udp_mode).toBe('Enabled');
  });

  it('asks for UDP when accepted, even when the offer named none', async () => {
    const sent: Body[] = [];
    await rig(sent).acceptPeerConnect(1n, 2n, {}).catch((): undefined => undefined);
    expect((sent[0].PeerConnectAccept as Body).udp_mode).toBe('Enabled');
  });
});
