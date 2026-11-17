/**
 * Take the user back to the conversation a call lives in.
 *
 * Each home has its own page: a DM is the Messages page, a peer group is its
 * group page, and an office or room is its workspace node with the Chat tab
 * open -- the dock sits above both tabs, but Chat is the conversation the call
 * belongs to. Return used to send every room call to `/groups/<roomId>`, and an
 * office's roomId is its chat channel, so the user got "Group not found" and
 * was bounced to /workspace with the call still running and no way back.
 */
import { getWorkspacePath } from '@/lib/workspace-navigation';
import { rememberTab } from '@/lib/node-tabs/tab-memory';
import type { CallHome, CallParticipant } from '@/lib/call/call-state';

export function openCallHome(
  home: CallHome,
  /** The other side of a 1:1 call; unused for rooms. */
  peer: CallParticipant | undefined,
  /** Router navigate or the guarded one (hooks/use-guarded-navigate); only the path is used. */
  navigate: (to: string) => void,
): void {
  switch (home.kind) {
    case 'node':
      rememberTab(home.nodeId, 'chat');
      navigate(getWorkspacePath({ nodeId: home.nodeId }));
      return;
    case 'group':
      navigate(`/groups/${home.roomId}`);
      return;
    case 'direct':
      // `channel`, which is the param the Messages page reads. This said
      // `peer`, which nothing reads anywhere -- so leaving a 1:1 call's
      // conversation and pressing Return landed on "No conversation selected".
      if (peer) navigate(`/messages?channel=${peer.cid.toString()}`);
      return;
  }
}
