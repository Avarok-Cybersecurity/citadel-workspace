/**
 * The agent's greeting and this page's WASM client disagree on the wire types: the page says so
 * on screen, in words, and says nothing when they agree or before both have spoken.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { TypesStepBanner, useTypesStep } from '../TypesStepBanner';
import { agentFacts, readGreetingFacts } from '@/lib/agent-update/agent-facts';
import { pageTypesHash } from '@/lib/agent-update/types-step';

const A: string = 'a'.repeat(64);
const B: string = 'b'.repeat(64);

function Probe(): JSX.Element | null {
  return <TypesStepBanner step={useTypesStep()} />;
}

describe('the out-of-step banner', () => {
  beforeEach((): void => { agentFacts.set({}); pageTypesHash.set(null); });

  it('names the agent and both hashes when they differ', () => {
    render(<Probe />);
    act((): void => { pageTypesHash.set(B); agentFacts.set(readGreetingFacts({ types_hash: A, agent_version: '0.13.1' })); });
    const banner: HTMLElement = screen.getByTestId('types-step-banner');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain('Citadel Agent 0.13.1 and this page are out of step (agent aaaaaaaa, page bbbbbbbb)');
  });

  it('says nothing when they match, or before the greeting', () => {
    render(<Probe />);
    act((): void => { pageTypesHash.set(A); });
    expect(screen.queryByTestId('types-step-banner')).toBeNull();
    act((): void => { agentFacts.set(readGreetingFacts({ types_hash: A })); });
    expect(screen.queryByTestId('types-step-banner')).toBeNull();
    // The control: the same render with a different hash does show it.
    act((): void => { agentFacts.set(readGreetingFacts({ types_hash: B })); });
    expect(screen.getByTestId('types-step-banner')).toBeTruthy();
  });
});
