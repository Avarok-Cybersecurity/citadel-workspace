/**
 * One instance's internal-HTTP, both ways, on one listener: an inbound frame goes to the stream
 * it belongs to, served streams first, as the host's router decides it (`ihttp-router.ts`
 * `inbound`): a RequestHead always opens a served stream, and the router has already refused one
 * whose id this instance uses for a call. A frame neither side owns is dropped; the router has
 * answered it.
 */
import type { InboundIhttpFrame } from '../host/ports';
import { IhttpClient } from './ihttp-client';
import type { IhttpIo } from './ihttp-io';
import { IhttpServer, type IhttpHandler } from './ihttp-server';

export interface IhttpEndpoint {
  readonly client: IhttpClient;
  readonly close: () => void;
}

export function ihttpEndpoint(io: IhttpIo, handler: IhttpHandler): IhttpEndpoint {
  const client: IhttpClient = new IhttpClient(io);
  const server: IhttpServer = new IhttpServer(io, handler);
  const off: () => void = io.onFrame(({ from, frame }: InboundIhttpFrame): void => {
    if (server.owns(from, frame)) server.take(from, frame);
    else if (client.owns(from, frame)) client.take(from, frame);
  });
  return { client, close: off };
}
