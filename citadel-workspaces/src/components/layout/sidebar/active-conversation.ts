/**
 * Which conversation the sidebar should show as the one you are looking at.
 *
 * The hierarchy tree marks the selected node; the conversation list below it
 * marked nothing. `GroupConversationRow` has carried an `isActive` prop, and
 * the styling to go with it, since it was written -- and its only caller never
 * passed one. `PeerListRow` had no such prop at all. So with several
 * conversations opened over a session, nothing in the sidebar said which one
 * was on screen.
 *
 * The route already knows. A peer conversation is `?showP2P=true&channel=<cid>`
 * on whatever workspace path you are on; a group is `/groups/<id>`. Read here,
 * as a pure function of the location, so the rule can be tested without a
 * router and so the two row types cannot come to disagree about it.
 */

import { buildWorkspacePath, getWorkspacePath, leaveSection } from '@/lib/workspace-navigation';

const GROUPS_PREFIX: '/groups/' = '/groups/';

/** The query parameters a peer conversation lives in. Spelled once. */
const SHOWING: 'showP2P' = 'showP2P';
const CHANNEL: 'channel' = 'channel';
const PEER: 'p2pUser' = 'p2pUser';

export interface ActiveConversation {
  /** The peer whose conversation is open, by CID. */
  peerCid: string | null;
  /** The group whose conversation is open, by id. */
  groupId: string | null;
}

export function activeConversation(pathname: string, search: string): ActiveConversation {
  if (pathname.startsWith(GROUPS_PREFIX)) {
    // Only the id, not whatever is nested under it: `/groups/abc/settings` is
    // still that group's conversation as far as the sidebar is concerned.
    const rest: string = pathname.slice(GROUPS_PREFIX.length);
    const groupId: string = rest.split('/')[0];
    return { peerCid: null, groupId: groupId === '' ? null : groupId };
  }

  const params: URLSearchParams = new URLSearchParams(search);
  // `channel` alone is not enough: it is set on paths that are not showing the
  // P2P view, and highlighting a row for a conversation nobody opened is the
  // same lie as highlighting none.
  if (params.get(SHOWING) !== 'true') return { peerCid: null, groupId: null };
  const channel: string | null = params.get(CHANNEL);
  return { peerCid: channel === '' ? null : channel, groupId: null };
}

/**
 * Where clicking a peer row goes.
 *
 * The inverse of the function above, and beside it deliberately: the reader and
 * the writer have to agree on three parameter names, and they were spelled in
 * two files. One of them changing is a highlight that never matches anything.
 */
export function conversationHref(
  pathname: string,
  search: string,
  peer: { cid: string; username: string },
): string {
  // Only the workspace route renders a peer conversation. Written onto any
  // other path -- a group page, the directory -- these parameters changed the
  // address and opened nothing, so from there the link goes to the workspace,
  // without the other page's parameters, which mean something else there.
  const params: URLSearchParams = new URLSearchParams(pathname === getWorkspacePath() ? search : '');
  // The same failure one level down: Office shows a `section` (the file
  // manager) in place of the workspace view, so a conversation link that kept
  // one changed the address and opened nothing. The file manager's own keys go
  // with it, or they would reopen the last folder the next time it is shown.
  leaveSection(params);
  params.set(SHOWING, 'true');
  params.set(PEER, peer.username);
  params.set(CHANNEL, peer.cid);
  return buildWorkspacePath(params);
}
