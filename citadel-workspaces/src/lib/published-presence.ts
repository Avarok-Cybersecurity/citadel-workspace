/**
 * Members' published Online Status choices, by username, for surfaces that
 * only know a username or a CID -- the peer lists, peer discovery, the chat.
 *
 * Fed from every `Members` / `Member` response, like `member-names.ts`, and
 * merged rather than replaced: a room's roster is a subset of the workspace's.
 * A record without the key has not published a choice, so it is forgotten.
 */

const choices: Map<string, boolean> = new Map();

/** A mapped member: `id` is the account's username. */
export interface PresenceChoiceMember {
  id?: string;
  showsOnlineStatus?: boolean;
}

export function recordPresenceChoices(members: readonly PresenceChoiceMember[]): void {
  for (const { id, showsOnlineStatus } of members) {
    if (!id) continue;
    if (showsOnlineStatus === undefined) choices.delete(id);
    else choices.set(id, showsOnlineStatus);
  }
}

/** The member's published choice; undefined when they have published none. */
export function publishedPresenceChoice(username: string | null | undefined): boolean | undefined {
  return username ? choices.get(username.trim()) : undefined;
}
