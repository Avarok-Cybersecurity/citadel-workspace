/**
 * "Accept requests from people you're not connected with: off" has to be kept
 * where the request is answered — this client, on receipt of the peer's
 * registration request. Nothing else decides: the SDK waits for our answer.
 *
 * These drive `handleIncomingRegistration` with its effects injected as plain
 * recorders rather than module mocks: the decision and the dispatch on it are
 * what is under test, and each effect is a one-line call into code with its
 * own tests (`sendRegistrationDecline` in decline-reaches-the-sender, the
 * pending store in its own suite).
 */
import { describe, it, expect } from 'vitest';
import {
  decideIncomingRequest,
  handleIncomingRegistration,
  type IncomingRegistrationDeps,
  type IncomingRequestAction,
} from '../incoming-request-policy';

interface Recorded { calls: IncomingRequestAction[]; deps: IncomingRegistrationDeps }

function recorder(overrides: Partial<Omit<IncomingRegistrationDeps, 'accept' | 'ask' | 'decline'>>): Recorded {
  const calls: IncomingRequestAction[] = [];
  const deps: IncomingRegistrationDeps = {
    // Not trusted by the workspace: these are about the stranger rule that applies outside it.
    trustedByWorkspace: async (): Promise<boolean> => false,
    acceptsRequestsFromStrangers: (): boolean => true,
    isContact: (): boolean => false,
    weAskedThemFirst: (): boolean => false,
    readAutoAccept: async (): Promise<boolean> => false,
    accept: async (): Promise<void> => { calls.push('auto-accept'); },
    ask: async (): Promise<void> => { calls.push('ask'); },
    decline: async (): Promise<void> => { calls.push('decline'); },
    ...overrides,
  };
  return { calls, deps };
}

const REQUEST: { recipientCid: bigint; peerCid: bigint; peerUsername: string } = {
  recipientCid: 7n, peerCid: 42n, peerUsername: 'mallory',
};

describe('a registration request from a stranger', () => {
  it('is declined, not queued, when strangers are refused', async () => {
    const { calls, deps } = recorder({ acceptsRequestsFromStrangers: () => false });
    await handleIncomingRegistration(REQUEST, deps);
    expect(calls).toEqual(['decline']);
  });

  it('is declined even when auto-accept is on', async () => {
    // Auto-accept is "don't ask me"; it is not "let strangers in anyway".
    const { calls, deps } = recorder({
      acceptsRequestsFromStrangers: () => false,
      readAutoAccept: async () => true,
    });
    await handleIncomingRegistration(REQUEST, deps);
    expect(calls).toEqual(['decline']);
  });

  it('is asked about as before when strangers are accepted', async () => {
    // Discrimination: without it the two above pass against a handler that
    // declines everything.
    const { calls, deps } = recorder({ acceptsRequestsFromStrangers: () => true });
    await handleIncomingRegistration(REQUEST, deps);
    expect(calls).toEqual(['ask']);
  });
});

describe('people who are not strangers', () => {
  it('an existing contact is unaffected by refusing strangers', async () => {
    const { calls, deps } = recorder({
      acceptsRequestsFromStrangers: () => false,
      isContact: () => true,
    });
    await handleIncomingRegistration(REQUEST, deps);
    expect(calls).toEqual(['ask']);
  });

  it('someone we sent a request to is answering it, not asking', async () => {
    // Accepting a request is the recipient registering back, which reaches the
    // original requester as a request of its own. Refusing that as a stranger
    // would make every request anyone sent them impossible to accept.
    const { calls, deps } = recorder({
      acceptsRequestsFromStrangers: () => false,
      weAskedThemFirst: (peer: bigint, cid: bigint) => peer === 42n && cid === 7n,
      readAutoAccept: async () => true,
    });
    await handleIncomingRegistration(REQUEST, deps);
    expect(calls).toEqual(['auto-accept']);
  });
});

describe('decideIncomingRequest', () => {
  it('covers every combination the handler can be asked about', () => {
    const table: Array<[boolean, boolean, boolean, boolean, IncomingRequestAction]> = [
      // accepts, contact, askedFirst, autoAccept -> action
      [false, false, false, false, 'decline'],
      [false, false, false, true, 'decline'],
      [false, true, false, false, 'ask'],
      [false, false, true, true, 'auto-accept'],
      [true, false, false, false, 'ask'],
      [true, false, false, true, 'auto-accept'],
    ];
    for (const [acceptsRequestsFromStrangers, isContact, weAskedThemFirst, autoAccept, want] of table) {
      expect(
        decideIncomingRequest({ trustedByWorkspace: false, acceptsRequestsFromStrangers, isContact, weAskedThemFirst, autoAccept }),
        JSON.stringify({ acceptsRequestsFromStrangers, isContact, weAskedThemFirst, autoAccept }),
      ).toBe(want);
    }
  });
});
