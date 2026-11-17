import { useSyncExternalStore } from 'react';
import { IncomingCallCard } from './IncomingCallCard';
import { useCall } from '@/lib/call/call-context';
import { useRosterName } from './use-roster-name';
import { callRoomId, type CallParticipant } from '@/lib/call/call-state';
import { getChannelNames, roomNameFor, subscribeToChannelNames } from '@/lib/call/room-names';
import { getGroups, subscribeToGroups } from '@/lib/group-conversations/group-store';
import type { GroupConversation } from '@/types/group';

/**
 * The ringing card, rendered wherever the user is.
 *
 * Separate from CallLayer so it can consume the context CallLayer provides —
 * a component cannot read a provider it is itself rendering.
 */
export function RingingCall(): JSX.Element | null {
  const { call, accept, decline } = useCall();
  // Rings in the tab the invite was routed to: the one whose session is called
  // (routed by cid), leader or not. Answering there keeps the media there.
  const caller: CallParticipant | undefined = call ? [...call.participants.values()][0] : undefined;
  // Named as the sidebar names them, not as the signal froze them. See use-roster-name.
  const callerName: string = useRosterName(caller?.cid ?? null, caller?.username ?? '');
  const channels: ReadonlyMap<string, string> = useSyncExternalStore(subscribeToChannelNames, getChannelNames);
  const groups: GroupConversation[] = useSyncExternalStore(subscribeToGroups, getGroups);

  if (!call || call.status !== 'ringing-in') return null;
  if (!caller) return null;
  const roomId: string | null = callRoomId(call.home);

  return (
    <IncomingCallCard
      callerName={callerName}
      callerUsername={caller.username}
      media={caller.media}
      roomName={roomId ? roomNameFor(roomId, channels, groups) : null}
      onAccept={(media) => void accept(media)}
      onDecline={() => void decline()}
    />
  );
}
