/**
 * What clicking a member does, wherever the member is listed: open the chat with them.
 *
 * Every other member opens the chat, contact or not (member-chat-target.ts), resolved at click
 * time against the listing as it is then; an unaddressable member is told so. Your own row opens
 * your scratchpad: the same chat, addressed by your own cid (lib/scratchpad). One rule for the
 * sidebar list and the "all members" dialog, which had only the sidebar's.
 */
import { useOpenConversation } from './use-open-conversation';
import type { RegisteredPeer } from '@/hooks/use-registered-peers';
import { refreshWorkspacePeers, workspacePeerNamed } from '@/lib/workspace-peers';
import { resolveMemberChat, type MemberChatTarget } from './member-chat-target';
import { toast } from '@/hooks/use-toast';
import { unreachableMemberCopy } from '@/pages/reachable-peer';
import { useTabIdentity } from '@/hooks/use-tab-identity';
import { selfCid, type TabIdentity } from '@/lib/tab-identity';
import { connectionManager } from '@/lib/connection';
import type { WorkspaceMember } from '@/types/workspace-entities';

/** Null where the row opens nothing; every row opens something now, your own included. */
export type MemberChatOpener = (member: WorkspaceMember) => (() => void) | null;

export function useMemberChatOpener(currentUsername: string | undefined, contacts: readonly RegisteredPeer[]): MemberChatOpener {
  const openConversation: (cid: string, username: string) => Promise<void> = useOpenConversation();
  const me: TabIdentity | null = useTabIdentity();
  return (member: WorkspaceMember): (() => void) | null => (): void => {
    void resolveMemberChat(member.username, currentUsername, contacts,
      (username: string): bigint | undefined => workspacePeerNamed(username)?.cid, refreshWorkspacePeers,
    ).then(async (target: MemberChatTarget): Promise<void> => {
      if (target?.kind === 'conversation') await openConversation(target.cid.toString(), member.username);
      else if (target?.kind === 'scratchpad') {
        // The tab's identity first, the connection's second, as the workspace view reads it.
        const own: bigint | undefined = selfCid(me, connectionManager.getConnectionInfo());
        if (own === undefined) toast({ title: 'Cannot open your scratchpad', description: 'This tab is not signed in yet.', variant: 'destructive' });
        else await openConversation(own.toString(), member.username);
      } else if (target?.kind === 'unreachable') {
        toast({ title: 'Cannot open that conversation', description: unreachableMemberCopy(member.displayName || member.username), variant: 'destructive' });
      }
    });
  };
}
