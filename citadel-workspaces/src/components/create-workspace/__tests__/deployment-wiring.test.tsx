/**
 * The seams between the create-workspace flow and the rest of the app:
 *
 *   - the landing link appears only where the deployment can create workspaces;
 *   - `/create` on a deployment that cannot says so rather than failing later;
 *   - while the flow is on screen, the connection-retry dialog stands down;
 *   - the initialization dialog is offered the claim code for the workspace
 *     this page created, and only that one.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, renderHook, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useState, type JSX } from 'react';
import { CreateWorkspaceCta } from '../CreateWorkspaceCta';
import CreateWorkspace from '@/pages/CreateWorkspace';
import { useAgentOptionalHere, useAgentRequired } from '@/lib/onboarding/agent-optional';
import { forgetIssuedClaim, recordIssuedClaim } from '@/lib/onboarding/claim-handoff';
import { useClaimCodePrefill } from '@/lib/onboarding/use-claim-code-prefill';

function publish(content: string): void {
  const meta: HTMLMetaElement = document.createElement('meta');
  meta.name = 'citadel-control-plane';
  meta.content = content;
  document.head.appendChild(meta);
}

afterEach(() => {
  document.head.querySelectorAll('meta[name="citadel-control-plane"]').forEach((m) => m.remove());
  forgetIssuedClaim();
});

describe('the landing link', () => {
  it('is absent where the deployment publishes no control plane', () => {
    render(<MemoryRouter><CreateWorkspaceCta /></MemoryRouter>);
    expect(screen.queryByTestId('create-workspace-link')).toBeNull();
  });

  it('links to /create where it does', () => {
    publish('/api');
    render(<MemoryRouter><CreateWorkspaceCta /></MemoryRouter>);
    expect(screen.getByTestId('create-workspace-link')).toHaveAttribute('href', '/create');
  });
});

describe('/create without a control plane', () => {
  it('says workspaces are not created here, and offers the wizard', () => {
    render(<MemoryRouter initialEntries={['/create']}><CreateWorkspace /></MemoryRouter>);
    expect(screen.getByTestId('create-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('create-display-name')).toBeNull();
  });

  it('opens the flow when one is published', () => {
    publish('/api');
    render(<MemoryRouter initialEntries={['/create']}><CreateWorkspace /></MemoryRouter>);
    expect(screen.getByTestId('create-display-name')).toBeInTheDocument();
  });
});

function AgentOptional(): null {
  useAgentOptionalHere();
  return null;
}

function Harness(): JSX.Element {
  const [shown, setShown] = useState<boolean>(true);
  const required: boolean = useAgentRequired();
  return (
    <>
      {shown && <AgentOptional />}
      <output data-testid="required">{String(required)}</output>
      <button type="button" onClick={() => setShown(false)}>leave</button>
    </>
  );
}

describe('the connection-retry dialog', () => {
  it('stands down only while an agent-optional page is mounted', () => {
    const { result } = renderHook(() => useAgentRequired());
    expect(result.current, 'the control: required by default').toBe(true);

    render(<Harness />);
    expect(screen.getByTestId('required')).toHaveTextContent('false');
    act(() => screen.getByText('leave').click());
    expect(screen.getByTestId('required')).toHaveTextContent('true');
  });
});

describe('the claim-code pre-fill', () => {
  beforeEach(() => recordIssuedClaim('acme.work.avarok.net', 'CLAIM-ABC'));

  function run(isOpen: boolean, address: string | undefined, typed: string = ''): { value: string; prefilled: boolean } {
    let value: string = typed;
    const setValue = (update: (current: string) => string): void => {
      value = update(value);
    };
    const { result } = renderHook(() => useClaimCodePrefill(isOpen, address, setValue));
    return { value, prefilled: result.current };
  }

  it('fills the code in for the workspace it was issued for', () => {
    // A hosted tenant is joined at its bare host (no port; see workspace-address.ts).
    expect(run(true, 'acme.work.avarok.net')).toEqual({ value: 'CLAIM-ABC', prefilled: true });
    expect(run(true, 'acme.work.avarok.net:12400')).toEqual({ value: '', prefilled: false });
  });

  it('does nothing for another workspace, or while closed', () => {
    expect(run(true, 'other.example.com:12400')).toEqual({ value: '', prefilled: false });
    expect(run(false, 'acme.work.avarok.net')).toEqual({ value: '', prefilled: false });
  });

  it('never overwrites what the user typed', () => {
    expect(run(true, 'acme.work.avarok.net', 'typed-by-hand').value).toBe('typed-by-hand');
  });
});
