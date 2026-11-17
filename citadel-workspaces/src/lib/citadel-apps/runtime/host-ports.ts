/**
 * The ports one running instance gets, bound to its install: server-side storage, blobs, files and
 * egress over `AppsRequest::Call`; `storage.local` and host egress through the local agent, only
 * when this tab's agent says it serves apps (`apps` in its greeting) and a session is signed in;
 * internal HTTP over the server relay and, with an agent session, over P2P (peer-ports.ts), with
 * the app's topics; the zone's own events and ui ports (zone-runtime.ts); the page log. A port left out answers
 * `{refused: {unavailable: <port>}}` (host/ports.ts), which is what "not here" means to an app.
 */
import type { AppInstall, AppLimits, Capability } from 'citadel-workspace-client-ts';
import type { AppsResult } from '@/lib/workspace-service/apps-operations';
import { advertiseService, callHost, ihttpSend, withdrawService } from '@/lib/workspace-service/apps-runtime-operations';
import type { EventsPort, HostNetPort, HostPorts, LogPort, StoragePort, UiPort } from '../host/ports';
import { agentKvPort, splitStorage } from './agent-kv-port';
import { agentFetchPort } from './agent-fetch-port';
import { relayIhttpPort, type RelayIhttpPort } from './ihttp-relay-port';
import { serverBlob, serverFiles, serverNet, serverStorage, type HostCaller } from './kernel-call-ports';
import type { PlaneSeat } from './install-plane-registry';
import { peerPorts, type PeerPorts, type PeerWorld } from './peer-ports';

/** The peer world (transport, agent and its session, pushes, clock, policy, ...) and the rest the ports need. */
export interface PortWorld extends PeerWorld {
  readonly every: (ms: number, fire: () => void) => () => void;
  readonly log: LogPort;
}

export interface BoundPorts {
  readonly ports: HostPorts;
  /** What the instance may do for this member: the install's grant less what they did not consent to. */
  readonly held: ReadonlySet<Capability>;
  /** Ends the instance's advertisement (ihttp-relay-port.ts); null when it never served. */
  readonly withdraw: () => Promise<AppsResult<number> | null>;
  /** Drops what the ports hold open (host egress streams, topics), settling once the agent let go. */
  readonly stop: () => Promise<void>;
}

/** The ports a zone owns: its input (zone-input.ts) and its toolbar (ui-port.ts). A glue tab has neither (null). */
export interface ZonePorts {
  readonly events: EventsPort;
  readonly ui: UiPort;
}

/** `instance`: this running instance's name, which its advertisement is held under; `seat`: its place on the page. */
/** `limits`: the release's manifest limits (its topics' sizes and rates). */
export function hostPortsFor(install: AppInstall, limits: AppLimits, instance: string, scopeKey: string, zone: ZonePorts | null, seat: PlaneSeat, w: PortWorld): BoundPorts {
  const call: HostCaller = (bytes: Uint8Array) => callHost(w.transport, install.id, bytes);
  const session: { readonly cid: bigint } | null = w.agentSession;
  const local: StoragePort | null = session === null ? null : agentKvPort(w.agent, { cid: session.cid, appId: install.app_id, scopeKey, timeoutMs: w.policy.portTimeoutMs });
  const hostNet: (HostNetPort & { readonly closeAll: () => void }) | null = session === null ? null : agentFetchPort(w.agent, {
    cid: session.cid, appId: install.app_id, installId: install.id, timeoutMs: w.policy.hostNetTimeoutMs,
    grant: { hosts: install.details.host_network_hosts, private: install.granted.includes('net.host.private') },
  });
  const ihttp: RelayIhttpPort = relayIhttpPort({
    installId: install.id, seat, pushes: w.pushes, sha256Hex: w.sha256Hex, nowMs: w.nowMs, every: w.every,
    send: (to, frame) => ihttpSend(w.transport, install.id, to, frame),
    advertise: (digest, untilMs) => advertiseService(w.transport, install.id, instance, digest, untilMs),
    withdraw: () => withdrawService(w.transport, install.id, instance),
  });
  const peer: PeerPorts = peerPorts(install, scopeKey, limits, ihttp, seat, w);
  const ports: HostPorts = {
    storage: splitStorage(serverStorage(call), local), blob: serverBlob(call), storeFiles: serverFiles(call),
    serverNet: serverNet(call), ihttp: peer.ihttp, log: w.log,
    ...(zone === null ? {} : { events: zone.events, ui: zone.ui }),
    ...(hostNet === null ? {} : { hostNet }), ...(peer.topic === null ? {} : { topic: peer.topic }),
  };
  return {
    ports,
    held: peer.held,
    withdraw: ihttp.withdraw,
    stop: async (): Promise<void> => {
      hostNet?.closeAll();
      await peer.stop();
      seat.detach();
    },
  };
}
