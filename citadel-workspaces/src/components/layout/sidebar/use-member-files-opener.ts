/**
 * "Open their files" on a member: the file manager at the top of the storage you
 * share with them, by address (`peer_id=<their cid>&path=/`).
 *
 * Their CID is resolved the way opening a chat resolves it (member-chat-target.ts):
 * the contact's, else the agent's listing of workspace peers. A member neither
 * knows cannot be addressed yet and is told so; one you are not registered with
 * opens on the file manager's own "not available" screen, which says why.
 */
import { useLocation } from 'react-router-dom';
import { useGuardedNavigate, type GuardedNavigate } from '@/hooks/use-guarded-navigate';
import type { RegisteredPeer } from '@/hooks/use-registered-peers';
import { refreshWorkspacePeers, workspacePeerNamed } from '@/lib/workspace-peers';
import { fileManagerHref } from '@/lib/file-manager-location';
import { toast } from '@/hooks/use-toast';
import type { User as WorkspaceMember } from '@/types/workspace-entities';
import { resolveMemberChat, type MemberChatTarget } from './member-chat-target';

/** Null for yourself: there is no storage shared with yourself. */
export type MemberFilesOpener = (member: WorkspaceMember) => (() => void) | null;

export function useMemberFilesOpener(currentUsername: string | undefined, contacts: readonly RegisteredPeer[]): MemberFilesOpener {
  const location: ReturnType<typeof useLocation> = useLocation();
  const navigate: GuardedNavigate = useGuardedNavigate();
  return (member: WorkspaceMember): (() => void) | null => {
    if (member.username === currentUsername) return null;
    return (): void => {
      void resolveMemberChat(member.username, currentUsername, contacts,
        (username: string): bigint | undefined => workspacePeerNamed(username)?.cid, refreshWorkspacePeers,
      ).then(async (target: MemberChatTarget): Promise<void> => {
        if (target?.kind === 'conversation') {
          await navigate(fileManagerHref(location.search, { storage: { kind: 'peer', cid: target.cid }, path: '/', item: null, via: null }));
        } else if (target?.kind === 'unreachable') {
          toast({ title: 'Cannot open their files', description: `${member.displayName || member.username} is not reachable yet. They need to be online at least once before the storage you share can be opened.`, variant: 'destructive' });
        }
      });
    };
  };
}
