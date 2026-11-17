/**
 * What a tab does with the agent's reports on its server link.
 *
 * The handler takes its I/O as arguments, so these run it against recorders:
 * the banner, the P2P resume and the sign-in redirect are the three outcomes.
 */
import { describe, it, expect } from 'vitest';
import { handleServerReconnectEvent, signInAfterLoss, type OwnSession, type ServerReconnectIO } from '../server-reconnect';
import { readAgentReconnectEvent, type AgentReconnectEvent } from '@/types/agent-reconnect';
import { parseAccountLink } from '@/lib/onboarding/account-link';

const OWN: OwnSession = { cid: 42n, username: 'alice', server: 'bench.work.avarok.net' };

interface Recorder { io: ServerReconnectIO; banner: Array<string | null>; resumed: () => number; reloaded: bigint[]; signIns: Array<[string, string]> }

function recorder(own: OwnSession | null = OWN): Recorder {
  const banner: Array<string | null> = [];
  const signIns: Array<[string, string]> = [];
  const reloaded: bigint[] = [];
  let resumed: number = 0;
  return {
    io: {
      ownSession: async (): Promise<OwnSession | null> => own,
      setReconnecting: (server: string | null): void => { banner.push(server); },
      resumePeers: async (): Promise<void> => { resumed += 1; },
      reloadWorkspace: async (cid: bigint): Promise<void> => { reloaded.push(cid); },
      signInAgain: (path: string, message: string): void => { signIns.push([path, message]); },
    },
    banner,
    resumed: (): number => resumed,
    reloaded,
    signIns,
  };
}

describe('the agent reports on this tab session', () => {
  it('shows "Reconnecting" while the agent retries', async () => {
    const r: Recorder = recorder();
    await handleServerReconnectEvent({ kind: 'lost', cid: 42n, reconnecting: true }, r.io);
    expect(r.banner).toEqual(['bench.work.avarok.net']);
    expect(r.signIns).toEqual([]);
  });

  it('clears it and brings the P2P links back up once reconnected', async () => {
    const r: Recorder = recorder();
    await handleServerReconnectEvent({ kind: 'reconnected', cid: 42n }, r.io);
    expect(r.banner).toEqual([null]);
    expect(r.resumed()).toBe(1);
  });

  // Live: a page reloaded while the link was down asked for its workspace into the dead
  // link, and after "reconnected" nothing asked again -- it stayed on "Workspace data is
  // taking longer than expected" with the session back.
  it('asks for the workspace again once reconnected, since requests sent into the drop were lost', async () => {
    const r: Recorder = recorder();
    await handleServerReconnectEvent({ kind: 'reconnected', cid: 42n }, r.io);
    expect(r.reloaded).toEqual([42n]);
  });

  it('does not reload anything while the agent is still retrying', async () => {
    const r: Recorder = recorder();
    await handleServerReconnectEvent({ kind: 'lost', cid: 42n, reconnecting: true }, r.io);
    expect(r.reloaded).toEqual([]);
  });

  it('sends the user to sign in to the same account when the agent gives up', async () => {
    const r: Recorder = recorder();
    await handleServerReconnectEvent({ kind: 'failed', cid: 42n, reason: 'session expired', reasonCode: null }, r.io);
    expect(r.banner).toEqual([null]);
    expect(r.resumed()).toBe(0);
    const [path, message]: [string, string] = r.signIns[0];
    expect(message).toContain('bench.work.avarok.net');
    expect(message).toContain('session expired');
    // The path is one the landing page's own parser accepts, for this account.
    expect(path.startsWith('/?')).toBe(true);
    expect(parseAccountLink(new URLSearchParams(path.slice(2)))).toEqual({ username: 'alice', server: 'bench.work.avarok.net' });
  });

  it('says why in the user\'s words when the server no longer has the account', async () => {
    const r: Recorder = recorder();
    // The reason exactly as the agent reported it after a server restart lost its accounts.
    const reason: string = 'CID not registered to this node: CID 13052272920576059510 is not registered to this node';
    await handleServerReconnectEvent({ kind: 'failed', cid: 42n, reason, reasonCode: null }, r.io);
    const [, message]: [string, string] = r.signIns[0];
    expect(message).toContain('the workspace no longer has this account');
    expect(message).not.toContain('CID');
  });

  it('treats a drop the agent is not retrying as a failure', async () => {
    const r: Recorder = recorder();
    await handleServerReconnectEvent({ kind: 'lost', cid: 42n, reconnecting: false }, r.io);
    expect(r.signIns).toHaveLength(1);
  });
});

