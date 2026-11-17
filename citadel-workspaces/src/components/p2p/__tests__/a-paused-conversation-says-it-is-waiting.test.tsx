/**
 * A paused conversation says it is paused, and what that means for each action.
 *
 * Pausing keeps the contact and queues messages, so the composer must stay
 * usable and say the message will wait -- disabling it would read as "you
 * cannot talk to this person", which is the block the owner ruled out. Calls
 * and file sends need the live link, so those say why they are unavailable.
 *
 * Nothing stood in: these are the presentational pieces, rendered as they are.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { PausedBanner } from '../PausedBanner';
import { PauseConnectionCard } from '../PauseConnectionCard';
import { MessageInput } from '@/components/chat/pane/MessageInput';
import { paneTestIds } from '@/components/chat/pane/pane-test-ids';
import { P2PChatHeader } from '../P2PChatHeader';
import { MessagingLayerType } from '@/types/messaging-layer';
import { callCapabilityWhile, PAUSE_COPY } from '@/lib/p2p-pause/pause-copy';

function composer(paused: boolean, text: string): void {
  render(
    <MessageInput
        features={{ markdown: true, documents: true, files: true }}
        testId={paneTestIds('peer').input['data-testid']}
      ref={createRef<HTMLTextAreaElement>()}
      inputMessage={text} messageType="text" showMarkdownPreview={false}
      isSending={false} paused={paused} awaitingAcceptFrom={null}
      onInputChange={vi.fn()} onInputFocus={vi.fn()} onInputBlur={vi.fn()}
      onSubmit={vi.fn()} onFileClick={vi.fn()} fileDestination={null} onFormat={vi.fn()}
      onTogglePreview={vi.fn()} onMessageTypeChange={vi.fn()}
    />,
  );
}

describe('the paused banner', () => {
  it('says messages wait, and offers Resume', async (): Promise<void> => {
    const onResume: () => void = vi.fn();
    render(<PausedBanner busy={false} onResume={onResume} />);
    expect(screen.getByRole('status').textContent).toContain('Paused — messages will be delivered when you resume');
    await userEvent.click(screen.getByRole('button', { name: 'Resume connection' }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});

describe('the composer while paused', () => {
  it('still sends, and says the message will wait', () => {
    composer(true, 'hello');
    const input: HTMLTextAreaElement = screen.getByTestId('p2p-message-input') as HTMLTextAreaElement;
    expect(input.disabled).toBe(false);
    expect(input.placeholder).toMatch(/wait until you resume/i);
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not offer a file send, and says why', () => {
    composer(true, '');
    const file: HTMLButtonElement = screen.getByRole('button', { name: /send file/i }) as HTMLButtonElement;
    expect(file.disabled).toBe(true);
    expect(file.getAttribute('title')).toBe(PAUSE_COPY.fileReason);
  });

  it('offers a file send when not paused', () => {
    // The discrimination for the case above.
    composer(false, '');
    const file: HTMLButtonElement = screen.getByRole('button', { name: /send file/i }) as HTMLButtonElement;
    expect(file.disabled).toBe(false);
    expect((screen.getByTestId('p2p-message-input') as HTMLTextAreaElement).placeholder).toBe('Type a message...');
  });
});

describe('calling a paused contact', () => {
  it('is unavailable with the pause as the reason', () => {
    expect(callCapabilityWhile('paused', { supported: true })).toEqual({ supported: false, reason: PAUSE_COPY.callReason });
  });

  it('keeps the browser reason when not paused', () => {
    const own: { supported: boolean; reason?: string } = { supported: false, reason: 'No microphone' };
    expect(callCapabilityWhile('active', own)).toBe(own);
    expect(callCapabilityWhile('unknown', own)).toBe(own);
  });
});

describe('the chat header while paused', () => {
  it('says Paused instead of a presence it is not listening for', () => {
    render(
      <P2PChatHeader
        peerName="bob" peerUsername="bob" peerPresence={{ status: MessagingLayerType.Online, lastUpdate: 0 }} peerTyping={false}
        isConnected={false} isRegistered={true} paused={true} connectionRoute={null} supervisor={null} onSettingsClick={vi.fn()} onOpenFiles={null}
      />,
    );
    expect(screen.getByText('Paused')).toBeTruthy();
    expect(screen.queryByText('Online')).toBeNull();
  });
});

describe('the pause control in chat settings', () => {
  it('explains that the contact is kept, and pauses', async (): Promise<void> => {
    const onPause: () => void = vi.fn();
    render(<PauseConnectionCard status="active" peerName="bob" busy={false} onPause={onPause} onResume={vi.fn()} />);
    expect(screen.getByText(/bob stays a contact/i)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Pause connection' }));
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('offers Resume when paused', async (): Promise<void> => {
    const onResume: () => void = vi.fn();
    render(<PauseConnectionCard status="paused" peerName="bob" busy={false} onPause={vi.fn()} onResume={onResume} />);
    await userEvent.click(screen.getByRole('button', { name: 'Resume connection' }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('offers neither when the pause state could not be read', () => {
    render(<PauseConnectionCard status="unknown" peerName="bob" busy={false} onPause={vi.fn()} onResume={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /(pause|resume) connection/i })).toBeNull();
    expect(screen.getByText(PAUSE_COPY.unreadable)).toBeTruthy();
  });
});
