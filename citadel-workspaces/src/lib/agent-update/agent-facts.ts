/**
 * What the agent's greeting says about the agent itself, for the About tab. The greeting is the
 * first message on every socket; an agent that does not say a thing leaves it unknown (an older
 * agent says none of this), and unknown is never filled in with a guess.
 *
 * Field names, for the agent to add to its greeting: `agent_version` and `os`. `types_hash` the
 * agent does say (0.13.1+): the identity of the wire types it was built from (types-step.ts).
 */
import { createValueStore, type ValueStore } from '@/lib/value-store';

export interface AgentFacts {
  version?: string;
  os?: string;
  /** Absent until a greeting is read; null when the greeting said none (an agent before 0.13.1). */
  typesHash?: string | null;
}

export const agentFacts: ValueStore<AgentFacts> = createValueStore<AgentFacts>('agent-facts', {});

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

export function readGreetingFacts(greeting: Record<string, unknown>): AgentFacts {
  const facts: AgentFacts = {};
  const version: string | undefined = text(greeting.agent_version);
  const os: string | undefined = text(greeting.os);
  if (version !== undefined) facts.version = version;
  if (os !== undefined) facts.os = os;
  facts.typesHash = text(greeting.types_hash) ?? null;
  return facts;
}
