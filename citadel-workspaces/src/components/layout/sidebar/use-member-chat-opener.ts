/**
 * What clicking a member does, wherever the member is listed: open the chat with them.
 *
 * Every other member opens the chat, contact or not (member-chat-target.ts), resolved at click
 * time against the listing as it is then; an unaddressable member is told so. One rule for the
 * sidebar list and the "all members" dialog, which had only the sidebar's.
 */
import { useOpenConversation } from './use-open-conversation';
import type { RegisteredPeer } from '@/hooks/use-registered-peers';
import { refreshWorkspacePeers, workspacePeerNamed } from '@/lib/workspace-peers';
import { resolveMemberChat, type MemberChatTarget } from './member-chat-target';
import { toast } from '@/hooks/use-toast';
import { unreachableMemberCopy } from '@/pages/reachable-peer';
import type { User as WorkspaceMember } from '@/types/workspace-entities';

/** Null for yourself: there is no chat with yourself to open. */
export type MemberChatOpener = (member: WorkspaceMember) => (() => void) | null;

export function useMemberChatOpener(currentUsername: string | undefined, contacts: readonly RegisteredPeer[]): MemberChatOpener {
  const openConversation: (cid: string, username: string) => Promise<void> = useOpenConversation();
  return (member: WorkspaceMember): (() => void) | null => {
    if (member.username === currentUsername) return null;
    return (): void => {
      void resolveMemberChat(member.username, currentUsername, contacts,
        (username: string): bigint | undefined => workspacePeerNamed(username)?.cid, refreshWorkspacePeers,
      ).then(async (target: MemberChatTarget): Promise<void> => {
        if (target?.kind === 'conversation') await openConversation(target.cid.toString(), member.username);
        else if (target?.kind === 'unreachable') {
          toast({ title: 'Cannot open that conversation', description: unreachableMemberCopy(member.displayName || member.username), variant: 'destructive' });
        }
      });
    };
  };
}
