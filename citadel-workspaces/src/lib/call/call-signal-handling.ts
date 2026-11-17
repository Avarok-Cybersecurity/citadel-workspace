/**
 * Inbound call-control signals: invite, accept, decline, end, media state,
 * keyframe requests.
 *
 * Extracted from CallManager verbatim. The guards at the top of each function
 * are the load-bearing part — they are what keep retransmitted and stale
 * signals from poisoning a live call.
 */

import { stillInCall } from './participant-presence';
import type { CallSignalPayload } from '@/types/p2p-commands';
import type { CallMediaKinds } from '@/types/call-signals';
import { eventEmitter } from '@/lib/event-emitter';
import { glareWinner } from './call-state';
import { callHomeFor } from './room-names';
import { MEDIA_WIRE_VERSION } from './call-constants';
import type { CallManagerInternals } from './call-manager-internals';
import { closeIfFinished, closeSessionFor, openSessionFor } from './media-session-lifecycle';
import type { CallState } from '@/lib/call/call-state';

export async function handleInboundSignal(
  m: CallManagerInternals,
  from: bigint,
  username: string,
  signal: CallSignalPayload,
): Promise<void> {
  if (signal.kind === 'CallInvite') {
    return handleInvite(m, from, username, signal);
  }

  // Every other signal must belong to the call we are in. This is not
  // defensive paranoia: after glare, the loser's `busy` decline of the
  // ABANDONED call otherwise lands on the surviving call and ends it — and
  // the reliable messaging layer can deliver a signal twice, so a stale
  // call_id is an ordinary event, not a corrupt peer.
  const state: CallState | null = m.getState();
  if (!state || signal.call_id !== state.callId) return;

  // Presence is recorded before the per-kind handling because ANY signal for
  // the live call proves the sender is there — a peer toggling its camera is
  // plainly alive, and requiring a heartbeat specifically would evict someone
  // who is demonstrably participating.
  m.peerSeen(from);

  switch (signal.kind) {
    case 'CallAccept': {
      m.codecs.recordCaps(from, signal.codecs);
      m.codecs.recordSendCodec(from, signal.video_send_codec);
      m.apply({ type: 'peer-accepted', cid: from, media: signal.media });
      // Opened on accept, not on invite: a session opened when we dialled
      // would hold a UDP channel for a call that may never be answered. And
      // only once WE have answered too — in a group call a co-invitee's accept
      // can land while we are still ringing, when we have no media to offer;
      // accept() opens the session for every already-accepted peer instead.
      const after: CallState | null = m.getState();
      if (after && (after.status === 'connecting' || after.status === 'active')) {
        await openSessionFor(m, from, null);
      }
      return;
    }

    case 'CallDecline':
      m.apply({ type: 'peer-declined', cid: from, reason: signal.reason });
      await closeIfFinished(m);
      return;

    case 'CallEnd':
      m.apply({ type: 'peer-left', cid: from });
      await closeSessionFor(m, from);
      await closeIfFinished(m);
      return;

    case 'CallMediaState':
      m.codecs.recordSendCodec(from, signal.video_send_codec);
      m.apply({ type: 'peer-media-changed', cid: from, media: signal.media });
      return;

    case 'CallAnnotate':
      // Straight out as an event: strokes are UI state with a five-second life,
      // and nothing in the call machinery needs to know about them. Routing
      // them through the reducer would put a 60 Hz stream of points through
      // every call subscriber for the sake of a canvas.
      eventEmitter.emit('call:annotate', {
        callId: signal.call_id,
        strokeId: signal.stroke_id,
        author: signal.author,
        point: { x: signal.x, y: signal.y },
        at: Date.now(),
      });
      return;

    case 'CallHeartbeat':
      // "Still here" was consumed by peerSeen above. It may also carry how our
      // stream is arriving for them, which is the only feedback the sender-side
      // quality ladder ever gets — the transport reports neither loss nor
      // playout delay, so without this the encoder never leaves its top rung.
      if (signal.link) m.linkReported(signal.link);
      return;

    case 'CallKeyframeRequest':
      // Straight through to the encoder owner. Buffering these was both a
      // dead end (nothing drained the buffer) and unbounded growth at the
      // far side's request rate.
      m.keyframeRequested(signal.track);
      return;

    default:
      return;
  }
}

