/**
 * One message, one Reply.
 *
 * Testers asked "why two Reply?" on a message in a thread. The action menu of each message kind
 * declared its own Reply (P2P text, P2P markdown, group), so nothing stated the count. A group
 * message is now the same bubble with its sender named, and is checked in that form. This pins
 * it: opening a message's menu shows exactly one control and exactly one visible word named
 * Reply, for every kind, on a message that is itself a reply and has replies of its own (the
 * state that surrounds the word with the most "reply" vocabulary).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextBubble } from '@/components/p2p/bubbles/TextBubble';
import { MarkdownBubble } from '@/components/p2p/bubbles/MarkdownBubble';
import type { P2PMessage } from '@/lib/p2p';
import type { QuotedMessage } from '../shared';

const QUOTED: QuotedMessage = { id: 'm0', authorName: 'Ada', excerpt: 'earlier' };

// Fixed shapes, not defaults: only the fields these components read are meaningful.
const p2p = (message_type: P2PMessage['message_type']): P2PMessage => ({
  id: 'm1', content: 'hello', senderCid: 2n, recipientCid: 1n, timestamp: 1, index: 0, status: 'delivered', message_type, replyTo: 'm0',
});
const noop = (): void => {};

const KINDS: ReadonlyArray<readonly [string, () => JSX.Element]> = [
  ['a P2P text message', (): JSX.Element => <TextBubble message={p2p('text')} isOwn={false} quoted={QUOTED} onReply={noop} />],
  ['a P2P markdown message', (): JSX.Element => <MarkdownBubble message={p2p('markdown')} isOwn={false} quoted={QUOTED} onReply={noop} />],
  ['a group message', (): JSX.Element => <TextBubble message={p2p('text')} isOwn={false} quoted={QUOTED} onReply={vi.fn()} showSenderName showSenderAvatar senderName="Ada" senderUsername="ada" />],
];

describe('the Reply on a message', () => {
  it.each(KINDS)('is offered once on %s', async (_name, element) => {
    render(element());
    await userEvent.click(screen.getByRole('button', { name: /message actions/i }));
    expect(screen.getAllByRole('menuitem', { name: /^reply$/i })).toHaveLength(1);
    expect(screen.getAllByText(/^reply$/i)).toHaveLength(1);
  });

  it('is offered by nothing when replying is not wired', async () => {
    // The control: the count above is not trivially one because the query matches nothing.
    render(<TextBubble message={p2p('text')} isOwn={true} quoted={QUOTED} onEdit={noop} />);
    await userEvent.click(screen.getByRole('button', { name: /message actions/i }));
    expect(screen.queryAllByText(/^reply$/i)).toHaveLength(0);
  });
});
