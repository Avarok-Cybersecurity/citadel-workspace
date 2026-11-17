/**
 * A TURN password crosses the whole UI path — inbound workspace notification,
 * the response handler, the relay cache, the PeerConnect request — without
 * appearing in any console call or being written to web storage.
 *
 * Debug logging is ON under vitest (import.meta.env.DEV), which is what makes
 * this meaningful: the response handler logs every workspace response it
 * processes, and before redaction that log line printed the grant whole.
 *
 * The two transports are the only fakes: the workspace answer is injected as
 * the inbound `websocket-message` the agent would deliver, and the agent socket
 * captures the PeerConnect and answers it.
 */
import { describe, it, expect, vi, afterEach, type MockInstance } from 'vitest';
import { inspect } from 'node:util';
import { eventEmitter } from '@/lib/event-emitter';
import { debugEnabled } from '@/lib/debug-config';
import { stringToBytes } from '@/lib/utils/encoding-utils';
import { WorkspaceResponseHandler } from '@/lib/workspace-response-handler/service';
import { P2POperations } from '@/lib/websocket/p2p-operations';
import { createWorkspaceTurnSource, lazyTurnSource } from '..';

const SECRET: string = 'hunter2-turn-password-5f1c';
const OURS: bigint = 3001n;
const PEER: bigint = 3002n;
const METHODS: ReadonlyArray<'log' | 'info' | 'warn' | 'error' | 'debug'> = ['log', 'info', 'warn', 'error', 'debug'];

function workspaceAnswer(cid: bigint): Record<string, unknown> {
  const response: Record<string, unknown> = {
    IceServers: {
      ice_servers: [{ urls: ['turns:turn.example:443'], username: 'member', credential: SECRET }],
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    },
  };
  return { MessageNotification: { cid, peer_cid: 0n, message: stringToBytes(JSON.stringify({ Response: response })) } };
}

/**
 * Every byte array a log argument holds, decoded. A logged envelope prints its
 * payload as numbers, which `inspect` renders as digits: the secret would be in
 * the console and invisible to a plain string search.
 */
function decodedByteArrays(value: unknown, seen: Set<unknown> = new Set<unknown>()): string[] {
  if (value === null || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value) && value.length > 0 && value.every((b: unknown): boolean => typeof b === 'number')) {
    return [String.fromCharCode(...(value as number[]))];
  }
  return Object.values(value).flatMap((v: unknown): string[] => decodedByteArrays(v, seen));
}

afterEach((): void => { vi.restoreAllMocks(); });

describe('the relay credential', () => {
  it('reaches the PeerConnect and nothing else', async () => {
    expect(debugEnabled).toBe(true);
    const spies: Array<MockInstance<(...args: unknown[]) => void>> = METHODS.map((m) =>
      vi.spyOn(console, m).mockImplementation((): void => {}),
    );
    const stored: MockInstance<(key: string, value: string) => void> = vi.spyOn(Storage.prototype, 'setItem');
    WorkspaceResponseHandler.getInstance();

    const sent: Array<Record<string, Record<string, unknown>>> = [];
    const ops: P2POperations = new P2POperations({
      init: async (): Promise<void> => {},
      isLeader: (): boolean => true,
      sendMessage: async (message: unknown): Promise<void> => {
        const body: Record<string, Record<string, unknown>> = message as Record<string, Record<string, unknown>>;
        sent.push(body);
        const req: Record<string, unknown> | undefined = body.PeerConnect;
        if (req) queueMicrotask((): void => {
          eventEmitter.emit('websocket-message', { PeerConnectSuccess: { cid: req.cid, peer_cid: req.peer_cid, request_id: req.request_id, path: 'turn' } });
        });
      },
      // Wired as module-init wires it, minus the dynamic import.
      turnFor: lazyTurnSource(async () => createWorkspaceTurnSource({
        send: async (cid: bigint): Promise<void> => {
          queueMicrotask((): void => { eventEmitter.emit('websocket-message', workspaceAnswer(cid)); });
        },
        timeoutMs: 1000,
      })),
      // Not what this test is about: every chat at the default level.
      securityFor: async (): Promise<'Standard'> => 'Standard',
    });

    await ops.openP2PConnection(OURS, PEER);

    // It did flow: the request carries it, so the absence below is not vacuous.
    expect(inspect(sent[0]?.PeerConnect?.turn, { depth: 6 })).toContain(SECRET);

    const printed: string = spies
      .flatMap((spy) => spy.mock.calls)
      .map((args: unknown[]): string =>
        [inspect(args, { depth: 12, maxStringLength: Infinity }), ...decodedByteArrays(args)].join('\n'))
      .join('\n');
    // And the handler did log this response — redacted.
    expect(printed).toContain('Processing workspace response');
    expect(printed).toContain('<redacted>');
    expect(printed).not.toContain(SECRET);
    expect(stored.mock.calls.flat().join('\n')).not.toContain(SECRET);
  });
});
