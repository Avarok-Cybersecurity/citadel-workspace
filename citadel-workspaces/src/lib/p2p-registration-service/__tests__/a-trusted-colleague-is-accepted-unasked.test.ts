/**
 * Under the workspace's messaging trust policy a colleague's request is accepted without asking,
 * and only on the SERVER's say-so: any failure to get a clear answer leaves the person to decide.
 *
 * The decision is driven with its effects injected as recorders, as the stranger suite does; the
 * trust check is driven against a stub of its one I/O boundary, the bound workspace request.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  decideIncomingRequest, handleIncomingRegistration, type IncomingRegistrationDeps, type IncomingRequestAction,
} from '../incoming-request-policy';
import { askPeerTrust, PEER_TRUST_TIMEOUT_MS, UNTRUSTED } from '@/lib/messaging-trust/peer-trust';
import type { MessagingTrustApi } from '@/lib/messaging-trust/messaging-trust-api';
import type { PeerTrust } from '@/lib/workspace-service/messaging-trust-operations';

const REQUEST: { recipientCid: bigint; peerCid: bigint; peerUsername: string } = {
  recipientCid: 7n, peerCid: 42n, peerUsername: 'colleague',
};

function recorder(trusted: () => Promise<boolean>): { calls: IncomingRequestAction[]; deps: IncomingRegistrationDeps } {
  const calls: IncomingRequestAction[] = [];
  const deps: IncomingRegistrationDeps = {
    trustedByWorkspace: trusted,
    // The strictest stranger settings: only trust can let this request in unasked.
    acceptsRequestsFromStrangers: (): boolean => false,
    isContact: (): boolean => false,
    weAskedThemFirst: (): boolean => false,
    readAutoAccept: async (): Promise<boolean> => false,
    accept: async (): Promise<void> => { calls.push('auto-accept'); },
    ask: async (): Promise<void> => { calls.push('ask'); },
    decline: async (): Promise<void> => { calls.push('decline'); },
  };
  return { calls, deps };
}

type CheckApi = Pick<MessagingTrustApi, 'checkPeer' | 'sessionCid'>;
function api(checkPeer: (username: string) => Promise<PeerTrust>, sessionCid: bigint | null = 7n): CheckApi {
  return { checkPeer, sessionCid: (): bigint | null => sessionCid };
}

afterEach(() => { vi.useRealTimers(); });

describe('a request from someone the workspace trusts', () => {
  it('is accepted unasked, ahead of the stranger rule and the auto-accept switch', async () => {
    const { calls, deps } = recorder(async (): Promise<boolean> => true);
    await handleIncomingRegistration(REQUEST, deps);
    expect(calls).toEqual(['auto-accept']);
    expect(decideIncomingRequest({
      trustedByWorkspace: true, acceptsRequestsFromStrangers: false, isContact: false, weAskedThemFirst: false, autoAccept: false,
    })).toBe('auto-accept');
  });

  it('falls back to the stranger rule when the server says no', async () => {
    const { calls, deps } = recorder(async (): Promise<boolean> => false);
    await handleIncomingRegistration(REQUEST, deps);
    expect(calls).toEqual(['decline']);
  });

  it('is never accepted on a check that failed', async () => {
    const { calls, deps } = recorder(async (): Promise<boolean> => { throw new Error('socket closed'); });
    await handleIncomingRegistration(REQUEST, deps);
    expect(calls).toEqual(['decline']);
  });
});

describe('asking the server about a peer', () => {
  const YES: PeerTrust = { trusted: true, peerTrustsCaller: true };

  it('passes the server\'s answer through', async () => {
    expect(await askPeerTrust(api(async (): Promise<PeerTrust> => YES), 7n, 'colleague')).toEqual(YES);
  });

  it('is untrusted when the request is refused', async () => {
    const refused: CheckApi = api(async (): Promise<PeerTrust> => { throw new Error('Permission denied'); });
    expect(await askPeerTrust(refused, 7n, 'colleague')).toEqual(UNTRUSTED);
  });

  it('is untrusted when the server is silent', async () => {
    vi.useFakeTimers();
    const silent: CheckApi = api((): Promise<PeerTrust> => new Promise<PeerTrust>((): void => {}));
    const answer: Promise<PeerTrust> = askPeerTrust(silent, 7n, 'colleague');
    await vi.advanceTimersByTimeAsync(PEER_TRUST_TIMEOUT_MS);
    expect(await answer).toEqual(UNTRUSTED);
  });

  it('is not asked as another session, nor without a name', async () => {
    const checkPeer: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<PeerTrust> => YES);
    expect(await askPeerTrust(api(checkPeer, 8n), 7n, 'colleague')).toEqual(UNTRUSTED);
    expect(await askPeerTrust(api(checkPeer, null), 7n, 'colleague')).toEqual(UNTRUSTED);
    expect(await askPeerTrust(api(checkPeer), 7n, undefined)).toEqual(UNTRUSTED);
    expect(checkPeer).not.toHaveBeenCalled();
  });
});
