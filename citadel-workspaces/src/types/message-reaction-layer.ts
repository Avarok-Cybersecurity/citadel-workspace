/**
 * The P2P wire form of a reaction change: one MessagingLayer variant, sent the
 * way MessageEdit and MessageDelete are (in-band, over the reliable path).
 *
 * Kept out of messaging-layer.ts, which is already past the size limit; that
 * file only names the variant in its enum and union.
 *
 * `message_id` names the message reacted to. No reactor field: who reacted is
 * whoever the transport says sent this, so a peer cannot react -- or un-react --
 * as anyone else.
 *
 * An older client has no case for this type and drops it in
 * `handleMessagingLayerCommand`'s default arm; nothing is rendered.
 */
import type { MessagingLayerType } from './messaging-layer';

export interface MessageReactionLayer {
  type: MessagingLayerType.MessageReaction;
  message_id: string;
  emoji: string;
  /** True adds the reaction, false retracts it. */
  active: boolean;
  /** The reactor's clock; the receiver keeps the latest per emoji. */
  reacted_at: number;
}

/** The fields of a reaction layer, or null when any is missing or mistyped. */
export function readReactionLayer(layer: Record<string, unknown>): Omit<MessageReactionLayer, 'type'> | null {
  if (typeof layer.message_id !== 'string' || typeof layer.emoji !== 'string') return null;
  if (typeof layer.active !== 'boolean' || typeof layer.reacted_at !== 'number') return null;
  return { message_id: layer.message_id, emoji: layer.emoji, active: layer.active, reacted_at: layer.reacted_at };
}
