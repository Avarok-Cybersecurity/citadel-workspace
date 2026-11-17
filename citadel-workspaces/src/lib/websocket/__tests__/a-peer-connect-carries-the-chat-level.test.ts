/**
 * PeerConnect asks for the level the chat chose, and a refusal is sent as one.
 *
 * `openP2PConnection` built `session_security_settings` from the defaults for
 * every peer, so no per-chat choice could reach the agent. Only the agent
 * socket (`sendMessage`) is faked; the request builder is production code.
 */
import { describe, it, expect } from 'vitest';
import { P2POperations } from '../p2p-operations';
import { eventEmitter } from '@/lib/event-emitter';
import type { ChatSecurityLevel } from '@/lib/p2p/chat-advanced-settings';

const OURS: bigint = 8001n;
const PEER: bigint = 8002n;

type Sent = Record<string, Record<string, unknown>>;

function rig(levelFor: (cid: bigint, peer: bigint) => ChatSecurityLevel): { ops: P2POperations; sent: Sent[]; asked: Array<[bigint, bigint]> } {
  const sent: Sent[] = [];
  const asked: Array<[bigint, bigint]> = [];
  const ops: P2POperations = new P2POperations({
    init: async (): Promise<void> => {},
    sendMessage: async (message: unknown): Promise<void> => {
      const body: Sent = message as Sent;
      sent.push(body);
      const req: Record<string, unknown> | undefined = body.PeerConnect;
      if (req) {
        queueMicrotask((): void => { eventEmitter.emit('websocket-message', { PeerConnectSuccess: { request_id: req.request_id } }); });
      }
      const answer: Record<string, unknown> | undefined = body.PeerConnectAccept;
      if (answer) {
        queueMicrotask((): void => {
          eventEmitter.emit('websocket-message', { PeerConnectAcceptSuccess: { request_id: answer.request_id, accept: answer.accept } });
        });
      }
    },
    isLeader: (): boolean => true,
    turnFor: async (): Promise<null> => null,
    securityFor: async (cid: bigint, peer: bigint): Promise<ChatSecurityLevel> => { asked.push([cid, peer]); return levelFor(cid, peer); },
  });
  return { ops, sent, asked };
}

function settingsOf(sent: Sent[]): Record<string, unknown> {
  const body: Record<string, unknown> | undefined = sent.find((s: Sent): boolean => 'PeerConnect' in s)?.PeerConnect;
  if (!body) throw new Error('no PeerConnect was sent');
  return body.session_security_settings as Record<string, unknown>;
}

describe('the level a PeerConnect asks for', () => {
  it('is the chat level for the pair being connected', async () => {
    const r: ReturnType<typeof rig> = rig((): ChatSecurityLevel => 'High');
    await r.ops.openP2PConnection(OURS, PEER);
    expect(r.asked).toEqual([[OURS, PEER]]);
    expect(settingsOf(r.sent).security_level).toBe('High');
    // Everything else about the session is unchanged.
    expect(settingsOf(r.sent).secrecy_mode).toBe('BestEffort');
  });

  it('is Standard for a chat that chose nothing', async () => {
    const r: ReturnType<typeof rig> = rig((): ChatSecurityLevel => 'Standard');
    await r.ops.openP2PConnection(OURS, PEER);
    expect(settingsOf(r.sent).security_level).toBe('Standard');
  });
});

describe('declining an offered connection', () => {
  it('answers with accept: false and resolves', async () => {
    const r: ReturnType<typeof rig> = rig((): ChatSecurityLevel => 'Standard');
    await r.ops.declinePeerConnect(OURS, PEER, null);
    const body: Record<string, unknown> | undefined = r.sent.find((s: Sent): boolean => 'PeerConnectAccept' in s)?.PeerConnectAccept;
    expect(body?.accept).toBe(false);
    expect(body?.peer_cid).toBe(PEER);
  });

  it('is not what an accept sends', async () => {
    // Positive control for the assertion above.
    const r: ReturnType<typeof rig> = rig((): ChatSecurityLevel => 'Standard');
    await r.ops.acceptPeerConnect(OURS, PEER, null);
    const body: Record<string, unknown> | undefined = r.sent.find((s: Sent): boolean => 'PeerConnectAccept' in s)?.PeerConnectAccept;
    expect(body?.accept).toBe(true);
  });
});
