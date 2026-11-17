/**
 * A ringing group call names its room as the receiver knows it, never by id.
 *
 * Live, two Macs, 2026-09-28: an office call rang as "Incoming video call in
 * 03347dcf-54be-4ef6-ad99-3cff1ced04a3" -- CallLayer passed the signal's
 * room_id (the office's chat channel) straight in as the room's name.
 *
 * Real: RingingCall, IncomingCallCard, the channel-name store fed the way
 * WorkspaceEventHandler feeds it, and the group store. Nothing mocked.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, renderHook, screen, cleanup } from '@testing-library/react';
import { CallContext, useCall, type CallContextValue } from '@/lib/call/call-context';
import { callHomeOf, publishChannelNames } from '@/lib/call/room-names';
import { updateGroups } from '@/lib/group-conversations/group-store';
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';
import type { GroupConversation } from '@/types/group';
import type { CallState } from '@/lib/call/call-state';

const { RingingCall } = await import('../RingingCall');
const DEFAULTS: CallContextValue = renderHook((): CallContextValue => useCall()).result.current;
const CHANNEL: string = '03347dcf-54be-4ef6-ad99-3cff1ced04a3';

function ringing(roomId: string | null): CallState {
  return {
    callId: 'c1', status: 'ringing-in', home: callHomeOf(roomId, new Map<string, string>()), outgoing: false, caller: 7n,
    selfMedia: { audio: true, video: true }, selfSpeaking: false, reason: null,
    participants: new Map([[7n, { cid: 7n, username: 'johndoesky', status: 'invited', media: { audio: true, video: true }, speaking: false }]]),
  } as CallState;
}

function ring(roomId: string | null): string {
  render(
    <CallContext.Provider value={{ ...DEFAULTS, call: ringing(roomId) }}>
      <RingingCall />
    </CallContext.Provider>,
  );
  return screen.getByTestId('incoming-call-card').textContent ?? '';
}

describe('a ringing group call', () => {
  beforeEach(() => {
    cleanup();
    publishChannelNames({});
    updateGroups((): GroupConversation[] => []);
  });

  it('names an office by the node that owns the channel', () => {
    publishChannelNames({ n1: { id: 'n1', name: 'Two-Mac office', chat_channel_id: CHANNEL } as DomainNode });
    expect(screen.queryByTestId('incoming-call-kind')).toBeNull();
    const text: string = ring(CHANNEL);
    expect(screen.getByTestId('incoming-call-kind').textContent).toBe('Incoming video call in Two-Mac office');
    expect(text).not.toContain(CHANNEL);
  });

  it('names a peer group by its name', () => {
    updateGroups((): GroupConversation[] => [{ id: 'grp-1', name: 'Friends' } as GroupConversation]);
    ring('grp-1');
    expect(screen.getByTestId('incoming-call-kind').textContent).toBe('Incoming video call in Friends');
  });

  it('says nothing about a room it cannot name, and never prints the id', () => {
    const text: string = ring(CHANNEL);
    expect(screen.getByTestId('incoming-call-kind').textContent).toBe('Incoming video call');
    expect(text).not.toContain(CHANNEL);
  });

  it('is a plain incoming call for a 1:1 call', () => {
    ring(null);
    expect(screen.getByTestId('incoming-call-kind').textContent).toBe('Incoming video call');
  });
});
