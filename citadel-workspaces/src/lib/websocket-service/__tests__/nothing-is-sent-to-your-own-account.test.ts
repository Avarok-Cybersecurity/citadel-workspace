/**
 * The scratchpad has no peer (lib/scratchpad): every road from this window to a peer refuses
 * the account's own cid before anything reaches the agent, and still lets a real peer through.
 *
 * Real: the service core and its paused outbox. Stood in: the agent's LocalDB (a Map with its
 * absent-key rejection) and the p2p/messenger operations beneath the core, which need a WASM
 * client and a leader tab; they record what would have left.
 */
import { describe, it, expect, beforeEach } from 'vitest';
// Through the barrel: importing core.ts first enters its import cycle from the wrong end.
import { WebSocketServiceCore } from '@/lib/websocket-service';

const ME: bigint = 81n;
const BOB: bigint = 82n;

type Recorder = (...args: unknown[]) => Promise<void>;
interface Ops { p2pOps: Record<string, Recorder>; messengerOps: Record<string, Recorder> }

function coreOverRecorders(): { core: WebSocketServiceCore; left: string[] } {
  const left: string[] = [];
  const core: WebSocketServiceCore = new WebSocketServiceCore();
  core.sendLocalDBGet = async (_cid: bigint, key: string): Promise<{ value: number[] }> => { throw new Error(`Key not found: ${key}`); };
  const ops: Ops = (core as unknown as { modules: Ops }).modules;
  const record = (name: string): Recorder => async (): Promise<void> => { left.push(name); };
  for (const name of ['sendP2PMessage', 'sendP2PMessageBytes', 'openP2PConnection']) ops.p2pOps[name] = record(name);
  ops.messengerOps.sendP2PMessageReliable = record('sendP2PMessageReliable');
  return { core, left };
}

const roads = (core: WebSocketServiceCore, to: bigint): Array<[string, () => Promise<void>]> => [
  ['sendP2PMessage', (): Promise<void> => core.sendP2PMessage(ME, to, 'note')],
  ['sendP2PMessageBytes', (): Promise<void> => core.sendP2PMessageBytes(ME, to, new Uint8Array([1]), 'background')],
  ['openP2PConnection', (): Promise<void> => core.openP2PConnection(ME, to)],
  ['sendP2PMessageReliable', (): Promise<void> => core.sendP2PMessageReliable(ME, to, new Uint8Array([1]))],
];

describe('a send addressed to your own account', () => {
  let core: WebSocketServiceCore;
  let left: string[];
  beforeEach((): void => { ({ core, left } = coreOverRecorders()); });

  it('is refused on every road, and nothing leaves', async (): Promise<void> => {
    for (const [name, go] of roads(core, ME)) {
      await expect(go(), name).rejects.toThrow('a conversation with yourself has no peer');
    }
    expect(left).toEqual([]);
  });

  it('leaves for someone else on every road', async (): Promise<void> => {
    for (const [, go] of roads(core, BOB)) await go();
    expect(left).toEqual(['sendP2PMessage', 'sendP2PMessageBytes', 'openP2PConnection', 'sendP2PMessageReliable']);
  });
});
