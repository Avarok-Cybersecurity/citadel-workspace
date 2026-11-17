/**
 * A message to someone who has not accepted your request yet waits; it is not refused.
 *
 * The composer used to be disabled until the two of you were registered (owner, 2026-10-16:
 * "it doesn't let you even send the message ... it's unsavory"). Now the message is written,
 * shown pending, and held in the one held outbox (p2p-pause/outbox.ts) with the reason
 * `'unregistered'`. Durable, because the bubble says it will send when they accept, and a
 * reload in between must not make that untrue.
 *
 * It leaves once registration completes, through the normal send -- the chat's level, the
 * messenger-open retry and the pause's own hold all still apply -- in write order, and once:
 * the flush for a pair runs alone across this browser's tabs, so the second caller finds the
 * outbox already empty. A request that is declined or fails leaves the message held, and the
 * bubble still says so.
 *
 * Nothing here sends a PeerRegister. The connect banner owns that request.
 */
import type { CompressionHint } from 'citadel-workspace-client-ts';
import type { HeldOutbox, ReliableSendOptions } from '@/lib/p2p-pause/outbox';
import { deserializeP2PCommand, P2PCommandType, type P2PCommand, type P2PMessagingLayerPayload } from '@/types/p2p-commands';

export interface RegistrationHoldDeps {
  outbox: Pick<HeldOutbox, 'hold' | 'flush'>;
  isRegistered: (peerCid: bigint) => boolean;
  /** The normal send path for bytes already serialized. */
  send: (localCid: bigint, peerCid: bigint, bytes: Uint8Array, compressionHint: CompressionHint | undefined) => Promise<void>;
  /**
   * Records that a held message has gone. Must not throw: it runs after the send and before the
   * outbox entry is removed, so a throw here would send the same message again on the next flush.
   */
  markSent: (peerCid: bigint, messageId: string) => Promise<void>;
  /** Runs `task` with no other holder of `name` running, in any tab of this browser. */
  exclusive: (name: string, task: () => Promise<number>) => Promise<number>;
}

export async function holdUntilRegistered(
  deps: RegistrationHoldDeps, localCid: bigint, peerCid: bigint, bytes: Uint8Array, compressionHint: CompressionHint | undefined,
): Promise<void> {
  const options: ReliableSendOptions = compressionHint === undefined ? {} : { compressionHint };
  await deps.outbox.hold(localCid, peerCid, bytes, options, 'unregistered');
}

/** The message a held entry carries, read from its own bytes rather than recorded beside them. */
function heldMessageId(bytes: Uint8Array): string | null {
  const command: P2PCommand = deserializeP2PCommand(bytes);
  if (command.type !== P2PCommandType.MessagingLayerCommand) return null;
  return (command.payload as P2PMessagingLayerPayload).message_id;
}

/** How many held messages left; 0 while the peer has not accepted. */
export function flushOnceRegistered(deps: RegistrationHoldDeps, localCid: bigint, peerCid: bigint): Promise<number> {
  if (!deps.isRegistered(peerCid)) return Promise.resolve(0);
  return deps.exclusive(`held-until-registered:${localCid.toString()}:${peerCid.toString()}`, (): Promise<number> =>
    deps.outbox.flush(localCid, peerCid, 'unregistered', async (bytes: Uint8Array, options: ReliableSendOptions): Promise<void> => {
      await deps.send(localCid, peerCid, bytes, options.compressionHint);
      const messageId: string | null = heldMessageId(bytes);
      if (messageId !== null) await deps.markSent(peerCid, messageId);
    }));
}