describe('a report about some other session', () => {
  it('changes nothing on this tab', async () => {
    for (const event of [
      { kind: 'lost', cid: 7n, reconnecting: true },
      { kind: 'reconnected', cid: 7n },
      { kind: 'failed', cid: 7n, reason: 'x', reasonCode: null },
    ] satisfies AgentReconnectEvent[]) {
      const r: Recorder = recorder();
      await handleServerReconnectEvent(event, r.io);
      expect(r.banner).toEqual([]);
      expect(r.resumed()).toBe(0);
      expect(r.reloaded).toEqual([]);
      expect(r.signIns).toEqual([]);
    }
  });

  it('changes nothing on a tab that holds no session', async () => {
    const r: Recorder = recorder(null);
    await handleServerReconnectEvent({ kind: 'failed', cid: 42n, reason: 'x', reasonCode: null }, r.io);
    expect(r.signIns).toEqual([]);
  });
});

describe('reading the notifications off the wire', () => {
  it('reads each of the three, bare or wrapped in Response', () => {
    expect(readAgentReconnectEvent({ ServerConnectionLost: { cid: 1n, reconnecting: true, request_id: null } })).toEqual({ kind: 'lost', cid: 1n, reconnecting: true });
    expect(readAgentReconnectEvent({ Response: { ServerReconnected: { cid: 1n, request_id: null } } })).toEqual({ kind: 'reconnected', cid: 1n });
    expect(readAgentReconnectEvent({ ServerReconnectFailed: { cid: 1n, reason: 'r', request_id: null } })).toEqual({ kind: 'failed', cid: 1n, reason: 'r', reasonCode: null });
  });

  // What the WASM client actually delivers (captured in the browser): serde-wasm-bindgen
  // turns the agent's `None` into `undefined`, not `null`.
  it('reads them as the WASM client delivers them, request_id undefined', () => {
    expect(readAgentReconnectEvent({ ServerConnectionLost: { cid: 1n, reconnecting: true, request_id: undefined } })).toEqual({ kind: 'lost', cid: 1n, reconnecting: true });
    expect(readAgentReconnectEvent({ ServerReconnected: { cid: 1n } })).toEqual({ kind: 'reconnected', cid: 1n });
    expect(readAgentReconnectEvent({ ServerReconnectFailed: { cid: 1n, reason: 'r', request_id: undefined } })).toEqual({ kind: 'failed', cid: 1n, reason: 'r', reasonCode: null });
  });

  it('refuses a body with the wrong field types', () => {
    const wrong: unknown[] = [
      { ServerConnectionLost: { cid: '1', reconnecting: true, request_id: null } },
      { ServerConnectionLost: { cid: 1n, request_id: null } },
      { ServerReconnected: { cid: 1, request_id: null } },
      { ServerReconnectFailed: { cid: 1n, reason: 5, request_id: null } },
      { ServerReconnected: { cid: 1n, request_id: 3 } },
      { MessageNotification: { cid: 1n } },
      null,
      'ServerReconnected',
    ];
    for (const message of wrong) expect(readAgentReconnectEvent(message)).toBeNull();
  });
});

describe('the account link it builds', () => {
  it('leaves out a server the parser would refuse, rather than breaking the link', async () => {
    const r: Recorder = recorder({ ...OWN, server: 'not a server' });
    await handleServerReconnectEvent({ kind: 'failed', cid: 42n, reason: '', reasonCode: null }, r.io);
    expect(parseAccountLink(new URLSearchParams(r.signIns[0][0].slice(2)))).toEqual({ username: 'alice' });
  });
});

describe('signing in after a session the agent could not keep', () => {
  it('opens sign-in for that account and says the session ended while its link was down', () => {
    const { path, message } = signInAfterLoss('alice', 'bench.work.avarok.net', 'Session 42 is not claimable: SDK session is disconnected', null);
    expect(parseAccountLink(new URLSearchParams(path.slice(2)))).toEqual({ username: 'alice', server: 'bench.work.avarok.net' });
    expect(message).toBe("Couldn't reconnect to bench.work.avarok.net (the session ended while its link to the workspace was down). Sign in again to continue.");
  });
});
