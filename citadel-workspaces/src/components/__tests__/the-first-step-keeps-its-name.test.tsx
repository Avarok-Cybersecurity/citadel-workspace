/**
 * The registration stepper renamed its first step as the user moved past it.
 *
 * Seen on the live site: step one read "Current step: WORKSPACE" on the connect
 * card, then "Completed: SERVER" on the security and profile cards. The connect
 * card had been changed to say Workspace (its field is Workspace Address), but
 * the other two steps each kept their own copy of the label list, still saying
 * Server. The same step with two names makes the user wonder whether they
 * skipped one.
 *
 * Each wizard step is rendered and asked what it calls step one.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { JoinRegistration } from '../join-registration-shape';
import { ServerConnect } from '../ServerConnect';
import { SecuritySettings } from '../SecuritySettings';
import { Join } from '../Join';

/**
 * Join's hook opens websocket listeners; none of that decides what the stepper
 * says, so the hook is replaced with its resting state (the same double the
 * join-wizard dialog test uses, for the same reason).
 */
vi.mock('../useJoinRegistration', () => ({
  useJoinRegistration: (): JoinRegistration => ({
    formData: { fullName: '', username: '', password: '', confirmPassword: '' },
    isRegistering: false,
    showNotInitializedModal: false,
    showConnectModal: false,
    connectStatus: 'connecting',
    handleInputChange: vi.fn(),
    handleBlur: vi.fn(),
    fieldErrors: {},
    handleSubmit: vi.fn(),
    handleConnectModalComplete: vi.fn(),
    handleReturnToLogin: vi.fn(),
    recoveryCodes: [],
    awaitingSignIn: null,
    finishSignIn: vi.fn(),
  } as unknown as JoinRegistration),
}));

function renderStep(step: ReactElement): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <MemoryRouter>{step}</MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

function firstStepText(): string {
  const stepper: HTMLElement = screen.getByRole('list', { name: /^Step \d of 3$/ });
  const items: HTMLElement[] = within(stepper).getAllByRole('listitem');
  return items[0].textContent ?? '';
}

describe('the registration stepper', () => {
  it('calls step one Workspace while it is current', () => {
    renderStep(<ServerConnect onNext={vi.fn()} onCancel={vi.fn()} />);
    expect(firstStepText()).toMatch(/Current step:.*Workspace/);
  });

  it('still calls it Workspace once it is completed, on the security step', () => {
    renderStep(<SecuritySettings onNext={vi.fn()} onBack={vi.fn()} />);
    expect(firstStepText()).toMatch(/Completed:.*Workspace/);
    expect(firstStepText()).not.toMatch(/Server/);
  });

  it('still calls it Workspace once it is completed, on the profile step', () => {
    renderStep(
      <Join onNext={vi.fn()} onBack={vi.fn()} serverAddress="citadel.example.com:12400" serverPassword="" />,
    );
    expect(firstStepText()).toMatch(/Completed:.*Workspace/);
    expect(firstStepText()).not.toMatch(/Server/);
  });
});
