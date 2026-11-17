/**
 * A message held for a paused contact leaves on Resume exactly as it would
 * have left at once: at the chat's security level, with its compression hint.
 *
 * The flush used to call the reliable send with the bytes alone, so a held
 * message went out at the transport's default level whatever the chat had
 * chosen, and would have lost its hint the same way.
 *
 * Real: the service core, its paused outbox and the key format. Stood in: the
 * agent's LocalDB (a Map with its absent-key rejections) and the messenger
 * operations beneath the core, which need a WASM client and a leader tab.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CompressionHint } from 'citadel-workspace-client-ts';
// Through the barrel: importing core.ts first enters its import cycle from the wrong end.
import { WebSocketServiceCore } from '@/lib/websocket-service';
import { pauseKey, PAUSED_MARKER } from '@/lib/p2p-pause/pause-rules';
import { stringToBytes } from '@/lib/utils/encoding-utils';
import type { ChatSecurityLevel } from '@/lib/p2p/chat-advanced-settings';

const LOCAL: bigint = 71n;
const PEER: bigint = 72n;

interface ReliableSend { bytes: number[]; level: ChatSecurityLevel | undefined; hint: CompressionHint | undefined }

function coreOverRecorders(): { core: WebSocketServiceCore; rows: Map<string, number[]>; sends: ReliableSend[] } {
  const rows: Map<string, number[]> = new Map();
  const sends: ReliableSend[] = [];
  const core: WebSocketServiceCore = new WebSocketServiceCore();
  core.sendLocalDBGet = async (_cid: bigint, key: string): Promise<{ value: number[] }> => {
    const value: number[] | undefined = rows.get(key);
    if (value === undefined) throw new Error(`Key not found: ${key}`);
    return { value };
  };
  core.sendLocalDBSet = async (_cid: bigint, key: string, value: number[]): Promise<void> => { rows.set(key, value); };
  core.sendLocalDBDelete = async (_cid: bigint, key: string): Promise<void> => { rows.delete(key); };
  core.sendLocalDBListKeys = async (_cid: bigint, prefix?: string): Promise<string[]> => {
    const keys: string[] = [...rows.keys()].filter((k: string): boolean => k.startsWith(prefix ?? ''));
    if (keys.length === 0) throw new Error(`No keys found with prefix ${prefix ?? ''}`);
    return keys;
  };
  const internals: { modules: { messengerOps: { sendP2PMessageReliable: unknown } } } =
    core as unknown as { modules: { messengerOps: { sendP2PMessageReliable: unknown } } };
  internals.modules.messengerOps.sendP2PMessageReliable = async (
    _local: bigint, _peer: bigint, bytes: Uint8Array, level?: ChatSecurityLevel, hint?: CompressionHint
  ): Promise<void> => { sends.push({ bytes: Array.from(bytes), level, hint }); };
  return { core, rows, sends };
}

describe('a reliable send', () => {
  let core: WebSocketServiceCore;
  let rows: Map<string, number[]>;
  let sends: ReliableSend[];

  beforeEach((): void => { ({ core, rows, sends } = coreOverRecorders()); });

  const pause = (): void => { rows.set(pauseKey(PEER), stringToBytes(PAUSED_MARKER)); };
  const resume = (): void => { rows.delete(pauseKey(PEER)); };

  it('to a contact not paused goes out with its level and hint', async (): Promise<void> => {
    await core.sendP2PMessageReliable(LOCAL, PEER, new Uint8Array([1]), 'High', 'json');
    expect(sends).toEqual([{ bytes: [1], level: 'High', hint: 'json' }]);
  });

  it('held for a paused contact leaves on Resume with the same level and hint', async (): Promise<void> => {
    pause();
    await core.sendP2PMessageReliable(LOCAL, PEER, new Uint8Array([1]), 'Extreme', 'cbor-command');
    await core.sendP2PMessageReliable(LOCAL, PEER, new Uint8Array([2]), 'Reinforced', 'yjs-update');
    expect(sends).toEqual([]);
    resume();
    expect(await core.flushPausedOutbox(LOCAL, PEER)).toBe(2);
    expect(sends).toEqual([
      { bytes: [1], level: 'Extreme', hint: 'cbor-command' },
      { bytes: [2], level: 'Reinforced', hint: 'yjs-update' },
    ]);
  });

  it('held without a level or hint leaves without them, not with a guessed one', async (): Promise<void> => {
    pause();
    await core.sendP2PMessageReliable(LOCAL, PEER, new Uint8Array([3]));
    resume();
    await core.flushPausedOutbox(LOCAL, PEER);
    expect(sends).toEqual([{ bytes: [3], level: undefined, hint: undefined }]);
  });

  it('held before keys carried either still leaves, as it always did', async (): Promise<void> => {
    rows.set(`p2p_paused_outbox_${PEER.toString()}_0000000000001000_7d3c0a52-6f0e-4c1e-9d2a-2b8f5f0c1e11`, [4]);
    await core.flushPausedOutbox(LOCAL, PEER);
    expect(sends).toEqual([{ bytes: [4], level: undefined, hint: undefined }]);
  });

  it('refuses to flush a held key it cannot read, rather than send it at a guessed level', async (): Promise<void> => {
    rows.set(`p2p_paused_outbox_${PEER.toString()}_0000000000001000_7d3c0a52-6f0e-4c1e-9d2a-2b8f5f0c1e11_Bogus_json`, [5]);
    await expect(core.flushPausedOutbox(LOCAL, PEER)).rejects.toThrow(/unreadable held-message key/i);
    expect(sends).toEqual([]);
  });
});
