/**
 * Open the conversation with a contact from the sidebar -- one path for every
 * row that can start a chat: the contact rows and a node's member rows.
 *
 * The workspace view renders P2P chat instead of the editor, so this unmounts
 * the buffer as completely as selecting another node does: it goes through the
 * guarded navigation, which asks before discarding an unsaved edit.
 */
import { useLocation } from 'react-router-dom';
import { useGuardedNavigate, type GuardedNavigate } from '@/hooks/use-guarded-navigate';
import { conversationHref } from './active-conversation';

export function useOpenConversation(): (cid: string, username: string) => Promise<void> {
  const location: ReturnType<typeof useLocation> = useLocation();
  const navigate: GuardedNavigate = useGuardedNavigate();
  return (cid: string, username: string): Promise<void> =>
    navigate(conversationHref(location.pathname, location.search, { cid, username }));
}
