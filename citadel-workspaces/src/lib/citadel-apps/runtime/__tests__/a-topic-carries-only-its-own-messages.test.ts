/**
 * The rules of an app topic: only granted, well-formed names open; the sender is held to the
 * manifest's size and rate (refused at once, as `topic_bytes` / `topic_rate`); and only a topic
 * envelope for an open topic reaches the app, so a chat message in the same group never does.
 */
import { describe, expect, it } from 'vitest';
import { encodeCbor } from '../../host/cbor';
import { encodeTopicMessage, mayOpen, readTopicMessage, topicLimitsProblem, type TopicLimits } from '../topic-model';
import { TopicSender } from '../../host/topic-sender';

const LIMITS: TopicLimits = { max_msg_bytes: 8, max_msgs_per_s: 2 };

describe('a topic carries only its own messages', () => {
  it('opens only a granted, well-formed name', () => {
    expect(mayOpen('pool', ['pool'])).toBe(true);
    expect(mayOpen('chat', ['pool'])).toBe(false);
    expect(mayOpen('Pool', ['Pool'])).toBe(false);
    expect(mayOpen('a'.repeat(33), ['a'.repeat(33)])).toBe(false);
    expect(mayOpen('a', ['a', 'b', 'c', 'd', 'e'])).toBe(false);
  });

  it('holds the sender to the size, then the rate (control: under both it sends)', () => {
    const s: TopicSender = new TopicSender(LIMITS);
    expect(s.admit(new Uint8Array(9), 0)).toEqual({ limit: 'topic_bytes' });
    expect(s.admit(new Uint8Array(8), 0)).toBeNull();
    expect(s.admit(new Uint8Array(1), 0)).toBeNull();
    expect(s.admit(new Uint8Array(1), 0)).toEqual({ limit: 'topic_rate' });
    expect(s.admit(new Uint8Array(1), 1000)).toBeNull();
  });

  it('admits only what the server would: n in a window that opens with the first message and lasts a second', () => {
    // The server's rule (citadel_proto peer/group_limits.rs). A token bucket refilled at the same
    // rate admits a third message at 600 ms, which the server refuses as `topic_rate`.
    const s: TopicSender = new TopicSender(LIMITS);
    const at = (ms: number): string => (s.admit(new Uint8Array(1), ms) === null ? 'sent' : 'refused');
    expect([at(0), at(400), at(600), at(999)]).toEqual(['sent', 'sent', 'refused', 'refused']);
    // A new window opens at the first message after the last one closed; a refusal does not count.
    expect([at(1000), at(1999), at(1999), at(2000)]).toEqual(['sent', 'sent', 'refused', 'sent']);
  });

  it('reads back its own envelope for an open topic, and nothing else', () => {
    const open: ReadonlySet<string> = new Set(['pool']);
    expect(readTopicMessage(encodeTopicMessage('pool', new Uint8Array([1, 2])), open, LIMITS)).toEqual({ name: 'pool', body: new Uint8Array([1, 2]) });
    expect(readTopicMessage(encodeTopicMessage('other', new Uint8Array([1])), open, LIMITS)).toBeNull();
    expect(readTopicMessage(encodeCbor({ group_id: '7:42', content: 'hello' }), open, LIMITS)).toBeNull();
    expect(readTopicMessage(encodeTopicMessage('pool', new Uint8Array(9)), open, LIMITS)).toBeNull();
  });

  it('refuses limits past the SDK ceilings', () => {
    expect(topicLimitsProblem(LIMITS)).toBeNull();
    expect(topicLimitsProblem({ max_msg_bytes: 16385, max_msgs_per_s: 1 })).toBe('max_msg_bytes');
    expect(topicLimitsProblem({ max_msg_bytes: 1, max_msgs_per_s: 5 })).toBe('max_msgs_per_s');
  });
});
