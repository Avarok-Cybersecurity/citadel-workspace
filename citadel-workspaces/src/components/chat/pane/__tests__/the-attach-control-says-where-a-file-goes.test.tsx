/**
 * The attach control says, beside itself, where a file goes and who can read it: in a node
 * channel, the workspace server and the channel's members, since its files are encrypted to the
 * server rather than end to end. The line is the button's description, so a screen reader hears
 * it with the button. A conversation without files has neither.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageInput } from '../MessageInput';
import { NODE_FILES_DESTINATION } from '@/lib/chat/transport/node-files';

function composer(files: boolean): void {
  render(
    <MessageInput
      features={{ markdown: true, documents: true, files }} testId="composer" inputMessage="" messageType="text"
      showMarkdownPreview={false} paused={false} isSending={false} awaitingAcceptFrom={null}
      onInputChange={vi.fn()} onInputFocus={vi.fn()} onInputBlur={vi.fn()} onSubmit={vi.fn()} onFileClick={vi.fn()}
      fileDestination={NODE_FILES_DESTINATION} onFormat={vi.fn()} onTogglePreview={vi.fn()} onMessageTypeChange={vi.fn()}
    />,
  );
}

describe('the attach control in a node channel', () => {
  it('says the file is kept on the workspace server for the channel', () => {
    composer(true);
    const line: HTMLElement = screen.getByTestId('attach-destination');
    expect(line).toHaveTextContent("Stored on the workspace server, readable by this channel's members");
    expect(screen.getByRole('button', { name: 'Send file' })).toHaveAttribute('aria-describedby', line.id);
  });

  it('is absent with the attach control where the conversation has no files', () => {
    composer(false);
    expect(screen.queryByTestId('attach-destination')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send file' })).toBeNull();
  });
});