/**
 * Tell peers our send codec changed after renegotiation.
 *
 * The caller only learns the callee's decode list from the accept, so the
 * codec announced in the invite can turn out to be undecodable there; the
 * peers' decoders are configured from these announcements, so a silent
 * switch would be a permanently black tile on their side.
 */
export async function announceSendCodec(
  m: CallManagerInternals,
  codec: string | null,
): Promise<void> {
  const state: CallState | null = m.getState();
  if (!state || state.status === 'ended' || state.status === 'failed') return;

  await Promise.all(
    [...state.participants.values()]
      .filter(stillInCall)
      .map((p) =>
        m.transport
          .sendSignal(p.cid, {
            kind: 'CallMediaState',
            call_id: state.callId,
            media: state.selfMedia,
            video_send_codec: codec,
          })
          .catch(() => undefined),
      ),
  );
}

async function handleInvite(
  m: CallManagerInternals,
  from: bigint,
  username: string,
  signal: Extract<CallSignalPayload, { kind: 'CallInvite' }>,
): Promise<void> {
  // A second copy of the invite for the call we already have is a retransmit
  // — the reliable layer delivers duplicates. Falling through would hit the
  // busy branch below and decline OUR OWN call, killing it on both sides.
  const current: CallState | null = m.getState();
  if (current && current.callId === signal.call_id) return;

  if (signal.media_wire_version !== MEDIA_WIRE_VERSION) {
    // Declining is the honest answer. Accepting would mean decoding a frame
    // format we do not know, which looks like a broken camera to both sides.
    await m.transport.sendSignal(from, {
      kind: 'CallDecline',
      call_id: signal.call_id,
      reason: 'unsupported',
    });
    return;
  }

  // Glare: both sides dialled at once. Both compute the same winner locally,
  // so exactly one call survives without another round trip.
  if (current && current.status === 'ringing-out') {
    if (glareWinner(current.callId, signal.call_id) === 'ours') {
      await m.transport.sendSignal(from, {
        kind: 'CallDecline',
        call_id: signal.call_id,
        reason: 'busy',
      });
      return;
    }
    // They win: abandon ours and take theirs.
    m.apply({ type: 'ended', reason: 'hangup' });
  } else if (current && current.status !== 'ended' && current.status !== 'failed') {
    await m.transport.sendSignal(from, {
      kind: 'CallDecline',
      call_id: signal.call_id,
      reason: 'busy',
    });
    return;
  }

  // Adopting the call: remember what the caller can decode and what they
  // said they will send, so both directions of video can be negotiated.
  m.codecs.clear();
  m.codecs.recordCaps(from, signal.codecs);
  m.codecs.recordSendCodec(from, signal.video_send_codec);

  // The roster the caller sent so every invitee builds the same mesh. It was
  // carried from day one and consumed by nobody: each invitee knew only the
  // caller, accepted only to the caller, and two invitees in the same group
  // call never exchanged a signal, a session or a frame with each other.
  // Usernames are not on the wire, so each co-invitee is named from the local
  // registration roster. A peer we have never registered with resolves to a
  // short handle rather than a twenty-digit CID.
  const others: Array<{ cid: bigint; username: string }> = [];
  for (const raw of signal.group?.members ?? []) {
    try {
      const cid: bigint = BigInt(raw);
      if (cid !== m.selfCid && cid !== from) others.push({ cid, username: m.resolvePeerName(cid) });
    } catch {
      // An unparseable cid names nobody we could signal; skip it rather than
      // poison the whole invite.
    }
  }

  m.apply({
    type: 'invite-received',
    callId: signal.call_id,
    home: callHomeFor(signal.group?.room_id ?? null),
    from: { cid: from, username },
    media: signal.media,
    others,
  });
}

/**
 * Tell peers the microphone or camera changed, so their tiles stay honest.
 *
 * Beside `announceSendCodec` because it is the same kind of thing: a local
 * change that peers must be told about or their view of us goes stale. Lifted
 * out of `CallManager`, which is at its length ceiling.
 */
export async function announceSelfMedia(
  m: CallManagerInternals,
  media: CallMediaKinds,
): Promise<void> {
  const state: CallState | null = m.getState();
  if (!state) return;

  m.apply({ type: 'self-media-changed', media });
  const update: CallSignalPayload = { kind: 'CallMediaState', call_id: state.callId, media };
  await Promise.all(
    [...state.participants.keys()].map((cid) =>
      m.transport.sendSignal(cid, update).catch(() => undefined),
    ),
  );
}
