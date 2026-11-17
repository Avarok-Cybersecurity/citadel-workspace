/**
 * TEST FAKE: the far end of an ihttp client call, as the reference host plays it
 * (apps/sdk-fixtures/harness/src/remote.rs). Once the app's request has ended it answers status
 * 200, `chunks` body frames of `chunk_bytes` bytes (chunk i filled with byte i % 256), then End,
 * sending body frames only under the caller's credit: IHTTP_INITIAL_CREDIT to start and one more
 * per Credit the HOST mints from the app's IhttpConsumed. A body frame the app sends is credited
 * back at once. Frames reach the instance through IhttpPort.onFrame, after the call returns.
 */
import { IHTTP_INITIAL_CREDIT } from '../../sdk/generated/AbiConstants';
import type { Address } from '../../sdk/generated/Address';
import type { Caller } from '../../sdk/generated/Caller';
import type { IhttpFrame } from '../../sdk/generated/IhttpFrame';
import type { IhttpPort, InboundIhttpFrame, PortAnswer } from '../ports';

export interface IhttpRemoteConfig {
  readonly chunks: number;
  readonly chunk_bytes: number;
}

interface Stream {
  readonly from: Caller;
  credit: number;
  sent: number;
  answering: boolean;
}

const caller = (to: Address): Caller => ({
  username: 'bob', cid: 2n, app_id: 'user' in to ? to.user.app_id : to.scope.app_id, install_id: 'remote-install', via: 'p2p',
});

export function ihttpRemote(cfg: IhttpRemoteConfig): IhttpPort {
  const streams: Map<bigint, Stream> = new Map<bigint, Stream>();
  let listener: (f: InboundIhttpFrame) => void = () => {};
  const emit = (s: Stream, stream: bigint, kind: IhttpFrame['kind']): void => {
    const frame: IhttpFrame = { v: 1, stream, kind };
    setTimeout(() => listener({ from: s.from, frame }), 0);
  };
  const send = (id: bigint): void => {
    const s: Stream | undefined = streams.get(id);
    if (s === undefined || !s.answering) return;
    while (s.credit > 0 && s.sent < cfg.chunks) {
      emit(s, id, { Body: { bytes: new Uint8Array(cfg.chunk_bytes).fill(s.sent % 256) } });
      s.credit -= 1;
      s.sent += 1;
    }
    if (s.sent === cfg.chunks) {
      emit(s, id, 'End');
      streams.delete(id);
    }
  };
  return {
    IhttpServe: () => ({ ok: null }),
    IhttpCall: ({ to, frame }): PortAnswer<null> => {
      const id: bigint = frame.stream;
      const kind: IhttpFrame['kind'] = frame.kind;
      const s: Stream | undefined = streams.get(id);
      if (typeof kind === 'object' && 'RequestHead' in kind) {
        streams.set(id, { from: caller(to), credit: IHTTP_INITIAL_CREDIT, sent: 0, answering: false });
      } else if (typeof kind === 'object' && 'Body' in kind) {
        if (s !== undefined) emit(s, id, { Credit: { n: 1 } });
      } else if (kind === 'End' && s !== undefined) {
        s.answering = true;
        emit(s, id, { ResponseHead: { status: 200, headers: [], body_len: BigInt(cfg.chunks * cfg.chunk_bytes) } });
        send(id);
      } else if (typeof kind === 'object' && 'Cancel' in kind) {
        streams.delete(id);
      }
      return { ok: null };
    },
    respond: (_peer, frame): PortAnswer<null> => {
      const s: Stream | undefined = streams.get(frame.stream);
      if (s !== undefined && typeof frame.kind === 'object' && 'Credit' in frame.kind) {
        s.credit += frame.kind.Credit.n;
        send(frame.stream);
      }
      return { ok: null };
    },
    onFrame: (l) => {
      listener = l;
      return () => {};
    },
  };
}
