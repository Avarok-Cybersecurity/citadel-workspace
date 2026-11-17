/**
 * Whether this office or room has chat, and which channel — remembered across
 * a reload of the node it came from.
 *
 * `BaseOffice` read it as `entityData?.chat_enabled ?? false`, where
 * `entityData` is `state.nodes[nodeId]`. A node that is not in that map yet, or
 * momentarily out of it while the list reloads, is not a room without chat: it
 * is a room nobody has told us about. Rendered as the former, the whole
 * Content/Chat tab surface disappears — and with it the composer, mid-
 * conversation. Four integration jobs report that as
 * "WARNING: Message input not found".
 *
 * So: `null` means "not told yet", and a room that HAS answered keeps its
 * answer while the node reloads underneath it. A room that answers
 * `chat_enabled: false` is honoured immediately — that is a fact, not an
 * absence.
 *
 * Keyed by node, so moving to a different room forgets rather than inheriting.
 */
import { useRef } from 'react';
import type React from 'react';
import type { DomainNode } from '@/components/layout/sidebar/TreeNodesSection';

export interface ChatSurface {
  enabled: boolean;
  channelId: string | null;
}

/** What a loaded node says about chat. `null` for a node we do not have. */
export function chatSurfaceOf(entity: DomainNode | null | undefined): ChatSurface | null {
  if (!entity) return null;
  return {
    enabled: entity.chat_enabled ?? false,
    channelId: entity.chat_channel_id ?? null,
  };
}

/**
 * The node's chat surface, or the last one it gave, while it is being reloaded.
 *
 * A ref rather than state: this changes only when the node does, and re-
 * rendering on a value that is by definition unchanged would be noise.
 */
export function useChatSurface(
  nodeId: string | undefined,
  entity: DomainNode | null | undefined,
): ChatSurface | null {
  const remembered: React.MutableRefObject<{ nodeId: string | undefined; surface: ChatSurface } | null> =
    useRef<{ nodeId: string | undefined; surface: ChatSurface } | null>(null);

  const current: ChatSurface | null = chatSurfaceOf(entity);
  if (current) {
    remembered.current = { nodeId, surface: current };
    return current;
  }

  if (remembered.current && remembered.current.nodeId === nodeId) {
    return remembered.current.surface;
  }
  return null;
}
