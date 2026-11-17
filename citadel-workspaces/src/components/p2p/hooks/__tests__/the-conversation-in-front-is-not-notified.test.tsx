/**
 * A message for the conversation the user is looking at interrupts nobody.
 *
 * Live (Safari, macOS, 2026-10-04): every incoming message raised a system
 * notification while its chat was open and focused. The messenger has held "the
 * conversation this window has open" since it was written, and both notification
 * surfaces read it -- the agent's native notices through ReportFocus, the in-app
 * one through the arrival toast -- but nothing ever set it. So the agent was told
 * "this window shows no conversation" and raised a notice for every message.
 *
 * The chat's own wiring (useP2PMessages) with the real messenger, agent request
 * path and notification service. Stand-ins: the fake agent and `document.hasFocus`
 * (hosting-agent.ts), and the platform's `Notification` constructor.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, type RenderResult } from '@testing-library/react';
import { useRef, type MutableRefObject, type RefObject } from 'react';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { notificationService } from '@/lib/notification-service/service';
import { eventEmitter } from '@/lib/event-emitter';
import { SESSION_CLAIMED } from '@/lib/multi-instance/claim-relay';
import { useP2PMessages } from '../useP2PMessages';
import { installHostingAgent, settle, PEER, OWN, type HostingAgent } from './hosting-agent';
import { peerTransportFor } from '@/components/p2p/__tests__/doubles/peer-transport';
import type { ChatTransport } from '@/lib/chat/transport/chat-transport';

// The OS delivery is a lazy chunk the service loads with the first notification
// (os-delivery.ts). A cold first load can outlast `settle()`, so the one assertion
// on the OS surface failed only when this file ran cold (CI, full runs). The real
// delivery is used; each one the service starts is recorded so the test waits for
// it, however long the chunk takes.
const deliveries: Promise<void>[] = vi.hoisted((): Promise<void>[] => []);
vi.mock('@/lib/notification-service/os-delivery', async (orig: () => Promise<typeof import('@/lib/notification-service/os-delivery')>) => {
  const real: typeof import('@/lib/notification-service/os-delivery') = await orig();
  return {
    ...real,
    lazyOsDelivery: (n: Parameters<typeof real.lazyOsDelivery>[0]): Promise<void> => {
      const delivery: Promise<void> = real.lazyOsDelivery(n);
      deliveries.push(delivery);
      return delivery;
    },
  };
});
const delivered = (): Promise<void[]> => Promise.all(deliveries);
const OTHER: bigint = 88n;
let agent: HostingAgent;
/** One transport per peer for the whole test: a fresh one per render would resubscribe. */
let transports: Map<bigint, ChatTransport>;
const transportFor = (peer: bigint): ChatTransport => {
  const known: ChatTransport | undefined = transports.get(peer);
  if (known) return known;
  const made: ChatTransport = peerTransportFor({ cid: peer, name: `peer ${peer.toString()}` }, OWN);
  transports.set(peer, made);
  return made;
};
const shown: string[] = [];

function Chat({ peer }: { peer: bigint }): JSX.Element {
  const tab: MutableRefObject<string> = useRef<string>('messages');
  const pinnedRef: MutableRefObject<boolean> = useRef<boolean>(true);
  const viewport: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  useP2PMessages({ transport: transportFor(peer), activeTabIdRef: tab, scrollRef: viewport, pinnedRef, onUnreadMessage: (): void => {} });
  return <div ref={viewport} />;
}

async function open(peer: bigint): Promise<RenderResult> {
  const view: RenderResult = render(<ConfirmDialogProvider><Chat peer={peer} /></ConfirmDialogProvider>);
  await settle();
  return view;
}

let seq: bigint = 0n;
let counter: number = 0;
/** The agent's event for a message `from` sent this account. */
async function arrives(from: bigint): Promise<string> {
  seq += 1n; counter += 1;
  const id: string = `in-front-${counter}`;
  act(() => {
    eventEmitter.emit('websocket-message', { ConversationEvent: {
      cid: OWN, peer_cid: from, seq, kind: 'Appended', message_id: null, metadata: null,
      account_username: 'me', peer_username: 'alice', preview: '', request_id: null,
      message: { id, content: 'hello', senderCid: from, recipientCid: OWN, timestamp: counter, index: counter, status: 'delivered', message_type: 'text' },
    } });
  });
  await settle();
  return id;
}

const notified = (id: string): boolean => notificationService.getNotifications().some((n) => n.sourceId === id);

beforeEach(async () => {
  transports = new Map<bigint, ChatTransport>();
  agent = await installHostingAgent();
  agent.setFocused(true);
  shown.length = 0;
  vi.stubGlobal('Notification', class { static permission: NotificationPermission = 'granted'; constructor(title: string) { shown.push(title); } });
  Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'serviceWorker'); });

describe('the agent is told which conversation is in front', () => {
  it('when its chat opens in a focused window', async () => {
    await open(PEER);
    expect(agent.focusReports().at(-1)).toEqual({ session_cid: OWN, peer_cid: PEER, focused: true });
  });

  it('again once the session is claimed on a connection, though nothing in front changed', async () => {
    // A reconnect, a takeover, or a report refused before the claim: the agent keys focus by
    // connection, so until this it raised a notice for the chat on screen.
    await open(PEER);
    const before: number = agent.focusReports().length;
    act(() => { eventEmitter.emit(SESSION_CLAIMED, { cid: OWN }); });
    await settle();
    expect(agent.focusReports().slice(before)).toEqual([{ session_cid: OWN, peer_cid: PEER, focused: true }]);
  });

  it('and that none is, once the chat closes', async () => {
    const view: RenderResult = await open(PEER);
    view.unmount();
    await settle();
    expect(agent.focusReports().at(-1)).toEqual({ session_cid: OWN, peer_cid: null, focused: true });
  });
});

describe('a message arriving', () => {
  it('for the open conversation, in a focused window, raises nothing', async () => {
    await open(PEER);
    expect(notified(await arrives(PEER))).toBe(false);
    expect(shown).toEqual([]);
  });

  it('for another conversation is in the bell, but not the OS: the window is in front', async () => {
    await open(PEER);
    expect(notified(await arrives(OTHER))).toBe(true);
    expect(shown).toEqual([]);
  });

  it('for the open conversation while the window is behind another app reaches the OS', async () => {
    // Hosted, but the agent does not say a notifier is attached, so the browser owns it (owner.ts).
    await open(PEER);
    agent.setFocused(false);
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(notified(await arrives(PEER))).toBe(true);
    await delivered();
    expect(shown).toHaveLength(1);
    expect(agent.focusReports().at(-1)).toEqual({ session_cid: OWN, peer_cid: null, focused: false });
  });
});
