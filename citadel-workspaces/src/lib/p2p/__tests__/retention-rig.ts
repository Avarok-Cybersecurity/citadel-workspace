/**
 * The retention runner's world, shared by the browser-sweeper and agent-sweeper
 * tests: the agent's LocalDB (via `RetentionPageIO`), the clock and the timer
 * as plain data; the settings store is real, over an in-memory port.
 */
import type { RetentionDeps } from '../retention-runner';
import { ChatAdvancedSettingsStore, type ChatAdvancedSettings, type ChatSettingsStorage } from '../chat-advanced-settings';
import type { ConversationMetadata, MessagePage, P2PMessage } from '../p2p-types';

export const OWN: bigint = 1n;
export const BOB: bigint = 2n;
export const CAROL: bigint = 3n;
export const DAY: number = 24 * 60 * 60 * 1000;
export const NOW: number = Date.UTC(2026, 8, 25);

function memory(): ChatSettingsStorage {
  const raw: Map<string, unknown> = new Map();
  return { get: async (k: string): Promise<unknown> => raw.get(k), put: async (k: string, v: ChatAdvancedSettings): Promise<void> => { raw.set(k, v); } };
}

function conversation(peer: bigint, ages: number[]): { meta: ConversationMetadata; page: MessagePage } {
  const messages: P2PMessage[] = ages.map((age: number, i: number) => ({
    id: `${peer}-${i}`, content: '', senderCid: peer, recipientCid: OWN, timestamp: NOW - age * DAY, index: i, status: 'delivered', message_type: 'text',
  }) as P2PMessage);
  const times: number[] = messages.map((m: P2PMessage) => m.timestamp);
  return {
    meta: { peerCid: peer, ownerCid: OWN, totalMessageCount: messages.length, oldestMessageTimestamp: Math.min(...times), newestMessageTimestamp: Math.max(...times), latestPage: 0, messagesPerPage: 50, unreadCount: 0, lastMessageIndex: 0, lastUpdated: 0 },
    page: { peerCid: peer, pageNumber: 0, messages, pageTimestamps: { minTimestamp: Math.min(...times), maxTimestamp: Math.max(...times) } },
  };
}

export interface Rig { deps: RetentionDeps; data: Map<bigint, { meta: ConversationMetadata; page: MessagePage }>; expired: Array<[bigint, number]>; timers: Array<() => void>; store: ChatAdvancedSettingsStore }

export function rig(): Rig {
  const data: Map<bigint, { meta: ConversationMetadata; page: MessagePage }> = new Map([[BOB, conversation(BOB, [10, 1])], [CAROL, conversation(CAROL, [10, 1])]]);
  const expired: Array<[bigint, number]> = [];
  const timers: Array<() => void> = [];
  const store: ChatAdvancedSettingsStore = new ChatAdvancedSettingsStore(memory());
  const deps: RetentionDeps = {
    now: (): number => NOW,
    currentCid: async (): Promise<bigint | null> => OWN,
    settings: store,
    peers: (): bigint[] => [BOB, CAROL],
    lock: <T>(_peer: bigint, op: () => Promise<T>): Promise<T> => op(),
    onExpired: (peer: bigint, cutoff: number): void => { expired.push([peer, cutoff]); },
    every: (_ms: number, tick: () => void): (() => void) => { timers.push(tick); return (): void => {}; },
    // An agent before 0.8.6: this window is the sweeper. See retention-the-agent-keeps.test.ts.
    agent: { hosts: async (): Promise<boolean> => false, tell: async (): Promise<void> => {}, count: async (): Promise<number> => 0 },
    io: {
      loadMetadata: async (peer: bigint): Promise<ConversationMetadata | null> => structuredClone(data.get(peer)?.meta ?? null),
      loadPage: async (peer: bigint): Promise<MessagePage | null> => structuredClone(data.get(peer)?.page ?? null),
      savePage: async (peer: bigint, _n: number, p: MessagePage): Promise<void> => { const d: { meta: ConversationMetadata; page: MessagePage } | undefined = data.get(peer); if (d) d.page = structuredClone(p); },
      saveMetadata: async (peer: bigint, m: ConversationMetadata): Promise<void> => { const d: { meta: ConversationMetadata; page: MessagePage } | undefined = data.get(peer); if (d) d.meta = structuredClone(m); },
    },
  };
  return { deps, data, expired, timers, store };
}

export const count = (r: Rig, peer: bigint): number => r.data.get(peer)?.page.messages.length ?? -1;
