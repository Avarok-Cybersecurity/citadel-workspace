/**
 * Whether this page and the agent were built from the same wire types.
 *
 * Each says which: the agent in its greeting (`types_hash`), this page through its WASM client
 * (`typesHash()`), both the SHA3-256 the types crate computes over its generated bindings
 * (citadel-internal-service-types/build_types_hash.rs). Different hashes mean one of the two
 * would send a field the other has never heard of, or read one it does not get, and the failure
 * would surface far from its cause (2026-11-18: "Failed to deserialize outbound_messages map").
 * So it is said up front, in words, with what to do.
 *
 * Which side is older cannot be read from two hashes, so the advice covers both: update the
 * agent, then reload the page.
 */
import { createValueStore, type ValueStore } from '@/lib/value-store';
import type { AgentFacts } from './agent-facts';

/** This page's WASM client's types hash; null until the client has loaded. */
export const pageTypesHash: ValueStore<string | null> = createValueStore<string | null>('page-types-hash', null);

export type TypesStep =
  | { kind: 'in-step' }
  | { kind: 'out-of-step'; text: string }
  | { kind: 'agent-too-old'; text: string };

function short(hash: string): string {
  return hash.slice(0, 8);
}

/** Null while either side has not yet said (no greeting read, no WASM loaded). */
export function typesStep(agent: AgentFacts, page: string | null): TypesStep | null {
  if (agent.typesHash === undefined || page === null) return null;
  const name: string = agent.version ? `Citadel Agent ${agent.version}` : 'The Citadel Agent';
  if (agent.typesHash === null) {
    return { kind: 'agent-too-old', text: `${name} is too old to say which types it was built with, so this page cannot check that the two match. Update the agent.` };
  }
  if (agent.typesHash === page) return { kind: 'in-step' };
  return {
    kind: 'out-of-step',
    text: `${name} and this page are out of step (agent ${short(agent.typesHash)}, page ${short(page)}), so messages between them may fail. Update the agent, then reload this page.`,
  };
}
