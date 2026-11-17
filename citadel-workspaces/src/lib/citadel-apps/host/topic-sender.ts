/**
 * The sender's side of an app topic's limits (the manifest's `limits.topics`), decided in the
 * worker as the app publishes, so a refusal is the publish call's own answer (`Err` in the SDK)
 * rather than a reply the app never reads. Pure.
 */
import { LIMIT_TOPIC_BYTES, LIMIT_TOPIC_RATE } from '../sdk/generated/AbiConstants';
import type { Refused } from './ports';

/** `limits.topics` of the manifest. */
export interface TopicRates {
  readonly max_msg_bytes: number;
  readonly max_msgs_per_s: number;
}

/** How long a sender's rate window stays open after the message that opened it. */
const RATE_WINDOW_MS: number = 1000;

/**
 * One topic's sender, by the server's own rule (citadel_proto `peer/group_limits.rs`): a window
 * opens with the first message and lasts one second, at most `max_msgs_per_s` are sent in it,
 * and a refused message does not count. A looser rule here (a token bucket admits a third
 * message 600 ms in) is a message the page sends and the server refuses.
 */
export class TopicSender {
  private opened: number | null = null;
  private sent: number = 0;

  constructor(private readonly limits: TopicRates) {}

  /** Null: send it. Otherwise the refusal the app reads, at once. */
  admit(body: Uint8Array, now: number): Refused | null {
    if (body.byteLength > this.limits.max_msg_bytes) return { limit: LIMIT_TOPIC_BYTES };
    if (this.opened === null || now - this.opened >= RATE_WINDOW_MS) {
      this.opened = now;
      this.sent = 0;
    }
    if (this.sent >= this.limits.max_msgs_per_s) return { limit: LIMIT_TOPIC_RATE };
    this.sent += 1;
    return null;
  }
}

/** Every topic of one instance: a sender per name, made at its first publish. */
export class TopicGate {
  private readonly senders: Map<string, TopicSender> = new Map<string, TopicSender>();

  constructor(private readonly limits: TopicRates) {}

  admit(name: string, body: Uint8Array, now: number): Refused | null {
    let s: TopicSender | undefined = this.senders.get(name);
    if (s === undefined) {
      s = new TopicSender(this.limits);
      this.senders.set(name, s);
    }
    return s.admit(body, now);
  }
}
