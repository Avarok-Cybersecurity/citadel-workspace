/**
 * Tabs of different builds in one browser, for the tests of what they agree on.
 *
 * Real, per tab, each in its own module graph: the InstanceChannel (the live one, or the frozen
 * protocol-1 copy in fixtures/legacy-v1), its election and dispatch, the instance manager, the
 * leadership listener that opens and closes the socket (websocket/leadership-listener.ts), and
 * the session claims a leader makes on its socket (follower-session-claims.ts).
 *
 * Stood in, because a test has one page:
 * - BroadcastChannel: a hub that hands each post, structured-cloned, to every OTHER tab's
 *   channel on a later task, as the browser does; a tab can be cut off (`reachable`);
 * - the build a tab runs: build-identity per tab, since `__BUILD_SEQ__` is fixed per bundle;
 * - the socket: opening takes SOCKET_OPEN_MS; a request sent on it takes `sendTakesMs`
 *   (this build's leader executes followers' requests in leader-outbound-handler.ts); then the connection reports success, as
 *   initialization.ts does. A claim made while it opens waits for it, as sendRequest waits
 *   for a promoted leader's socket; one made with no socket open or opening fails the way
 *   sendRequest fails it ("leader without client"), and is recorded.
 */
import { vi } from 'vitest';
import type { ChannelMessage } from '../channel-types';
import type { AckResult } from '../outbound-queue';
import type { InstanceInfo } from '../instance-manager-types';

export const SOCKET_OPEN_MS: number = 20;
/** The CID-report window a leader gives tabs to answer; the app's is TIMEOUT.CID_REPORT_WINDOW_MS. */
const REPORT_WINDOW_MS: number = 2000;

export type Build = 'legacy' | 'proto2';

interface TabChannel {
  sendToLeader(payload: unknown, requestId?: string): Promise<AckResult>;
  sendAck(targetInstanceId: string, requestId: string, result: AckResult): void;
  destroy(): void;
}

export interface Tab {
  readonly name: string;
  readonly build: Build;
  readonly manager: typeof import('../instance-manager')['instanceManager'];
  readonly emitter: typeof import('@/lib/event-emitter')['eventEmitter'];
  readonly channel: TabChannel;
  /** This tab's own staleness module; the frozen build has none. */
  readonly staleness: typeof import('../tab-staleness') | null;
  reachable: boolean;
  socketsOpened: number;
  socketsClosed: number;
  clientOpen: boolean;
  promotions: number;
  demotedAt: number[];
  promotedAt: number[];
  leaderWithoutClient: string[];
  /** What this tab, leading, sent on its socket. */
  sent: unknown[];
  sendTakesMs: number;
}

/**
 * More deliveries than any settled set of tabs makes in a test: two leaders answering each
 * other's heartbeats do it in a tight loop, which would otherwise spin the fake clock for ever.
 * Past it the hub delivers nothing, and `livelocked()` says so.
 */
const MAX_DELIVERIES: number = 1500;
let delivered: number = 0;

let opening: Tab | null = null;
const channels: FakeBroadcastChannel[] = [];
const tabs: Tab[] = [];

class FakeBroadcastChannel {
  onmessage: ((event: MessageEvent<ChannelMessage>) => void) | null = null;
  private readonly owner: Tab;

  constructor(readonly name: string) {
    if (opening === null) throw new Error('a BroadcastChannel was opened outside openTab');
    this.owner = opening;
    channels.push(this);
  }

  postMessage(message: ChannelMessage): void {
    if (!this.owner.reachable) return;
    for (const other of channels) {
      if (other === this || other.name !== this.name) continue;
      const copy: ChannelMessage = structuredClone(message);
      setTimeout((): void => {
        if (!other.owner.reachable || !channels.includes(other) || delivered >= MAX_DELIVERIES) return;
        delivered += 1;
        other.onmessage?.({ data: copy } as MessageEvent<ChannelMessage>);
      }, 0);
    }
  }

  addEventListener(): void {}

  close(): void {
    channels.splice(channels.indexOf(this), 1);
  }
}

