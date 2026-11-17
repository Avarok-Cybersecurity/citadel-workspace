/**
 * Every cross-tab forward paid the reliability price, including video frames.
 *
 * Forwarding to another tab retained the message: a `crypto.randomUUID()`, an
 * armed `setTimeout`, the payload held in a Map until the target acked, and a
 * BroadcastChannel round trip. Correct for a chat message, a file-transfer tick
 * or a peer notification — each is rare and each matters.
 *
 * A media frame is neither rare nor individually important. It arrives at frame
 * rate, per track, per participant, so this was a timer and a retained buffer
 * for every frame of every call. And the fallback is worse than the cost: when
 * no ack arrives in time the leader processes the message ITSELF, so one missed
 * ack decodes another tab's video on this one — in a call, continuously.
 *
 * A dropped frame is exactly a lost UDP packet, which the pipeline already
 * handles: `MediaGapNotification` reports the hole and the receiver asks for a
 * keyframe. Replaying a two-second-old frame is a worse artefact than the gap.
 */
import { describe, it, expect } from 'vitest';
import { UNRELIABLE_FORWARDS, CID_ROUTED_NOTIFICATIONS } from '../routing-rules';

describe('the unreliable-forward set', () => {
  it('holds the message type that arrives at frame rate', () => {
    expect(UNRELIABLE_FORWARDS.has('MediaFrameNotification')).toBe(true);
  });

  it('does NOT hold the gap report', () => {
    // MediaGapNotification is what TRIGGERS the recovery, and it is low-rate.
    // Losing it delays the keyframe that repairs the stream, so it keeps the
    // retention every other notification gets.
    expect(UNRELIABLE_FORWARDS.has('MediaGapNotification')).toBe(false);
  });

  it('does not quietly cover the notifications that must not be lost', () => {
    // The opposite failure: widening this set is how a chat message or a
    // file-transfer tick becomes fire-and-forget. Each of these is rare and
    // each one matters, which is the whole distinction the set encodes.
    for (const mustBeReliable of [
      'MessageNotification',
      'GroupMessageNotification',
      'PeerRegisterNotification',
      'PeerConnectNotification',
      'FileTransferRequestNotification',
      'FileTransferStatusNotification',
      'FileTransferTickNotification',
    ]) {
      expect(
        UNRELIABLE_FORWARDS.has(mustBeReliable),
        `${mustBeReliable} was made fire-and-forget; losing one is a message the user never sees`,
      ).toBe(false);
    }
  });

  it('only names types that are actually routed by CID', () => {
    // A type not in CID_ROUTED_NOTIFICATIONS never reaches the forwarding branch
    // this set governs, so an entry that is not there is inert — a rule that
    // reads as though it does something.
    for (const type of UNRELIABLE_FORWARDS) {
      expect(
        CID_ROUTED_NOTIFICATIONS.has(type as never),
        `${type} is marked unreliable but is not CID-routed, so the rule never fires`,
      ).toBe(true);
    }
  });
});
