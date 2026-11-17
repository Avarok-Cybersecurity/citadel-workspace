/**
 * A node nobody has told us about is not a room without chat.
 *
 * `BaseOffice` read `entityData?.chat_enabled ?? false`, where `entityData` is
 * `state.nodes[nodeId]`. A node absent from that map — not loaded yet, or
 * momentarily gone while the list reloads — became "chat disabled", and the
 * whole Content/Chat tab surface disappeared with the composer inside it.
 * Four integration jobs report exactly that: "WARNING: Message input not found".
 *
 * Three answers, not two: enabled, disabled, and not yet told. A room that HAS
 * answered keeps its answer while the node reloads underneath it; a room that
 * answers `chat_enabled: false` is honoured at once, because that is a fact.
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { chatSurfaceOf, useChatSurface, type ChatSurface } from '../chat-surface';
import type { DomainNode } from '@/components/layout/sidebar/TreeNodesSection';

const withChat: DomainNode = { chat_enabled: true, chat_channel_id: 'ch-1' } as unknown as DomainNode;
const withoutChat: DomainNode = { chat_enabled: false, chat_channel_id: null } as unknown as DomainNode;

describe('what a node says about chat', () => {
  it('answers null for a node we do not have', () => {
    expect(chatSurfaceOf(undefined)).toBeNull();
    expect(chatSurfaceOf(null)).toBeNull();
  });

  it('reports what a loaded node says', () => {
    // The positive control: a version returning null for everything would
    // satisfy the test above and hide chat in every room.
    expect(chatSurfaceOf(withChat)).toEqual({ enabled: true, channelId: 'ch-1' });
    expect(chatSurfaceOf(withoutChat)).toEqual({ enabled: false, channelId: null });
  });
});

describe('the remembered chat surface', () => {
  it('keeps chat while the node reloads underneath it', () => {
    const { result, rerender } = renderHook(
      ({ entity }: { entity: DomainNode | null }) => useChatSurface('n1', entity),
      { initialProps: { entity: withChat as DomainNode | null } },
    );
    expect(result.current).toEqual({ enabled: true, channelId: 'ch-1' });

    // What `state.nodes[nodeId]` does mid-reload.
    rerender({ entity: null });
    expect(result.current).toEqual({ enabled: true, channelId: 'ch-1' });
  });

  it('honours a room that really has no chat', () => {
    const { result } = renderHook(() => useChatSurface('n1', withoutChat));
    expect(result.current).toEqual({ enabled: false, channelId: null });
  });

  it('does not lend one room a memory of another', () => {
    const { result, rerender } = renderHook(
      ({ nodeId, entity }: { nodeId: string; entity: DomainNode | null }) => useChatSurface(nodeId, entity),
      { initialProps: { nodeId: 'n1', entity: withChat as DomainNode | null } },
    );
    expect(result.current).toEqual({ enabled: true, channelId: 'ch-1' });

    // A different room, not loaded yet: it has said nothing, and inheriting
    // n1's channel would point its chat at the wrong conversation.
    rerender({ nodeId: 'n2', entity: null });
    expect(result.current).toBeNull();
  });

  it('starts out not knowing', () => {
    const { result } = renderHook(() => useChatSurface('n1', null));
    const surface: ChatSurface | null = result.current;
    expect(surface).toBeNull();
  });
});
