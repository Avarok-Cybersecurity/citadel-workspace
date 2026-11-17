/**
 * Every screen that tells a visitor to install the agent renders `AgentSetup`, not its own
 * instructions. The audit found two such screens; if a third appears, add it here, and
 * `agent-setup-has-one-home.test.ts` fails meanwhile if it writes the steps out itself.
 *
 * No mocks: the retry dialog is given its own `onRetry` (a promise that never settles), so
 * it neither touches the socket layer nor closes itself while the assertion runs.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ConnectionRetryModal } from '@/components/ConnectionRetryModal';
import { ClaimStep } from '@/components/create-workspace/ClaimStep';
import { AGENT_SETUP_COPY } from '@/lib/agent-setup-copy';

const never = (): Promise<void> => new Promise<void>(() => undefined);

describe('call sites', () => {
  it('the connection-failure dialog renders the shared setup, compact', async () => {
    render(<ConnectionRetryModal isOpen onClose={() => undefined} onRetry={never} />);
    const dialog: HTMLElement = await screen.findByTestId('connection-retry-modal');
    const setup: HTMLElement = within(dialog).getByTestId('agent-setup');
    expect(setup).toHaveAttribute('data-layout', 'compact');
    expect(within(setup).getByRole('button', { name: AGENT_SETUP_COPY.advanced.toggle })).toBeInTheDocument();
  });

  it('the create-workspace claim step renders the shared setup, full, under its own heading', () => {
    render(<ClaimStep workspaceHost="acme.example.com" claimCode={undefined} onOpenWorkspace={() => undefined} />);
    const next: HTMLElement = screen.getByTestId('claim-next');
    expect(within(next).getByRole('heading', { name: `1. ${AGENT_SETUP_COPY.downloadHeading}` })).toBeInTheDocument();
    expect(within(next).getByTestId('agent-setup')).toHaveAttribute('data-layout', 'full');
  });
});
