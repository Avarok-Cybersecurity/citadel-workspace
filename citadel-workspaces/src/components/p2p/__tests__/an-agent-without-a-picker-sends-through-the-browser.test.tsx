/**
 * An agent whose greeting says `native_picker: false` cannot open a file dialog, so the
 * Send dialog does not offer one and the file goes by the browser's own chooser and the
 * chunked upload. One whose greeting says nothing (an older agent) is offered it as today.
 * Nothing is mocked: the agent is its greeting, read by the production code.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FileTransferModal } from '../FileTransferModal';
import { forgetCapabilities } from '@/lib/agent-conversations/capabilities';
import { greetAs } from '@/lib/agent-conversations/__tests__/agent-greeting';

afterEach(() => { forgetCapabilities(); });

function open(): void {
  render(<FileTransferModal isOpen onClose={vi.fn()} onSendFile={vi.fn()} peerCid="42" />);
}

describe('the Send dialog and the agent\'s native picker', () => {
  it('offers no native picker to an agent that says it has none, and keeps the browser chooser', async () => {
    await greetAs(true, { native_picker: false });
    open();
    expect(await screen.findByText(/Maximum size/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Browse Files')).toBeNull());
    expect(screen.getByText(/drop file here or/i)).toBeInTheDocument();
  });

  it('NEGATIVE CONTROL: an agent that says nothing is still offered it', async () => {
    await greetAs('older');
    open();
    expect(await screen.findByText(/Maximum size/)).toBeInTheDocument();
    expect(screen.getByText('Browse Files')).toBeInTheDocument();
  });

  it('NEGATIVE CONTROL: an agent that says it has one is offered it', async () => {
    await greetAs(true, { native_picker: true });
    open();
    expect(await screen.findByText(/Maximum size/)).toBeInTheDocument();
    expect(screen.getByText('Browse Files')).toBeInTheDocument();
  });
});
