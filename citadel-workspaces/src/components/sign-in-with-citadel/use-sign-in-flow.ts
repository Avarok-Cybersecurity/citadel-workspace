/**
 * The sign-in flow for this page, wired to the browser: the issuer at this origin, the agent on
 * this window's socket, the return as a form POST. One flow per mount, started with the link.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { eventEmitter } from '@/lib/event-emitter';
import { SignInFlow } from '@/lib/sign-in-with-citadel/flow';
import type { SignInState } from '@/lib/sign-in-with-citadel/flow-state';
import type { SignInPorts } from '@/lib/sign-in-with-citadel/ports';
import { httpIssuer } from '@/lib/sign-in-with-citadel/issuer-http';
import { socketAgent } from '@/lib/sign-in-with-citadel/agent-socket';
import { formReturner } from '@/lib/sign-in-with-citadel/return-form';

/** A uniform index from the CSPRNG (rejection sampling, so no index is likelier than another). */
function randomIndex(bound: number): number {
  const limit: number = Math.floor(0x1_0000_0000 / bound) * bound;
  const word: Uint32Array = new Uint32Array(1);
  do crypto.getRandomValues(word); while (word[0] >= limit);
  return word[0] % bound;
}

export function browserPorts(): SignInPorts {
  return { issuer: httpIssuer((input, init) => fetch(input, init)), agent: socketAgent(), returner: formReturner(document), randomIndex };
}

export function useSignInFlow(search: string, ports: () => SignInPorts): { state: SignInState; flow: SignInFlow } {
  const flow: SignInFlow = useMemo(() => new SignInFlow(ports()), [ports]);
  const state: SignInState = useSyncExternalStore(
    (notify: () => void) => flow.subscribe(notify),
    () => flow.state,
  );
  useEffect(() => { void flow.start(search); }, [flow, search]);
  // An agent that comes up while "install it" shows is found without a click.
  useEffect(() => {
    if (state.step !== 'no-agent') return undefined;
    return eventEmitter.on('on-ws-connection-success', () => { void flow.retry(); });
  }, [flow, state.step]);
  return { state, flow };
}
