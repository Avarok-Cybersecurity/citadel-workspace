/**
 * Whether anything on the agent's side shows its native notices.
 *
 * The agent shows a message's OS notification only through a notifier
 * attached to it -- the macOS menu-bar app; Windows and Linux have none. It says
 * whether one is in its answer to the declaration (`notices_heard`) and again
 * whenever that changes (`NoticesHeardNotification`). A window that is not told
 * -- a lost socket -- takes it that nothing is.
 *
 * The socket is a fake client with the two calls the declaration uses.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { InternalServiceRequest, InternalServiceResponse } from 'citadel-workspace-client-ts';
import { declareOnLeaderSocket, forgetCapabilities, watchGreeting, noticesHeard, type DeclaringClient, type Greeting } from '../capabilities';

/** An agent that answers the declaration, with `notices_heard`. */
function socket(heard: boolean): DeclaringClient {
  let match: ((m: InternalServiceResponse) => unknown) | null = null;
  let settle: ((v: unknown) => void) | null = null;
  return {
    async sendDirectToInternalService(request: InternalServiceRequest): Promise<void> {
      const id: unknown = (request as { ConnectionManagement: { request_id: string } }).ConnectionManagement.request_id;
      const answer: Record<string, unknown> = { cid: 0n, request_id: id, multi_window: true, notices_heard: heard };
      settle?.(match?.({ AgentCapabilities: answer } as unknown as InternalServiceResponse));
    },
    nextResponse<T>(extract: (m: InternalServiceResponse) => T | undefined): Promise<T> {
      match = extract;
      return new Promise<T>((resolve) => { settle = resolve as (v: unknown) => void; });
    },
  };
}

function greeted(): Greeting {
  const g: Greeting = watchGreeting();
  g.observe({ ServiceConnectionAccepted: { cid: 0n, request_id: null } });
  return g;
}

beforeEach(() => { forgetCapabilities(); });

describe('on declaring', () => {
  it('the agent says a notifier is attached', async () => {
    await declareOnLeaderSocket(socket(true), greeted());
    expect(noticesHeard.get()).toBe(true);
  });

  it('or that none is', async () => {
    await declareOnLeaderSocket(socket(false), greeted());
    expect(noticesHeard.get()).toBe(false);
  });
});

describe('afterwards', () => {
  it('follows the agent as the menu-bar app comes and goes', async () => {
    const greeting: Greeting = greeted();
    await declareOnLeaderSocket(socket(false), greeting);
    greeting.observe({ NoticesHeardNotification: { cid: 0n, heard: true, request_id: null } });
    expect(noticesHeard.get()).toBe(true);
    greeting.observe({ NoticesHeardNotification: { cid: 0n, heard: false, request_id: null } });
    expect(noticesHeard.get()).toBe(false);
  });

  it('is forgotten with the socket it was said on', async () => {
    await declareOnLeaderSocket(socket(true), greeted());
    forgetCapabilities();
    expect(noticesHeard.get()).toBe(false);
  });
});
