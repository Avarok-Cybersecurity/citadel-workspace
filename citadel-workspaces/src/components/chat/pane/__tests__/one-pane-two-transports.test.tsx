/**
 * One chat pane, whatever carries the conversation.
 *
 * The node chat was a second component that lacked live documents, markdown, files, reactions,
 * ticks, retry and drafts, because each feature had been written once into the direct chat and
 * never into it. Now both render this pane, and what it offers is what the transport's ports
 * can do. These tests render the real pane over a recording transport (the port boundary; the
 * pane, its hooks and every control are production code) and look for each control a person
 * would use, then take a port away and watch its control go.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { clearAllDraftsForTests } from '@/lib/chat/draft-store';
import { ChatPane, type ChatPaneStatus } from '../ChatPane';
import { fakeTransport, fakeMessage, type FakeOptions, type Recorded } from '@/lib/chat/transport/__tests__/doubles/fake-transport';
import type { ChatTransport } from '@/lib/chat/transport/chat-transport';

afterEach((): void => { cleanup(); clearAllDraftsForTests(); });

const PEER: FakeOptions = {
  kind: 'peer', self: { cid: 1n, username: 'me', displayName: 'You' }, counterpart: 'Bob',
  latest: { messages: [fakeMessage('m1', 'hello there', 1_700_000_000_000, false)], older: null },
  stated: { markdown: true, readReceipts: true, securityLevel: true, retention: true, optimistic: true, namesSenders: false },
  ports: { status: true, files: true, documents: true, settings: true, revise: true, reactions: true }, sendGate: 'allowed', recordsOnSend: true,
};

function Header({ status }: { status: ChatPaneStatus }): JSX.Element {
  return status.openSettings === null ? <div /> : <button type="button" onClick={status.openSettings}>Chat settings</button>;
}

async function renderPane(options: FakeOptions): Promise<{ transport: ChatTransport; recorded: Recorded }> {
  const made: { transport: ChatTransport; recorded: Recorded } = fakeTransport(options);
  render(
    <ConfirmDialogProvider>
      <ChatPane transport={made.transport} pause={null} header={(status: ChatPaneStatus) => <Header status={status} />} />
    </ConfirmDialogProvider>,
  );
  await screen.findByText('hello there');
  return made;
}

describe('the chat pane over a direct-chat transport', () => {
  it('offers every way of writing, attaching and opening a document', async () => {
    await renderPane(PEER);
    expect(screen.getByTestId('message-type-text')).toBeInTheDocument();
    expect(screen.getByTestId('message-type-markdown')).toBeInTheDocument();
    expect(screen.getByTestId('message-type-live-doc')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send file' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chat settings' })).toBeInTheDocument();
    expect(screen.getByRole('log', { name: 'Conversation' })).toBeInTheDocument();
  });

  it('sends what was typed, as markdown, through the transport', async () => {
    const { recorded } = await renderPane(PEER);
    fireEvent.click(screen.getByTestId('message-type-markdown'));
    fireEvent.change(screen.getByTestId('p2p-message-input'), { target: { value: '**bold**' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send message' })); });
    await waitFor(() => expect(recorded.texts.map((t) => [t.content, t.messageType])).toEqual([['**bold**', 'markdown']]));
  });
});

describe('a port the transport does not have', () => {
  it('takes the Live Doc type with it', async () => {
    await renderPane({ ...PEER, ports: { ...PEER.ports, documents: false } });
    expect(screen.queryByTestId('message-type-live-doc')).toBeNull();
    expect(screen.getByTestId('message-type-markdown')).toBeInTheDocument();
  });

  it('takes the attach button with it', async () => {
    await renderPane({ ...PEER, ports: { ...PEER.ports, files: false } });
    expect(screen.queryByRole('button', { name: 'Send file' })).toBeNull();
  });

  it('takes the settings opener with it', async () => {
    await renderPane({ ...PEER, ports: { ...PEER.ports, settings: false } });
    expect(screen.queryByRole('button', { name: 'Chat settings' })).toBeNull();
  });

  it('leaves no selector at all when only text is left', async () => {
    await renderPane({ ...PEER, stated: { ...PEER.stated, markdown: false }, ports: { ...PEER.ports, documents: false } });
    expect(screen.queryByTestId('message-type-text')).toBeNull();
  });
});
