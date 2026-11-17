/**
 * A P2P reply showed nothing of the message it answered.
 *
 * The composer sent `replyTo`, the inbound path kept it, and no bubble read it:
 * a reply looked exactly like any other message, so "yes" under two questions
 * answered neither. The quote is found among the loaded messages; when the
 * original is not loaded the reply says so rather than pretending it is not a
 * reply.
 *
 * The list and bubbles render for real, with no doubles. jsdom has no layout,
 * so `scrollIntoView` is recorded rather than performed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MessageList } from '@/components/chat/pane/MessageList';
import { listProps, between, type ListProps } from '@/components/chat/pane/__tests__/doubles/list-props';
import type { ChatMessage } from '@/lib/chat/transport/chat-transport';

const scrolled: string[] = [];

beforeEach((): void => {
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element): void {
    scrolled.push(this.getAttribute('data-message-id') ?? '(no id)');
  };
});

function message(id: string, senderCid: bigint, content: string, replyTo?: string): ChatMessage {
  return between({
    id, content, senderCid, recipientCid: senderCid === 1n ? 2n : 1n,
    timestamp: 1_700_000_000_000, index: 0, status: 'sent', message_type: 'text', replyTo,
  });
}


const base: ListProps = listProps([]);

describe('a P2P reply', () => {
  it("quotes the original's author and first line", () => {
    render(
      <MessageList
        {...base}
        messages={[
          message('q1', 2n, 'Are we shipping Friday?\nOr Monday?'),
          message('r1', 1n, 'Friday', 'q1'),
        ]}
      />,
    );
    const quote: HTMLElement = screen.getByTestId('reply-quote');
    expect(quote.tagName).toBe('BUTTON');
    expect(within(quote).getByText('alice')).toBeInTheDocument();
    expect(within(quote).getByText('Are we shipping Friday? Or Monday?')).toBeInTheDocument();
    // Above the reply's own text, inside the same bubble.
    const reply: HTMLElement = screen.getByText('Friday');
    expect(quote.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('jumps to and highlights the original when the quote is activated', () => {
    render(
      <MessageList
        {...base}
        messages={[message('q1', 2n, 'Question'), message('r1', 1n, 'Answer', 'q1')]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Replying to alice/ }));
    expect(scrolled).toEqual(['q1']);
    const original: Element | null = document.querySelector('[data-message-id="q1"]');
    expect(original?.getAttribute('data-reply-highlight')).toBe('true');
    expect(document.activeElement).toBe(original);
  });

  it('says the original is not loaded when it is not', () => {
    render(<MessageList {...base} messages={[message('r2', 2n, 'Agreed', 'gone')]} />);
    expect(screen.getByText('Original message not loaded')).toBeInTheDocument();
    expect(screen.queryByTestId('reply-quote')).toBeNull();
  });

  it('shows no quote on a message that is not a reply', () => {
    // The control: a quote on every bubble would satisfy the tests above.
    render(<MessageList {...base} messages={[message('m1', 2n, 'Hello')]} />);
    expect(screen.queryByTestId('reply-quote')).toBeNull();
    expect(screen.queryByTestId('reply-quote-missing')).toBeNull();
  });
});
