/**
 * The page compares the agent's types hash with its own and says, in words, when they differ.
 * The greeting is read as the wire sends it: a plain object, `types_hash` a string or absent.
 */
import { describe, expect, it } from 'vitest';
import { readGreetingFacts } from '../agent-facts';
import { typesStep, type TypesStep } from '../types-step';

const A: string = 'a'.repeat(64);
const B: string = 'b'.repeat(64);

describe('the types handshake', () => {
  it('reads the agent\'s hash from its greeting', () => {
    expect(readGreetingFacts({ agent_ilm: true, types_hash: A }).typesHash).toBe(A);
  });

  it('is silent while either side has not said', () => {
    expect(typesStep({}, A)).toBeNull();
    expect(typesStep({ typesHash: A }, null)).toBeNull();
  });

  it('is in step when the two hashes are equal', () => {
    expect(typesStep(readGreetingFacts({ types_hash: A }), A)).toEqual({ kind: 'in-step' });
  });

  it('names both sides and what to do when they differ', () => {
    const step: TypesStep | null = typesStep(readGreetingFacts({ types_hash: A, agent_version: '0.13.1' }), B);
    expect(step?.kind).toBe('out-of-step');
    expect(step && 'text' in step ? step.text : '').toBe(
      'Citadel Agent 0.13.1 and this page are out of step (agent aaaaaaaa, page bbbbbbbb), so messages between them may fail. Update the agent, then reload this page.',
    );
  });

  it('says an agent from before the handshake cannot be checked, rather than guess it matches', () => {
    expect(typesStep(readGreetingFacts({ agent_ilm: true }), A)?.kind).toBe('agent-too-old');
  });
});