/** Open a tab running `build`, whose bundle was made at `seq`, holding session `cid`. */
export async function openTab(name: string, build: Build, seq: number, cid: bigint): Promise<Tab> {
  vi.resetModules();
  sessionStorage.clear();
  vi.doMock('../build-identity', () => ({ BUILD_SEQ: seq, declaredEntry: (): null => null, declareRunningEntry: (): void => undefined }));
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);

  const { instanceManager } = await import('../instance-manager');
  const { eventEmitter } = await import('@/lib/event-emitter');
  const tab: Tab = {
    name, build, manager: instanceManager, emitter: eventEmitter, channel: null as unknown as TabChannel,
    staleness: build === 'proto2' ? await import('../tab-staleness') : null,
    reachable: true, socketsOpened: 0, socketsClosed: 0, clientOpen: false,
    promotions: 0, demotedAt: [], promotedAt: [], leaderWithoutClient: [], sent: [], sendTakesMs: 0,
  };
  opening = tab;
  const module: { instanceChannel: TabChannel & { relinquishLeadership(): void; requestCidReport(): void } } =
    build === 'proto2' ? await import('../instance-channel') : await import('./fixtures/legacy-v1/instance-channel');
  opening = null;
  const channel: TabChannel & { relinquishLeadership(): void; requestCidReport(): void } = module.instanceChannel;
  (tab as { channel: TabChannel }).channel = channel;

  await wireSocket(tab, channel);
  eventEmitter.on('instance:leader-changed', ({ isLeader }: { isLeader: boolean }): void => {
    if (isLeader) { tab.promotions += 1; tab.promotedAt.push(Date.now()); } else tab.demotedAt.push(Date.now());
  });
  instanceManager.setCid(cid);
  tabs.push(tab);
  return tab;
}

async function wireSocket(tab: Tab, channel: { relinquishLeadership(): void; requestCidReport(): void }): Promise<void> {
  const { installLeadershipListener } = await import('@/lib/websocket/leadership-listener');
  const { installFollowerSessionClaims } = await import('../follower-session-claims');
  let creating: Promise<void> | null = null;
  const outbound: typeof import('../leader-outbound-handler')['leaderOutboundHandler'] | null =
    tab.build === 'proto2' ? (await import('../leader-outbound-handler')).leaderOutboundHandler : null;
  installLeadershipListener({
    createWebSocketAsLeader: async (): Promise<void> => {
      // The production gate, from initialization.ts; the frozen build has none.
      tab.staleness?.assertMayOpenSocket((): void => channel.relinquishLeadership());
      tab.socketsOpened += 1;
      creating = new Promise<void>((resolve: () => void): void => { setTimeout(resolve, SOCKET_OPEN_MS); });
      await creating;
      tab.clientOpen = true;
      outbound?.setWebSocketSendFunction(async (message: Record<string, unknown>): Promise<void> => {
        tab.sent.push(message);
        await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, tab.sendTakesMs); });
      });
      tab.emitter.emit('on-ws-connection-success');
    },
    closeLeaderClient: async (): Promise<void> => {
      if (creating) await creating;
      if (!tab.clientOpen) return;
      tab.clientOpen = false;
      tab.socketsClosed += 1;
      tab.emitter.emit('websocket-disconnected', { reason: 'demoted' });
    },
  });
  installFollowerSessionClaims({
    on: (event: string, handler: (payload: unknown) => void): void => { tab.emitter.on(event, handler); },
    isLeader: (): boolean => tab.manager.isLeader,
    selfInstanceId: (): string => tab.manager.instanceId,
    instances: (): InstanceInfo[] => tab.manager.getAllInstances(),
    claim: async (cid: bigint): Promise<unknown> => {
      if (creating) await creating;
      if (tab.clientOpen) return null;
      tab.leaderWithoutClient.push(`${tab.name}: claiming ${cid} failed (leader without client)`);
      throw new Error('WebSocket client not available (leader without client)');
    },
    isOwnedByALiveConnection: (): boolean => false,
    reportFailure: (): void => undefined,
    requestReports: (): void => channel.requestCidReport(),
    unregister: (instanceId: string): void => tab.manager.unregisterInstance(instanceId),
    reportWindowMs: REPORT_WINDOW_MS,
    schedule: (fn: () => void, ms: number): void => { setTimeout(fn, ms); },
  });
}

/** Every tab still open: closed, without the goodbye that would re-elect (the test is over). */
export function closeAllTabs(): void {
  for (const tab of tabs) tab.reachable = false;
  for (const tab of tabs) tab.channel.destroy();
  tabs.length = 0;
  channels.length = 0;
  delivered = 0;
  vi.unstubAllGlobals();
  vi.doUnmock('../build-identity');
}

/** True when the tabs exchanged messages without end (see MAX_DELIVERIES). */
export function livelocked(): boolean {
  return delivered >= MAX_DELIVERIES;
}

export function leaders(): Tab[] {
  return tabs.filter((tab: Tab): boolean => tab.manager.isLeader);
}
