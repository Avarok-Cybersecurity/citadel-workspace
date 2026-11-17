/**
 * What a glue app's internal-HTTP client and server need from its ports: send a client frame,
 * answer on a served stream, say a body chunk was read (so the host grants its sender credit),
 * and hear inbound frames. The Calendar's `CalendarIhttp` (lib/calendar/ports.ts) is one.
 */
import type { InboundIhttpFrame } from '../host/ports';
import type { Address } from '../sdk/generated/Address';
import type { Caller } from '../sdk/generated/Caller';
import type { IhttpFrame } from '../sdk/generated/IhttpFrame';
import type { Transport } from '../sdk/generated/Transport';

export interface IhttpIo {
  readonly call: (to: Address, frame: IhttpFrame, transport: Transport) => Promise<void>;
  readonly respond: (peer: Caller, frame: IhttpFrame) => Promise<void>;
  readonly consumed: (peer: Caller, stream: bigint) => Promise<void>;
  readonly onFrame: (listener: (inbound: InboundIhttpFrame) => void) => () => void;
}

/** A request served or a response received, body complete. */
export interface IhttpMessage {
  readonly status: number;
  readonly body: Uint8Array;
}
