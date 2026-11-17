/**
 * What to call the list of people in the sidebar.
 *
 * It called itself three different things depending on state the user cannot
 * see: "Workspace Members", "Connected Peers", or "<Entity> Members". The list
 * beneath it did not change — only the word did — so the same people were
 * "members" one moment and "peers" the next, and a first-time user was left to
 * work out whether those are two kinds of person.
 *
 * They are not. A person in this workspace is a MEMBER; "connected" describes
 * the relationship you have with them, not what they are. One noun, and the
 * heading now varies only when it is genuinely scoped to an office or room.
 */

interface LabelInput {
  /** The entity label of the node in view, if any — "Office", "Room". */
  entityLabel?: string;
}

export function membersSectionLabel({ entityLabel }: LabelInput): string {
  return entityLabel ? `${entityLabel} Members` : 'Members';
}
