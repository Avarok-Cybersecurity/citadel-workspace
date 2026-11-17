/**
 * Which conversation store answers: the browser-written one, or the agent.
 *
 * Chosen per call, because the answer arrives with the socket and can change
 * with it (agent-conversations/capabilities.ts). Same methods either way; the
 * agent's are in agent-conversations/agent-store.ts.
 */
import { agentHostsConversations } from '@/lib/agent-conversations/capabilities';
import { agentStore } from '@/lib/agent-conversations/agent-store';

export function switchedStore<S extends object>(browserStore: S): S {
  return new Proxy(browserStore, {
    get(target: S, prop: string | symbol): unknown {
      const own: unknown = Reflect.get(target, prop);
      if (typeof own !== 'function') return own;
      return async (...args: unknown[]): Promise<unknown> => {
        const impl: Record<string | symbol, unknown> = (await agentHostsConversations())
          ? (agentStore as unknown as Record<string | symbol, unknown>)
          : (target as unknown as Record<string | symbol, unknown>);
        const method: unknown = impl[prop];
        if (typeof method !== 'function') throw new Error(`The conversation store has no ${String(prop)}`);
        return (method as (...a: unknown[]) => Promise<unknown>).apply(impl, args);
      };
    },
  });
}
