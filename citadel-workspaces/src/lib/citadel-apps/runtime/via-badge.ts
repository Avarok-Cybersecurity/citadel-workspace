/**
 * Which plane a zone's internal HTTP last moved over, shown to the member above the zone (E6):
 * whether a peer was reached directly or through the server is theirs to see, not only the app's
 * to say. Pure: the label of each `via`, and a port that reports the plane of every frame it
 * delivers to the instance. Topic messages do not move it: a topic heartbeat would hide the plane
 * of the request the member is waiting on.
 */
import type { IhttpPort, InboundIhttpFrame } from '../host/ports';
import type { Via } from '../sdk/generated/Via';

/** The badge's text for each plane; every `via` has one, so a new plane cannot render blank. */
export const VIA_BADGE: Readonly<Record<Via, string>> = {
  p2p: 'Peer to peer',
  relay: 'Through the server',
  group: 'Over a topic',
};

/** `port`, telling `heard` the plane of each frame it delivers, before the instance gets it. */
export function reportingVia(port: IhttpPort, heard: (via: Via) => void): IhttpPort {
  return {
    ...port,
    onFrame: (listener: (i: InboundIhttpFrame) => void): (() => void) => port.onFrame((i: InboundIhttpFrame): void => {
      heard(i.from.via);
      listener(i);
    }),
  };
}
