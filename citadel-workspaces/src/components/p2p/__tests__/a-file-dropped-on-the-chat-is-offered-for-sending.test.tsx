/**
 * Dropping a file anywhere on the conversation offers it for sending.
 *
 * Live (testers, 2026-10-04): dragging a file onto the chat did nothing, because drag-and-drop
 * only existed inside the Send File dialog. The chat is now one drop target. It hands the file
 * to the SAME dialog the paperclip opens -- pre-filled -- so the size limit, the method choice
 * and the send itself are the dialog's, not a second copy.
 *
 * No mocks of the components. jsdom has no layout, so WHERE the overlay sits is measured in a
 * real browser by scripts/check-chat-polish-geometry.mjs; this pins what it does and says.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatDropTarget } from '../ChatDropTarget';
import { FileTransferModal } from '../FileTransferModal';

const FILE: File = new File(['hello'], 'plan.txt', { type: 'text/plain' });

/** What a browser puts on a drag that carries files, and on one that carries selected text. */
const filesDrag: { dataTransfer: { types: string[]; files: File[] } } = { dataTransfer: { types: ['Files'], files: [FILE] } };
const textDrag: { dataTransfer: { types: string[]; files: File[] } } = { dataTransfer: { types: ['text/plain'], files: [] } };

function target(onFile: (file: File) => void, unavailable: string | null = null): JSX.Element {
  return (
    <ChatDropTarget onFile={onFile} unavailable={unavailable} recipient="Ada" hint="Only the first file is sent." className="h-full" testId="chat">
      <p>conversation</p>
    </ChatDropTarget>
  );
}

describe('the chat as a drop target', () => {
  it('shows a drop overlay naming the peer while a file is dragged over it, and announces it', () => {
    render(target(vi.fn()));
    expect(screen.queryByTestId('chat-drop-overlay')).toBeNull();
    fireEvent.dragEnter(screen.getByTestId('chat'), filesDrag);
    expect(screen.getByTestId('chat-drop-overlay')).toHaveTextContent('Drop a file to send it to Ada');
    // The announcement is a region that exists before the drag, so it is read out when it fills.
    expect(screen.getByRole('status')).toHaveTextContent('Drop a file to send it to Ada');
  });

  it('hands the dropped file over and clears the overlay', () => {
    const onFile: (file: File) => void = vi.fn();
    render(target(onFile));
    fireEvent.dragEnter(screen.getByTestId('chat'), filesDrag);
    fireEvent.drop(screen.getByTestId('chat'), filesDrag);
    expect(onFile).toHaveBeenCalledExactlyOnceWith(FILE);
    expect(screen.queryByTestId('chat-drop-overlay')).toBeNull();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('survives the pointer crossing child elements (enter, enter, leave keeps it up)', () => {
    render(target(vi.fn()));
    const chat: HTMLElement = screen.getByTestId('chat');
    fireEvent.dragEnter(chat, filesDrag);
    fireEvent.dragEnter(screen.getByText('conversation'), filesDrag);
    fireEvent.dragLeave(chat, filesDrag);
    expect(screen.getByTestId('chat-drop-overlay')).toBeInTheDocument();
    fireEvent.dragLeave(screen.getByText('conversation'), filesDrag);
    expect(screen.queryByTestId('chat-drop-overlay')).toBeNull();
  });

  it('ignores a drag that carries text, not files', () => {
    const onFile: (file: File) => void = vi.fn();
    render(target(onFile));
    fireEvent.dragEnter(screen.getByTestId('chat'), textDrag);
    expect(screen.queryByTestId('chat-drop-overlay')).toBeNull();
    fireEvent.drop(screen.getByTestId('chat'), textDrag);
    expect(onFile).not.toHaveBeenCalled();
  });

  it('where it cannot take a file says why on the overlay, takes nothing, and still claims the drop', () => {
    const onFile: (file: File) => void = vi.fn();
    render(target(onFile, 'Drop files on the Messages tab to send them.'));
    const chat: HTMLElement = screen.getByTestId('chat');
    fireEvent.dragEnter(chat, filesDrag);
    expect(screen.getByTestId('chat-drop-overlay')).toHaveTextContent('Drop files on the Messages tab to send them.');
    expect(screen.getByRole('status')).toHaveTextContent('Messages tab');
    // fireEvent returns false when preventDefault was called, so the browser will not open the file.
    expect(fireEvent.drop(chat, filesDrag)).toBe(false);
    expect(onFile).not.toHaveBeenCalled();
    expect(screen.queryByTestId('chat-drop-overlay')).toBeNull();
  });
});

describe('the chat behind an open Send File dialog', () => {
  it('does not take a second copy of a file dropped inside the dialog', () => {
    // React delivers a portal's events to its React ancestors: without the DOM-containment guard
    // the dialog's drop would also reach the chat, which would reopen the dialog with the file.
    const onFile: (file: File) => void = vi.fn();
    render(
      <ChatDropTarget onFile={onFile} unavailable={null} recipient="Ada" hint="Only the first file is sent." className="h-full" testId="chat">
        <FileTransferModal isOpen onClose={vi.fn()} onSendFile={vi.fn()} peerCid="42" />
      </ChatDropTarget>,
    );
    fireEvent.drop(screen.getByRole('dialog'), filesDrag);
    expect(onFile).not.toHaveBeenCalled();
  });
});
