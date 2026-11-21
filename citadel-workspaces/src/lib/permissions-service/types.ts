/**
 * Permissions Service - Types & Constants
 *
 * Permission enum, DomainPermissionEntry interface,
 * and human-readable label / category constants.
 */

/** The workspace permission: the generated citadel-workspace-types enum. */
import type { Permission } from 'citadel-workspace-client-ts';
export type { Permission };

/**
 * Permission set for a specific domain
 */
export interface DomainPermissionEntry {
  domainId: string;
  permissions: Set<Permission>;
  lastUpdated: number;
}

/**
 * Human-readable labels for permissions.
 *
 * "Human-readable" was doing a lot of work here: these were the enum names with
 * spaces inserted. "Node" is the code's word for an office or a room, "MDX" is
 * the file format, and "Tree Structure" is the data structure — none of them
 * are things an administrator has been shown anywhere else in the product,
 * which is the permission matrix's whole audience.
 */
export const PERMISSION_LABELS: Record<Permission, string> = {
  All: 'All Permissions',
  CreateNode: 'Create offices and rooms',
  DeleteNode: 'Delete offices and rooms',
  UpdateNode: 'Rename offices and rooms',
  AddNode: 'Add offices and rooms',
  EditNodeConfig: 'Change office and room settings',
  UpdateNodeSettings: 'Update office and room settings',
  ManageNodeMembers: 'Manage who is in an office or room',
  CreateWorkspace: 'Create Workspace',
  UpdateWorkspace: 'Update Workspace',
  DeleteWorkspace: 'Delete Workspace',
  EditWorkspaceConfig: 'Edit Workspace Config',
  ViewTelemetry: 'View diagnostic logs',
  Themes: 'Edit Workspace Theme',
  EditTreeStructure: 'Reorganise the workspace',
  ManageNodeTypes: 'Define new kinds of space',
  ViewContent: 'View Content',
  ViewMembers: 'See members',
  EditContent: 'Edit Content',
  EditMdx: 'Edit documents',
  ShareSecureLinks: 'Share secure links',
  AddUsers: 'Add Users',
  RemoveUsers: 'Remove Users',
  BanUser: 'Ban User',
  ManageRoles: 'Manage roles',
  SendMessages: 'Send Messages',
  ReadMessages: 'Read Messages',
  UploadFiles: 'Upload Files',
  DownloadFiles: 'Download Files',
  ManageDomains: 'Manage every space in the workspace',
  ConfigureSystem: 'Configure System',
  AppInstall: 'Install apps for yourself',
  AppInstallScoped: 'Install apps for others',
  AppPublish: 'Publish apps to this workspace',
  AppManage: 'Manage installed apps',
  AppInstallAllowNodeRead: 'Let an app read pages',
  AppInstallAllowNodeWrite: 'Let an app add and move pages',
  AppInstallAllowMdEdit: 'Let an app edit documents',
  AppInstallAllowFiles: 'Let an app read and save files',
  AppInstallAllowChat: 'Let an app read and send messages',
  AppInstallAllowMembers: 'Let an app see who is here',
  AppInstallAllowStorage: 'Let an app keep its own data',
  AppInstallAllowClipboard: 'Let an app use the clipboard',
  AppInstallAllowNotifications: 'Let an app show notifications',
  AppInstallAllowHostNetwork: 'Let an app reach websites from members’ computers',
  AppInstallAllowPrivateNetwork: 'Let an app reach members’ local networks',
  AppInstallAllowServerNetwork: 'Let an app reach websites from the server',
  AppInstallAllowInternalServe: 'Let an app offer a service to members',
  AppInstallAllowInternalCall: 'Let an app use other members’ services',
  AppInstallAllowPeerServe: 'Let an app serve members directly, device to device',
  AppInstallAllowPeerCall: 'Let an app call members’ devices directly',
  AppInstallAllowGroupTopics: 'Let an app use its own member channels',
};

/** Every permission, in declaration order. Mirrors `Permission::ALL_VARIANTS`. */
/** Every permission: the keys of `PERMISSION_LABELS`, which the type holds to exactly the generated union. */
export const ALL_PERMISSIONS: Permission[] = Object.keys(PERMISSION_LABELS) as Permission[];

/**
 * Permission categories for UI grouping
 */
export const PERMISSION_CATEGORIES = {
  content: {
    label: 'Content',
    permissions: ['ViewContent', 'EditContent', 'EditMdx', 'ShareSecureLinks'],
  },
  messaging: {
    label: 'Messaging',
    permissions: ['SendMessages', 'ReadMessages'],
  },
  files: {
    label: 'Files',
    permissions: ['UploadFiles', 'DownloadFiles'],
  },
  nodes: {
    label: 'Nodes',
    permissions: [
      'CreateNode',
      'UpdateNode',
      'DeleteNode',
      'AddNode',
      'EditNodeConfig',
      'UpdateNodeSettings',
      'ManageNodeMembers',
      'EditTreeStructure',
      'ManageNodeTypes',
    ],
  },
  workspace: {
    label: 'Workspace',
    permissions: [
      'CreateWorkspace',
      'UpdateWorkspace',
      'DeleteWorkspace',
      'EditWorkspaceConfig',
      'ViewTelemetry',
      'Themes',
    ],
  },
  users: {
    label: 'User Management',
    permissions: ['ViewMembers', 'AddUsers', 'RemoveUsers', 'BanUser', 'ManageRoles'],
  },
  admin: {
    label: 'Administration',
    permissions: ['ManageDomains', 'ConfigureSystem', 'All'],
  },
  apps: {
    label: 'Apps',
    permissions: [
      'AppInstall',
      'AppInstallScoped',
      'AppPublish',
      'AppManage',
      'AppInstallAllowNodeRead',
      'AppInstallAllowNodeWrite',
      'AppInstallAllowMdEdit',
      'AppInstallAllowFiles',
      'AppInstallAllowChat',
      'AppInstallAllowMembers',
      'AppInstallAllowStorage',
      'AppInstallAllowClipboard',
      'AppInstallAllowNotifications',
      'AppInstallAllowHostNetwork',
      'AppInstallAllowPrivateNetwork',
      'AppInstallAllowServerNetwork',
      'AppInstallAllowInternalServe',
      'AppInstallAllowInternalCall',
      'AppInstallAllowPeerServe',
      'AppInstallAllowPeerCall',
      'AppInstallAllowGroupTopics',
    ],
  },
} as const;
