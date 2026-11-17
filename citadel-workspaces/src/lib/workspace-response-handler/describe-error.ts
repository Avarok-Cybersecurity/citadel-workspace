/**
 * Rendering a server `WorkspaceError` for a human.
 *
 * Extracted from workspace-handlers.ts to keep that module under the repo's
 * 250-line cap.
 */
/**
 * A server `WorkspaceError` as a sentence a user can act on.
 *
 * The variant arrives either as a bare string ("PermissionDenied") or as a
 * single-key object carrying detail ({ PermissionDenied: "EditMdx required" }).
 * Both are rendered rather than stringified into "[object Object]".
 */
/**
 * Permission denials, as sentences rather than variant names.
 *
 * A refusal used to render as `PermissionDenied: EditTreeStructure required` —
 * the enum name, in a toast, to someone who has never seen the permission
 * matrix. It reads like compiler output and tells them nothing about what to do
 * (which is: ask an administrator). The permission NAMES also differ from the
 * labels the matrix itself shows, so even a user who had seen that screen could
 * not match the two.
 */
type NamedPermission =
  | 'AddUsers'
  | 'RemoveUsers'
  | 'EditTreeStructure'
  | 'EditMdx'
  | 'ViewContent'
  | 'ManageMembers'
  | 'ManagePermissions'
  | 'SendMessages'
  | 'ManageWorkspace';

export const PERMISSION_SENTENCE: Readonly<Record<NamedPermission, string>> = {
  AddUsers:
    'You do not have permission to add members here. An administrator can grant it.',
  RemoveUsers:
    'You do not have permission to remove members here. An administrator can grant it.',
  EditTreeStructure:
    'You do not have permission to add, rename, move or delete offices and rooms here. An administrator can grant it.',
  EditMdx:
    'You do not have permission to edit this document. An administrator can grant it.',
  ViewContent: 'You do not have permission to view this.',
  ManageMembers:
    'You do not have permission to manage members here. An administrator can grant it.',
  ManagePermissions:
    'You do not have permission to change permissions here. An administrator can grant it.',
  SendMessages: 'You do not have permission to post here.',
  ManageWorkspace:
    'You do not have permission to change workspace settings. An administrator can grant it.',
};

/** The permission a `PermissionDenied` detail names, if it names one. */
function permissionFrom(detail: string): NamedPermission | undefined {
  return (Object.keys(PERMISSION_SENTENCE) as NamedPermission[]).find((name) => detail.includes(name));
}

/**
 * The role-ladder refusals from `ensure_may_grant_role` and `ensure_may_act_on`
 * (async_domain_server_ops.rs), which name roles, not a permission: "Admin
 * cannot grant Owner, which is above them", "... which carries authority it does
 * not hold", "... cannot change the role of bob, who is above them".
 */
const ROLE_LADDER_SENTENCE: readonly (readonly [RegExp, string])[] = [
  [/cannot grant .+, which /, 'You cannot give someone a role above your own.'],
  [/cannot .+, who (is above them|holds )/, 'You cannot change the role of someone who outranks you.'],
];

/** "Failed to add member: " and its siblings, which every write handler prepends. */
const HANDLER_PREFIX: RegExp = /^Failed to [^:]+: /;

/**
 * A refusal that arrived as the server's `Error(String)` response, as a
 * sentence. The string form of `describeWorkspaceError`, sharing its table.
 *
 * `add_user_to_domain` answers "Failed to add member: Permission denied:
 * AddUsers is required to manage members" -- a handler prefix, a variant-ish
 * tag and a permission name, none of which the person who pressed Add chose.
 * A refusal that is already a sentence ("No account named 'bob' exists on this
 * workspace") passes through without its prefix.
 */
export function describeRefusal(message: string): string {
  const reason: string = message.replace(HANDLER_PREFIX, '');
  const denied: RegExpMatchArray | null = reason.match(/^Permission denied:\s*(.*)$/s);
  if (!denied) return reason;
  const detail: string = denied[1];
  const permission: NamedPermission | undefined = permissionFrom(detail);
  if (permission) return PERMISSION_SENTENCE[permission];
  const ladder: readonly [RegExp, string] | undefined = ROLE_LADDER_SENTENCE.find(([pattern]) => pattern.test(detail));
  return ladder ? ladder[1] : 'You do not have permission to do that here.';
}

export function describeWorkspaceError(wsError: unknown): string {
  if (typeof wsError === 'string') return wsError;

  if (wsError && typeof wsError === 'object') {
    const [variant, detail] = Object.entries(wsError as Record<string, unknown>)[0] ?? [];

    if (variant === 'PermissionDenied' && typeof detail === 'string') {
      const permission: NamedPermission | undefined = permissionFrom(detail);
      if (permission) return PERMISSION_SENTENCE[permission];
      return 'You do not have permission to do that here.';
    }

    if (variant && typeof detail === 'string' && detail) return `${variant}: ${detail}`;
    if (variant) return String(variant);
  }

  return 'The server rejected the request.';
}
