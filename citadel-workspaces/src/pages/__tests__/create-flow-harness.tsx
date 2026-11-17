/**
 * The create-workspace flow's test harness, shared by the specs that drive it: the control plane
 * at the fetch boundary (contract-fake.ts, so the real client runs) and Cloudflare's Turnstile
 * widget as `window.turnstile` (the real one needs the network and a person).
 */
import { beforeEach, afterEach, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CreateWorkspaceFlow } from '../CreateWorkspace';
import { createControlPlane, type ControlPlane } from '@/lib/onboarding/control-plane-client';
import { forgetIssuedClaim } from '@/lib/onboarding/claim-handoff';
import { clearDraft } from '@/lib/onboarding/create-flow';
import type { ContractFake } from '@/lib/onboarding/__tests__/contract-fake';

let tokens: number = 0;
export const resets: string[] = [];

function installTurnstile(): void {
  window.turnstile = {
    render: (_el: HTMLElement, options: { callback: (token: string) => void }): string => {
      setTimeout(() => options.callback(`token-${++tokens}`), 0);
      window.turnstileCallback = options.callback;
      return 'widget-1';
    },
    reset: (id: string): void => {
      resets.push(id);
      setTimeout(() => window.turnstileCallback?.(`token-${++tokens}`), 0);
    },
    remove: (): void => {},
  };
}

declare global {
  interface Window {
    turnstileCallback?: (token: string) => void;
  }
}

export function renderFlow(fake: ContractFake, at: string = '/create', redirect: (url: string) => void = vi.fn()): RenderResult {
  const api: ControlPlane = createControlPlane(fake.fetch, '/api');
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/create" element={<CreateWorkspaceFlow api={api} redirect={redirect} />} />
        <Route path="/create/done" element={<CreateWorkspaceFlow api={api} redirect={redirect} />} />
        <Route path="/" element={<p>landing</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

export async function nameIt(name: string): Promise<void> {
  fireEvent.change(screen.getByTestId('create-display-name'), { target: { value: name } });
}

export async function throughToReview(choosePlan: () => void): Promise<void> {
  await nameIt('Acme');
  await waitFor(() => expect(screen.getByTestId('create-name-continue')).toBeEnabled());
  fireEvent.click(screen.getByTestId('create-name-continue'));
  choosePlan();
  fireEvent.click(screen.getByTestId('create-plan-continue'));
  await waitFor(() => expect(screen.getByTestId('create-submit')).toBeEnabled());
}


/** Presses Create and accepts the terms it puts up. */
export async function submitWithTerms(): Promise<void> {
  fireEvent.click(screen.getByTestId('create-submit'));
  fireEvent.click(await screen.findByTestId('terms-agree'));
  fireEvent.click(screen.getByTestId('terms-accept'));
}

export function installFlowHooks(): void {
  beforeEach(() => {
    installTurnstile();
    forgetIssuedClaim();
    clearDraft();
    tokens = 0;
    resets.length = 0;
  });
  afterEach(() => {
    delete window.turnstile;
  });
}
