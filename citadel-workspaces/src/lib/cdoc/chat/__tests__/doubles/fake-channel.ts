/**
 * The P2P channel between two chat sessions, faked. The network is the one thing these tests
 * replace (no agent, no WebSocket, no peer): it is what has to drop, duplicate and reorder on
 * demand, deterministically. What crosses it is real: the production encoder's CBOR bytes,
 * read on arrival by the production decoder and the envelope guard message-handler.ts uses.
 * Every message's size is kept, so the wire bound can be asserted on what was actually sent.
 */
import { deserializeP2PCommand, P2PCommandType, type P2PCommand } from '@/types/p2p-commands';
import { isCdocChatSyncPayload, type CdocChatSyncPayload } from '@/types/cdoc-chat-sync';
import type { ChatTransport } from '../../chat-ports';
import type { Rng } from './rng';

export interface Faults {
  /** Chance each message is lost. */
  readonly drop: number;
  /** Chance each delivered message arrives twice. */
  readonly duplicate: number;
  /** Whether what is in flight arrives in a shuffled order. */
  readonly reorder: boolean;
}

export const CLEAN: Faults = { drop: 0, duplicate: 0, reorder: false };

interface Flight {
  readonly to: bigint;
  readonly bytes: Uint8Array;
}

export interface Sent {
  readonly from: bigint;
  readonly kind: string;
  readonly bytes: number;
}

export class FakeChannel {
  readonly sent: Sent[] = [];
  private inFlight: Flight[] = [];
  private readonly heard: Map<bigint, Set<(payload: CdocChatSyncPayload) => void>> = new Map();
  private readonly connected: Map<bigint, Set<() => void>> = new Map();
  /** While false, whatever is sent is lost, as on a dropped link. */
  up: boolean = true;

  transport(self: bigint, peer: bigint): ChatTransport {
    const on = <L>(map: Map<bigint, Set<L>>, listener: L): (() => void) => {
      const set: Set<L> = map.get(self) ?? new Set<L>();
      map.set(self, set);
      set.add(listener);
      return (): void => { set.delete(listener); };
    };
    return {
      selfCid: self,
      peerCid: peer,
      send: async (bytes: Uint8Array): Promise<void> => {
        const command: P2PCommand = deserializeP2PCommand(bytes);
        this.sent.push({ from: self, kind: isCdocChatSyncPayload(command.payload) ? command.payload.sync.kind : 'not a chat command', bytes: bytes.byteLength });
        if (this.up) this.inFlight.push({ to: peer, bytes: bytes.slice() });
      },
      onMessage: (listener: (payload: CdocChatSyncPayload) => void): (() => void) => on(this.heard, listener),
      onConnected: (listener: () => void): (() => void) => on(this.connected, listener),
    };
  }

  get inFlightCount(): number {
    return this.inFlight.length;
  }

  /** The link comes back: each side hears that it is connected. */
  reconnect(): void {
    this.up = true;
    for (const listeners of [...this.connected.values()]) for (const listener of [...listeners]) listener();
  }

  /** Hands over what is in flight now, with `faults` drawn from `rng`; returns how many arrived. */
  deliver(rng: Rng, faults: Faults): number {
    const batch: Flight[] = this.inFlight.splice(0);
    if (faults.reorder) rng.shuffle(batch);
    let arrived: number = 0;
    for (const flight of batch) {
      if (rng.chance(faults.drop)) continue;
      const copies: number = rng.chance(faults.duplicate) ? 2 : 1;
      for (let i: number = 0; i < copies; i += 1) this.arrive(flight);
      arrived += copies;
    }
    return arrived;
  }

  /** Hands over the first `count` messages in flight, in order, and keeps the rest in flight. */
  deliverFirst(count: number): void {
    for (const flight of this.inFlight.splice(0, count)) this.arrive(flight);
  }

  /** Loses the first `count` messages in flight. */
  dropFirst(count: number): void {
    this.inFlight.splice(0, count);
  }

  /** Drops everything in flight. */
  lose(): void {
    this.inFlight = [];
  }

  private arrive(flight: Flight): void {
    const command: P2PCommand = deserializeP2PCommand(flight.bytes);
    if (command.type !== P2PCommandType.CdocChatSync || !isCdocChatSyncPayload(command.payload)) throw new Error('the channel carried something that is not a chat document command');
    for (const listener of [...(this.heard.get(flight.to) ?? [])]) listener(command.payload);
  }
}
