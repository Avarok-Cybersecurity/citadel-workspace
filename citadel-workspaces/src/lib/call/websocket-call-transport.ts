/**
 * The real CallTransport, over the app's existing WebSocket client.
 *
 * Everything call-specific lives behind the CallTransport interface, so this
 * file is only translation: call intent in, InternalServiceRequest out. The
 * orchestration it serves is tested against a fake of this same interface.
 */

import { websocketService } from '@/lib/websocket-service';
import { sendP2PCommand } from '@/lib/p2p/message-send-operations';
import { P2PCommandType, type CallSignalPayload } from '@/types/p2p-commands';
import type { MessageSenderConfig } from '@/lib/p2p/message-sender-types';
import type { CallTransport } from './call-transport';
import type { WireFrame } from './frame-codec';
import { SIGNAL_QUEUE_MAX_WAIT_MS } from './call-constants';
import { requestResponse } from '@/lib/websocket/request-response';
import { debugLog, warnLog } from '@/lib/debug-config';
import { instanceChannel, instanceManager } from '@/lib/multi-instance';
import { deliverRelayedFrame, MEDIA_FRAME_OUT, type RelayedFrame } from '@/lib/multi-instance/media-frame-relay';

/**
 * How long to wait for the service to confirm a media session.
 *
 * The service itself waits up to 5s for the peer's UDP channel before
 * answering; this must exceed that or a slow-but-successful open would be
 * reported as a failure while the session actually came up.
 */
const MEDIA_OPEN_TIMEOUT_MS: number = 10_000;

export interface WebSocketCallTransportOptions {
  selfCid: bigint;
  /**
   * Only the slice of the P2P sender configuration this actually uses.
   *
   * MessageSenderConfig carries eleven members built for chat — conversation
   * stores, message listeners, delivery status. Requiring all of them to send a
   * call invite would tie calling to machinery it has nothing to do with, and
   * make it untestable without standing up a conversation store.
   */
  senderConfig: Pick<MessageSenderConfig, 'getCurrentCid'>;
}

export class WebSocketCallTransport implements CallTransport {
  /** Tail of the in-flight signal sends; see sendSignal for why they chain. */
  private signalChain: Promise<void> = Promise.resolve();

  constructor(private readonly options: WebSocketCallTransportOptions) {}

  async openSession(peerCid: bigint): Promise<void> {
    const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
    debugLog('Call', 'requesting media session', { peerCid: peerCid.toString() });

    // Awaiting the service's verdict is the point: MediaOpen can fail there —
    // no UDP channel, peer gone — and a resolve-on-queue would report success
    // while the manager fans frames into a session that never existed. That
    // failure path is the one that tells the user WHY the call cannot start.
    try {
      await requestResponse<true>({
        request: {
          MediaOpen: {
            request_id: requestId,
            cid: this.options.selfCid,
            peer_cid: peerCid,
          },
        },
        requestId,
        // sendRequest, not the raw client: in a follower tab there is no client,
        // and this proxies through the leader with the answer routed back here
        // by this request_id (send-request.ts).
        sendRequest: (request) => websocketService.sendRequest(request as Record<string, unknown>),
        timeoutMs: MEDIA_OPEN_TIMEOUT_MS,
        operationName: 'MediaOpen',
        matcher: {
          matchSuccess: (message) => {
            const opened: { request_id?: string; } | undefined = message.MediaSessionOpened as { request_id?: string } | undefined;
            return opened?.request_id === requestId ? true : undefined;
          },
          matchFailure: (message) => {
            const failed: { request_id?: string; message?: string; } | undefined = message.MediaSessionFailed as
              | { request_id?: string; message?: string }
              | undefined;
            if (failed?.request_id !== requestId) return undefined;
            return failed.message ?? 'the media session could not be opened';
          },
        },
      });
    } catch (error) {
      // The service's own sentence, as a top-level string so a console capture
      // prints it whole. In a group the manager turns a refused leg into that
      // peer dropping out, and the reason went nowhere: a CI run saw one mesh
      // leg never open, four times, with nothing saying why.
      warnLog('Call', `media session with ${peerCid} was refused:`, error instanceof Error ? error.message : String(error));
      throw error;
    }

    debugLog('Call', 'media session opened', { peerCid: peerCid.toString() });
  }

  async closeSession(peerCid: bigint): Promise<void> {
    await websocketService.sendRequest({
      MediaClose: {
        request_id: crypto.randomUUID(),
        cid: this.options.selfCid,
        peer_cid: peerCid,
      },
    });
  }

  sendFrame(peerCid: bigint, frame: WireFrame): void {
    // Deliberately not awaited, and deliberately not routed through the generic
    // request path: at 30-60 frames a second per track, a promise and a full
    // request serialization per frame is pure overhead for a result nobody
    // inspects.
    if (!instanceManager.isLeader) {
      // The media stays in this tab; only the encoded frame crosses, once, and
      // the leader puts it on its socket. See media-frame-relay.ts.
      const relayed: RelayedFrame = { cid: this.options.selfCid, peerCid, ...frame };
      instanceChannel.send({ type: MEDIA_FRAME_OUT, targetInstanceId: 'leader', payload: relayed });
      return;
    }
    // getClient(), not getWasmClient(): the async variant awaits init(), and a
    // frame path cannot afford an await per frame. By the time frames flow the
    // client is initialised, so the synchronous accessor is the correct one.
    // The leader's own call sends here and never relays.
    deliverRelayedFrame({ cid: this.options.selfCid, peerCid, ...frame }, true, websocketService.getClient());
  }

  async sendSignal(peerCid: bigint, signal: CallSignalPayload): Promise<void> {
    // Call control goes on the RELIABLE path while the media it sets up goes on
    // the lossy one. Losing a video frame costs a sixtieth of a second; losing
    // a "call ended" leaves both sides staring at a call that is over.
    //
    // Chained, not raced. A group call fans one signal out to every invitee in
    // the same tick (Promise.all in the manager), and two sends interleaving
    // through the messenger's async path reproducibly lose exactly one of
    // them: the caller logs both sends, one peer never rings. Serialising the
    // wire I/O here keeps every caller's concurrent shape while the messages
    // actually leave one at a time — they are a few hundred bytes each.
    const send: Promise<void> = this.signalChain.then(() =>
      sendP2PCommand(
        // The cast is the narrowing above meeting a wider published signature.
        // sendP2PCommand takes the full config but reads only getCurrentCid, and
        // even that is skipped when the sender cid is supplied — as it is here.
        this.options.senderConfig as MessageSenderConfig,
        peerCid,
        { type: P2PCommandType.CallSignal, payload: signal },
        this.options.selfCid,
      ),
    );
    // The chain absorbs failures so one refused signal cannot poison every
    // signal after it; the caller still sees its own rejection.
    //
    // It also stops waiting after SIGNAL_QUEUE_MAX_WAIT_MS. Nothing along the
    // path below has a timeout, so without this one stalled send would hold the
    // queue — and the hang-up behind it — indefinitely, which is the exact
    // outcome the ordering exists to prevent.
    this.signalChain = Promise.race([
      send.then(
        () => undefined,
        () => undefined,
      ),
      new Promise<void>((resolve) => setTimeout(resolve, SIGNAL_QUEUE_MAX_WAIT_MS)),
    ]);
    return send;
  }
}
