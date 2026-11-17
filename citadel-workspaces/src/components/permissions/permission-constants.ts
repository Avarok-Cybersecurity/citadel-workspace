/**
 * UI presentation for the permission model.
 *
 * The model itself is not defined here. `Permission`, `PERMISSION_LABELS` and
 * `PERMISSION_CATEGORIES` live in `lib/permissions-service/types.ts`, which mirrors the Rust enum in
 * citadel-workspace-types. This file adds the one thing that is genuinely
 * UI-only — a sentence of explanatory copy per permission — and reshapes the
 * canonical categories into what the permission matrix renders.
 *
 * It used to hold a second, hand-written copy of both the category list and the
 * role defaults, and both had drifted: the categories covered 16 of the 27
 * permissions, so the matrix could not grant the rest at all, and the defaults
 * offered Member `EditContent`, which the server refuses. An administrator was
 * shown a role that did not exist. scripts/check-permission-parity.mjs now fails
 * the build if the mirror and the Rust enum disagree.
 *
 * What each ROLE grants is not here either, nor anywhere in the UI: roles are an
 * editable table the server holds, read live (lib/workspace-roles).
 */
import {
  Permission,
  PERMISSION_LABELS,
  PERMISSION_CATEGORIES as CANONICAL_CATEGORIES,
} from '@/lib/permissions-service/types';

/** Permission definition for UI display. */
export interface PermissionDefinition {
  id: Permission;
  label: string;
  description: string;
}

/** What each permission lets someone do, in a sentence. */
const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  [Permission.All]: 'Every permission, including any added later',
  [Permission.ViewContent]: 'Can view content in this domain',
  [Permission.ViewMembers]: 'Can see everyone else who has access here, including people who reach it through a level above',
  [Permission.EditContent]: 'Can modify content',
  [Permission.EditMdx]: 'Can edit MDX documents',
  [Permission.ShareSecureLinks]: 'Can make links that hide where they point and open only for the people chosen',
  [Permission.SendMessages]: 'Can send messages',
  [Permission.ReadMessages]: 'Can read messages',
  [Permission.UploadFiles]: 'Can upload files',
  [Permission.DownloadFiles]: 'Can download files',
  [Permission.CreateNode]: 'Can create new nodes',
  [Permission.DeleteNode]: 'Can delete nodes',
  [Permission.UpdateNode]: 'Can update node settings',
  [Permission.AddNode]: 'Can add nodes to this domain',
  [Permission.EditNodeConfig]: 'Can change a node’s configuration',
  [Permission.UpdateNodeSettings]: 'Can change a node’s settings',
  [Permission.ManageNodeMembers]: 'Can add and remove a node’s members',
  [Permission.EditTreeStructure]: 'Can move, nest and reorder nodes',
  [Permission.ManageNodeTypes]: 'Can define which node types exist',
  [Permission.CreateWorkspace]: 'Can create workspaces',
  [Permission.UpdateWorkspace]: 'Can rename and update the workspace',
  [Permission.DeleteWorkspace]: 'Can delete the workspace',
  [Permission.EditWorkspaceConfig]: 'Can change workspace configuration',
  [Permission.ViewTelemetry]: 'Can read the workspace diagnostic logs',
  [Permission.Themes]: 'Can change the theme every member sees',
  [Permission.AddUsers]: 'Can add new members',
  [Permission.RemoveUsers]: 'Can remove members',
  [Permission.BanUser]: 'Can ban users from the domain',
  [Permission.ManageRoles]: 'Can define roles and change which role each member holds',
  [Permission.ManageDomains]: 'Full domain management',
  [Permission.ConfigureSystem]: 'Server-level configuration',
  [Permission.AppInstall]: 'Can install an app just for themselves, with only the abilities every app has',
  [Permission.AppInstallScoped]: 'Can install an app for the whole workspace, a page and the pages below it, or chosen people',
  [Permission.AppPublish]: 'Can add an app to this workspace’s own list of apps',
  [Permission.AppManage]: 'Can remove, pause or roll back any installed app, read the apps history, and mark which apps a page needs',
  [Permission.AppInstallAllowNodeRead]: 'Can let an app they install read the pages it is installed on',
  [Permission.AppInstallAllowNodeWrite]: 'Can let an app they install create, rename and move pages',
  [Permission.AppInstallAllowMdEdit]: 'Can let an app they install change the part of a document it shows in',
  [Permission.AppInstallAllowFiles]: 'Can let an app they install read and save the workspace’s files',
  [Permission.AppInstallAllowChat]: 'Can let an app they install read and send messages in a page’s chat',
  [Permission.AppInstallAllowMembers]: 'Can let an app they install see the members of a page',
  [Permission.AppInstallAllowStorage]: 'Can let an app they install store its own settings and data',
  [Permission.AppInstallAllowClipboard]: 'Can let an app they install copy and paste, after someone clicks',
  [Permission.AppInstallAllowNotifications]: 'Can let an app they install show short notices',
  [Permission.AppInstallAllowHostNetwork]: 'Can let an app they install reach the websites it names, from the member’s own computer',
  [Permission.AppInstallAllowPrivateNetwork]: 'Can let an app they install reach machines on the member’s own network, such as company servers',
  [Permission.AppInstallAllowServerNetwork]: 'Can let an app they install reach the websites it names, from the workspace server',
  [Permission.AppInstallAllowInternalServe]: 'Can let an app they install answer requests from the same app used by other members',
  [Permission.AppInstallAllowInternalCall]: 'Can let an app they install send requests to apps other members are running',
  [Permission.AppInstallAllowPeerServe]: 'Can let an app they install answer requests sent straight to a member’s device by the same app, without the workspace server in between',
  [Permission.AppInstallAllowPeerCall]: 'Can let an app they install send requests straight to other members’ devices running the same app',
  [Permission.AppInstallAllowGroupTopics]: 'Can let an app they install join its own channels with the other members who use it',
};

/**
 * Organized permission categories for the PermissionManager UI, keyed by the
 * heading the matrix shows. Derived from the canonical grouping so a new
 * permission appears in the matrix as soon as it is categorised.
 */
export const PERMISSION_CATEGORIES: Record<string, PermissionDefinition[]> =
  Object.fromEntries(
    Object.values(CANONICAL_CATEGORIES).map((category) => [
      category.label,
      category.permissions.map((permission) => ({
        id: permission,
        label: PERMISSION_LABELS[permission],
        description: PERMISSION_DESCRIPTIONS[permission],
      })),
    ]),
  );
