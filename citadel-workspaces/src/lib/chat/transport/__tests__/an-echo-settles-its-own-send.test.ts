/**
 * The reader's unconfirmed channel messages, and which one the server's copy replaces.
 *
 * The server mints a channel message's id, so its copy is matched to the local one by what was
 * sent. Getting that wrong shows a message twice or leaves one spinning for ever.
 */
import { describe, it, expect } from 'vitest';
import { pendingGroupSends, type PendingSends } from '../pending-group-sends';
import type { ChatMessage } from '../chat-transport';

const local = (id: string, content: string): ChatMessage => ({
  id, content, timestamp: 1, index: 0, status: 'pending', message_type: 'text',
  author: { own: true, name: 'Ada', username: null }, share: null,
});
const echo = (content: string, replyTo: string | null): { content: string; reply_to: string | null; message_type: 'Text' } =>
  ({ content, reply_to: replyTo, message_type: 'Text' });

function held(...entries: Array<[string, string, string | null]>): PendingSends {
  const pending: PendingSends = pendingGroupSends();
  for (const [id, content, replyTo] of entries) pending.add(local(id, content), echo(content, replyTo));
  return pending;
}

describe('a server copy of the reader\'s own message', () => {
  it('settles the oldest identical send, once', () => {
    const pending: PendingSends = held(['a', 'hi', null], ['b', 'hi', null]);
    expect(pending.settle(echo('hi', null))).toBe('a');
    expect(pending.settle(echo('hi', null))).toBe('b');
    expect(pending.settle(echo('hi', null))).toBeNull();
  });

  it('does not settle a send of the same words in reply to something else', () => {
    expect(held(['a', 'yes', 'm1']).settle(echo('yes', 'm2'))).toBeNull();
  });

  it('never settles a refused send, whose copy is not coming', () => {
    const pending: PendingSends = held(['a', 'hi', null], ['b', 'hi', null]);
    pending.update('a', { status: 'failed', error: 'Please slow down' });
    expect(pending.settle(echo('hi', null))).toBe('b');
    expect(pending.get('a')?.status).toBe('failed');
  });
});
