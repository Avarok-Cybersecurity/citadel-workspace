/**
 * Every thing the app can share, described once: where it opens in the app, what it is called,
 * and who a secure link to it admits unless the creator says otherwise.
 *
 * The hrefs are built by the builders each screen already navigates with (fileManagerHref,
 * selectNodePath, conversationHref), so a shared link and a click inside the app cannot come to
 * disagree about where a thing is. What a target may be is target-rules.ts.
 */
import type { LinkGrant } from 'citadel-workspace-client-ts';
import { fileManagerHref, type FileManagerTarget } from '@/lib/file-manager-location';
import { selectNodePath } from '@/hooks/use-select-node';
import { conversationHref } from '@/components/layout/sidebar/active-conversation';
import { getWorkspacePath } from '@/lib/workspace-navigation';
import { bookingLink } from '@/lib/calendar/booking-link';
import { DIRECTORY_PATH, GROUPS_PATH, type ShareKind } from './target-rules';

export { validateShareTarget, kindOfTarget, SHARE_KIND_NAMES, type ShareKind } from './target-rules';

/** What a share entry point knows about the thing being shared. */
export type ShareSubject =
  /** `peer` is the username of the other half of a peer storage; null for server storage. */
  | { kind: 'file' | 'folder'; location: FileManagerTarget; name: string; peer: string | null }
  | { kind: 'node'; nodeId: string; name: string }
  | { kind: 'peer-chat'; peerUsername: string; peerName: string }
  /** `members` are usernames as this member sees the group now; a secure link freezes them. */
  | { kind: 'group-chat'; groupId: string; name: string; members: readonly string[] }
  | { kind: 'directory'; nodeId: string | null; name: string }
  /** A member's booking page on a node's Calendar tab: `host` is the member's username. */
  | { kind: 'booking-page'; nodeId: string; host: string; nodeName: string };

/** Who is sharing: a peer chat opens, for the peer, their conversation with this person. */
export interface ShareViewer {
  cid: bigint;
  username: string;
}

export interface ShareTarget {
  kind: ShareKind;
  /** A same-origin, in-app path, e.g. `/workspace?nodeId=…`. */
  href: string;
  label: string;
  defaultGrant: LinkGrant;
  /** The node "anyone who can see it" refers to, when the thing is one. */
  nodeId: string | null;
  /** The group whose members a snapshot grant may name, when the thing is a group chat. */
  group: { groupId: string; name: string; members: readonly string[] } | null;
  /** The booking page guests from outside the workspace may be let in to, when the thing is one. */
  booking: { nodeId: string; page: string } | null;
}


function directoryHref(nodeId: string | null): string {
  return nodeId === null ? DIRECTORY_PATH : `${DIRECTORY_PATH}?${new URLSearchParams({ nodeId }).toString()}`;
}

/** Null only for a peer chat while the sharer is not known: its link is written from their side. */
export function shareTarget(subject: ShareSubject, viewer: ShareViewer | null): ShareTarget | null {
  const none: Pick<ShareTarget, 'nodeId' | 'group' | 'booking'> = { nodeId: null, group: null, booking: null };
  switch (subject.kind) {
    case 'file':
    case 'folder':
      return {
        ...none, kind: subject.kind, label: subject.name,
        href: fileManagerHref('', subject.location),
        defaultGrant: subject.peer === null ? 'Workspace' : { Members: [subject.peer] },
      };
    case 'node':
      return {
        ...none, kind: 'node', label: subject.name, nodeId: subject.nodeId,
        href: selectNodePath('', subject.nodeId), defaultGrant: { NodeViewers: subject.nodeId },
      };
    case 'peer-chat':
      if (viewer === null) return null;
      return {
        ...none, kind: 'peer-chat', label: `Chat with ${subject.peerName}`,
        // The reader is the peer, so the conversation they open is the one with the sharer.
        href: conversationHref(getWorkspacePath(), '', { cid: viewer.cid.toString(), username: viewer.username }),
        defaultGrant: { Members: [subject.peerUsername] },
      };
    case 'group-chat': {
      // A member who cannot see the roster has no snapshot to offer: they name people instead.
      const known: boolean = subject.members.length > 0;
      return {
        ...none, kind: 'group-chat', label: subject.name,
        href: `${GROUPS_PATH}${encodeURIComponent(subject.groupId)}`,
        group: known ? { groupId: subject.groupId, name: subject.name, members: subject.members } : null,
        defaultGrant: known ? { GroupSnapshot: { group_id: subject.groupId, members: [...subject.members] } } : { Members: [] },
      };
    }
    case 'directory':
      return { ...none, kind: 'directory', label: subject.name, nodeId: subject.nodeId, href: directoryHref(subject.nodeId), defaultGrant: 'Workspace' };
    case 'booking-page':
      return {
        ...none, kind: 'node', label: `Book ${subject.host} on ${subject.nodeName}`, nodeId: subject.nodeId,
        href: bookingLink('', { node: subject.nodeId, host: subject.host, typeId: null }),
        defaultGrant: { NodeViewers: subject.nodeId }, booking: { nodeId: subject.nodeId, page: subject.host },
      };
  }
}
