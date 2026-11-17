/**
 * Topic size parity (S13): `max_msg_bytes` counts the app's body. The worker admits a body of
 * exactly that size, the page's envelope for it fits what the agent caps the group at (the body
 * plus TOPIC_ENVELOPE_OVERHEAD, plus the ciphertext's own, which the agent's test measures), and
 * a receiver reads it back; one byte more is refused before anything is sent. The envelope's
 * length here is the figure the SDK types' test measures in Rust, so the two sides agree on it.
 */
import { describe, expect, it } from 'vitest';
import { TopicSender } from '../../host/topic-sender';
import { MAX_TOPIC_NAME_LEN, TOPIC_ENVELOPE_OVERHEAD, TOPIC_MAX_MSG_BYTES_CEILING } from '../../sdk/generated/AbiConstants';
import { readTopicMessage, topicEnvelope, type TopicLimits } from '../topic-model';

const NAME: string = 'n'.repeat(MAX_TOPIC_NAME_LEN);
/** 4096 is the Compute Pool's `limits.topics.max_msg_bytes`. */
const SIZES: readonly number[] = [1, 256, 4096, TOPIC_MAX_MSG_BYTES_CEILING];

describe('a body of exactly max_msg_bytes', () => {
  it.each(SIZES)('at %i is admitted, fits the group, and is read back', (max: number) => {
    const limits: TopicLimits = { max_msg_bytes: max, max_msgs_per_s: 1 };
    const body: Uint8Array = new Uint8Array(max).fill(9);
    expect(new TopicSender(limits).admit(body, 0)).toBeNull();
    const envelope: Uint8Array | null = topicEnvelope(NAME, body, limits);
    // The body's byte-string head is 3 bytes from 256 up, which the overhead counts; 2 or 1 below.
    const head: number = max < 24 ? 1 : max < 256 ? 2 : 3;
    expect(envelope?.byteLength).toBe(max + TOPIC_ENVELOPE_OVERHEAD - (3 - head));
    expect(readTopicMessage(envelope as Uint8Array, new Set([NAME]), limits)?.body).toEqual(body);
  });

  it.each(SIZES)('at %i, one byte more is refused by the worker and never enveloped', (max: number) => {
    const limits: TopicLimits = { max_msg_bytes: max, max_msgs_per_s: 1 };
    const body: Uint8Array = new Uint8Array(max + 1);
    expect(new TopicSender(limits).admit(body, 0)).toEqual({ limit: 'topic_bytes' });
    expect(topicEnvelope(NAME, body, limits)).toBeNull();
  });
});
