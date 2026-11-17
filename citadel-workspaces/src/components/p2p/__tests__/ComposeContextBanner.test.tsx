import { describe, it, expect, vi  } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComposeContextBanner } from '../ComposeContextBanner';
import type { P2PMessage } from '@/lib/p2p/p2p-types';

const message = (content: string): P2PMessage =>
  ({ id: 'm1', content, senderCid: 1n, recipientCid: 2n, timestamp: 1, index: 0,
     status: 'delivered', message_type: 'text' }) as P2PMessage;

describe('ComposeContextBanner', () => {
  it('renders nothing when the composer is just sending a new message', () => {
    const { container } = render(
      <ComposeContextBanner replyingTo={null} editingMessage={null} onCancel={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('says it is replying, and shows what to', () => {
    render(<ComposeContextBanner replyingTo={message('original text')} editingMessage={null} onCancel={vi.fn()} />);

    expect(screen.getByTestId('compose-replying-banner')).toBeInTheDocument();
    expect(screen.getByText('Replying to message')).toBeInTheDocument();
    expect(screen.getByText('original text')).toBeInTheDocument();
  });

  it('says it is editing, which is the state that overwrites rather than sends', () => {
    render(<ComposeContextBanner replyingTo={null} editingMessage={message('to change')} onCancel={vi.fn()} />);

    expect(screen.getByTestId('compose-editing-banner')).toBeInTheDocument();
    expect(screen.getByText('Editing message')).toBeInTheDocument();
  });

  it('prefers editing when both are somehow set, since it is the destructive one', () => {
    render(<ComposeContextBanner replyingTo={message('reply target')} editingMessage={message('edit target')} onCancel={vi.fn()} />);

    expect(screen.getByTestId('compose-editing-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('compose-replying-banner')).not.toBeInTheDocument();
  });

  it('can be cancelled, and labels the control for screen readers', async () => {
    const onCancel: ReturnType<typeof vi.fn> = vi.fn();
    render(<ComposeContextBanner replyingTo={message('x')} editingMessage={null} onCancel={onCancel} />);

    const cancel: HTMLElement = screen.getByRole('button', { name: 'Cancel reply' });
    await userEvent.click(cancel);

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('labels the cancel control differently while editing', () => {
    render(<ComposeContextBanner replyingTo={null} editingMessage={message('x')} onCancel={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Cancel editing' })).toBeInTheDocument();
  });
});
