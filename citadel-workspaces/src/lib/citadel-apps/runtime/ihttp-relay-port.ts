/**
 * Internal HTTP over the workspace server's relay (R4.4): serving advertises the routes
 * (`AdvertiseService` for this instance, again every minute while it runs, and `WithdrawService`
 * when it closes, so its callers learn at once rather than at the expiry), a client frame and a response frame go
 * out as `IhttpSend`, and frames the server relays to this install arrive pushed as
 * `AppsResponse::IhttpFrame`, stamped with who sent them by the server, never by an app. Frames
 * are CBOR of the wire's `IhttpFrame` (citadel-ihttp-types) both ways, translated from and to
 * the app's shapes by host/ihttp-wire.ts, so there is no textual HTTP to smuggle through.
 *
 * Every frame here is `via: relay`. Which instance of the install takes a frame, and under which
 * id a call goes out and comes back, is the page's (install-plane-registry.ts).
 */
import type { IhttpAddress } from 'citadel-workspace-client-ts';
import type { AppsResult } from '@/lib/workspace-service/apps-operations';
import { readAppsAnswer, type AppsAnswer } from '../wire/apps-answer';
import { decodeCbor, encodeCbor, type Decoded } from '../host/cbor';
import { fromWireFrame, RELAY_STREAM_BIT, toWireFrame } from '../host/ihttp-wire';
import { addressApp } from '../host/ihttp-called';
import type { IhttpPort, InboundIhttpFrame, PortAnswer } from '../host/ports';
import type { Address } from '../sdk/generated/Address';
import type { Caller } from '../sdk/generated/Caller';
import type { IhttpFrame } from '../sdk/generated/IhttpFrame';
import type { Route } from '../sdk/generated/Route';
import type { PlaneSeat } from './install-plane-registry';
import { refusedFor } from './kernel-call-ports';

/** An advertisement lives this long; it is renewed every ADVERTISE_EVERY_MS while mounted. */
export const ADVERTISE_TTL_MS: number = 90_000;
export const ADVERTISE_EVERY_MS: number = 60_000;

export interface RelayDeps {
  readonly installId: string;
  /** This instance's place among the install's instances on the page (install-plane-registry.ts). */
  readonly seat: PlaneSeat;
  readonly send: (to: IhttpAddress, frame: Uint8Array) => Promise<AppsResult<null>>;
  /** AdvertiseService and WithdrawService for this instance of the install. */
  readonly advertise: (routesDigest: string, untilMs: bigint) => Promise<AppsResult<bigint>>;
  readonly withdraw: () => Promise<AppsResult<number>>;
  /** Every apps answer the server pushes to this tab (`workspace:apps`); returns the unsubscribe. */
  readonly pushes: (listener: (answer: unknown) => void) => () => void;
  readonly sha256Hex: (bytes: Uint8Array) => Promise<string>;
  readonly nowMs: () => number;
  readonly every: (ms: number, fire: () => void) => () => void;
}

export const addressFor = (to: Address): IhttpAddress =>
  ('user' in to ? { User: { app_id: to.user.app_id, username: to.user.username } } : { Scope: { app_id: to.scope.app_id, scope_key: to.scope.scope_key } });

/**
 * The one definition of `routes_digest` on the page (the kernel's is kernel/apps/ihttp_routes.rs):
 * lowercase hex sha256 of the routes as a manifest writes them (`METHOD /path`), sorted, one per
 * line. The kernel takes an advertisement only for the table the installer consented to.
 */
export function routesDigest(routes: readonly Route[], sha256Hex: (bytes: Uint8Array) => Promise<string>): Promise<string> {
  const lines: string[] = routes.map((r: Route) => `${r.method} ${r.path}`).sort();
  return sha256Hex(new TextEncoder().encode(lines.join('\n')));
}

const wire = (frame: IhttpFrame): Uint8Array => encodeCbor(toWireFrame(frame));

const sent = (r: AppsResult<unknown>): PortAnswer<null> => (r.ok ? { ok: null } : { refused: refusedFor(r.refusal) });

/** The relay port, and its end: `withdraw` stops the renewal and, if this instance ever served, withdraws it. */
export interface RelayIhttpPort extends IhttpPort {
  /** Null when it never advertised; otherwise the server's answer (the relayed streams it ended). */
  readonly withdraw: () => Promise<AppsResult<number> | null>;
}

export function relayIhttpPort(d: RelayDeps): RelayIhttpPort {
  let renew: (() => void) | null = null;
  let served: boolean = false;
  let withdrawn: boolean = false;
  let serving: Promise<PortAnswer<null>> | null = null;
  const advertise = async (digest: string): Promise<PortAnswer<null>> => sent(await d.advertise(digest, BigInt(d.nowMs() + ADVERTISE_TTL_MS)));
  const serve = async (routes: readonly Route[]): Promise<PortAnswer<null>> => {
    const digest: string = await routesDigest(routes, d.sha256Hex);
    renew?.();
    renew = null;
    const first: PortAnswer<null> = await advertise(digest);
    if ('ok' in first) served = true;
    // A renewal that fails is retried at the next tick; the app learns of trouble from its callers.
    if ('ok' in first && !withdrawn) renew = d.every(ADVERTISE_EVERY_MS, (): void => { void advertise(digest); });
    return first;
  };
  return {
    IhttpServe: ({ routes }): Promise<PortAnswer<null>> => {
      serving = serve(routes);
      return serving;
    },
    IhttpCall: async ({ to, frame }): Promise<PortAnswer<null>> => sent(await d.send(addressFor(to), wire(d.seat.callOut(addressApp(to), frame)))),
    respond: async (peer: Caller, frame: IhttpFrame): Promise<PortAnswer<null>> => {
      if (frame.kind === 'End' || (typeof frame.kind === 'object' && 'Cancel' in frame.kind)) d.seat.servedEnded(peer, frame.stream);
      return sent(await d.send({ User: { app_id: peer.app_id, username: peer.username } }, wire(frame)));
    },
    onFrame: (listener: (inbound: InboundIhttpFrame) => void): (() => void) => d.pushes((payload: unknown): void => {
      const answer: AppsAnswer = readAppsAnswer(payload);
      if (answer.kind !== 'ihttp-frame' || answer.toInstallId !== d.installId) return;
      const decoded: Decoded = decodeCbor(Uint8Array.from(answer.frame));
      const frame: IhttpFrame | null = decoded.ok ? fromWireFrame(decoded.value) : null;
      if (frame === null) return;
      const from: Caller = { username: answer.from.username, cid: answer.from.cid, app_id: answer.from.app_id, install_id: answer.from.install_id, via: 'relay' };
      // The relay numbers the streams it delivers to a server from its bit; a caller's own ids never carry it.
      if ((frame.stream & RELAY_STREAM_BIT) !== 0n || (typeof frame.kind === 'object' && 'RequestHead' in frame.kind)) {
        if (d.seat.takesServed(from, frame)) listener({ from, frame });
        return;
      }
      const mine: IhttpFrame | null = d.seat.callIn(from.app_id, frame);
      if (mine !== null) listener({ from, frame: mine });
    }),
    withdraw: async (): Promise<AppsResult<number> | null> => {
      withdrawn = true;
      renew?.();
      renew = null;
      // An advertisement still in flight is withdrawn too, once it has landed.
      if (serving !== null) await serving;
      return served ? d.withdraw() : null;
    },
  };
}
