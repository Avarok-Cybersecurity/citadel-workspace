/**
 * Permissions Service - Types & Constants
 *
 * Permission enum, DomainPermissions interface,
 * and human-readable label / category constants.
 */

/**
 * Permission enum matching Rust Permission type from citadel-workspace-types
 */
export enum Permission {
  // Wildcard permission
  All = 'All',
  // Node permissions (generic - applies to offices, rooms, etc.)
  CreateNode = 'CreateNode',
  DeleteNode = 'DeleteNode',
  UpdateNode = 'UpdateNode',
  AddNode = 'AddNode',
  EditNodeConfig = 'EditNodeConfig',
  UpdateNodeSettings = 'UpdateNodeSettings',
  ManageNodeMembers = 'ManageNodeMembers',
  /** Rearrange the node tree: move, nest and reorder offices and rooms. */
  EditTreeStructure = 'EditTreeStructure',
  /** Define which node types exist and how they behave. */
  ManageNodeTypes = 'ManageNodeTypes',
  // Workspace permissions
  CreateWorkspace = 'CreateWorkspace',
  UpdateWorkspace = 'UpdateWorkspace',
  DeleteWorkspace = 'DeleteWorkspace',
  EditWorkspaceConfig = 'EditWorkspaceConfig',
  /** Read the workspace's diagnostic logs and who has read them. */
  ViewTelemetry = 'ViewTelemetry',
  /** Edit the workspace theme every member sees. */
  Themes = 'Themes',
  // Content permissions
  ViewContent = 'ViewContent',
  /** See everyone else who has access to a node, including through a level above. */
  ViewMembers = 'ViewMembers',
  EditContent = 'EditContent',
  EditMdx = 'EditMdx',
  /** Make secure links: a link that hides where it points and opens only for the people named. */
  ShareSecureLinks = 'ShareSecureLinks',
  // User management
  AddUsers = 'AddUsers',
  RemoveUsers = 'RemoveUsers',
  BanUser = 'BanUser',
  /** Edit the workspace's role table, and change other members' roles and grants. */
  ManageRoles = 'ManageRoles',
  // Messaging
  SendMessages = 'SendMessages',
  ReadMessages = 'ReadMessages',
  // Files
  UploadFiles = 'UploadFiles',
  DownloadFiles = 'DownloadFiles',
  // Admin
  ManageDomains = 'ManageDomains',
  ConfigureSystem = 'ConfigureSystem',
  // Apps
  AppInstall = 'AppInstall',
  AppInstallScoped = 'AppInstallScoped',
  AppPublish = 'AppPublish',
  AppManage = 'AppManage',
  AppInstallAllowNodeRead = 'AppInstallAllowNodeRead',
  AppInstallAllowNodeWrite = 'AppInstallAllowNodeWrite',
  AppInstallAllowMdEdit = 'AppInstallAllowMdEdit',
  AppInstallAllowFiles = 'AppInstallAllowFiles',
  AppInstallAllowChat = 'AppInstallAllowChat',
  AppInstallAllowMembers = 'AppInstallAllowMembers',
  AppInstallAllowStorage = 'AppInstallAllowStorage',
  AppInstallAllowClipboard = 'AppInstallAllowClipboard',
  AppInstallAllowNotifications = 'AppInstallAllowNotifications',
  AppInstallAllowHostNetwork = 'AppInstallAllowHostNetwork',
  AppInstallAllowPrivateNetwork = 'AppInstallAllowPrivateNetwork',
  AppInstallAllowServerNetwork = 'AppInstallAllowServerNetwork',
  AppInstallAllowInternalServe = 'AppInstallAllowInternalServe',
  AppInstallAllowInternalCall = 'AppInstallAllowInternalCall',
  AppInstallAllowPeerServe = 'AppInstallAllowPeerServe',
  AppInstallAllowPeerCall = 'AppInstallAllowPeerCall',
  AppInstallAllowGroupTopics = 'AppInstallAllowGroupTopics',
}

/** The legacy role enum, as generated. Only `Banned` still means anything; a role is a table id. */
export type { UserRole } from 'citadel-workspace-client-ts';
import type { UserRole } from 'citadel-workspace-client-ts';

/**
 * Permission set for a specific domain
 */
export interface DomainPermissions {
  domainId: string;
  /** The legacy mirror. Never read for authority; the role is `currentUser.roleId`. */
  role: UserRole;
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
  [Permission.All]: 'All Permissions',
  [Permission.CreateNode]: 'Create offices and rooms',
  [Permission.DeleteNode]: 'Delete offices and rooms',
  [Permission.UpdateNode]: 'Rename offices and rooms',
  [Permission.AddNode]: 'Add offices and rooms',
  [Permission.EditNodeConfig]: 'Change office and room settings',
  [Permission.UpdateNodeSettings]: 'Update office and room settings',
  [Permission.ManageNodeMembers]: 'Manage who is in an office or room',
  [Permission.CreateWorkspace]: 'Create Workspace',
  [Permission.UpdateWorkspace]: 'Update Workspace',
  [Permission.DeleteWorkspace]: 'Delete Workspace',
  [Permission.EditWorkspaceConfig]: 'Edit Workspace Config',
  [Permission.ViewTelemetry]: 'View diagnostic logs',
  [Permission.Themes]: 'Edit Workspace Theme',
  [Permission.EditTreeStructure]: 'Reorganise the workspace',
  [Permission.ManageNodeTypes]: 'Define new kinds of space',
  [Permission.ViewContent]: 'View Content',
  [Permission.ViewMembers]: 'See members',
  [Permission.EditContent]: 'Edit Content',
  [Permission.EditMdx]: 'Edit documents',
  [Permission.ShareSecureLinks]: 'Share secure links',
  [Permission.AddUsers]: 'Add Users',
  [Permission.RemoveUsers]: 'Remove Users',
  [Permission.BanUser]: 'Ban User',
  [Permission.ManageRoles]: 'Manage roles',
  [Permission.SendMessages]: 'Send Messages',
  [Permission.ReadMessages]: 'Read Messages',
  [Permission.UploadFiles]: 'Upload Files',
  [Permission.DownloadFiles]: 'Download Files',
  [Permission.ManageDomains]: 'Manage every space in the workspace',
  [Permission.ConfigureSystem]: 'Configure System',
  [Permission.AppInstall]: 'Install apps for yourself',
  [Permission.AppInstallScoped]: 'Install apps for others',
  [Permission.AppPublish]: 'Publish apps to this workspace',
  [Permission.AppManage]: 'Manage installed apps',
  [Permission.AppInstallAllowNodeRead]: 'Let an app read pages',
  [Permission.AppInstallAllowNodeWrite]: 'Let an app add and move pages',
  [Permission.AppInstallAllowMdEdit]: 'Let an app edit documents',
  [Permission.AppInstallAllowFiles]: 'Let an app read and save files',
  [Permission.AppInstallAllowChat]: 'Let an app read and send messages',
  [Permission.AppInstallAllowMembers]: 'Let an app see who is here',
  [Permission.AppInstallAllowStorage]: 'Let an app keep its own data',
  [Permission.AppInstallAllowClipboard]: 'Let an app use the clipboard',
  [Permission.AppInstallAllowNotifications]: 'Let an app show notifications',
  [Permission.AppInstallAllowHostNetwork]: 'Let an app reach websites from members’ computers',
  [Permission.AppInstallAllowPrivateNetwork]: 'Let an app reach members’ local networks',
  [Permission.AppInstallAllowServerNetwork]: 'Let an app reach websites from the server',
  [Permission.AppInstallAllowInternalServe]: 'Let an app offer a service to members',
  [Permission.AppInstallAllowInternalCall]: 'Let an app use other members’ services',
  [Permission.AppInstallAllowPeerServe]: 'Let an app serve members directly, device to device',
  [Permission.AppInstallAllowPeerCall]: 'Let an app call members’ devices directly',
  [Permission.AppInstallAllowGroupTopics]: 'Let an app use its own member channels',
};

/** Every permission, in declaration order. Mirrors `Permission::ALL_VARIANTS`. */
export const ALL_PERMISSIONS: Permission[] = Object.values(Permission);

/**
 * Permission categories for UI grouping
 */
export const PERMISSION_CATEGORIES = {
  content: {
    label: 'Content',
    permissions: [Permission.ViewContent, Permission.EditContent, Permission.EditMdx, Permission.ShareSecureLinks],
  },
  messaging: {
    label: 'Messaging',
    permissions: [Permission.SendMessages, Permission.ReadMessages],
  },
  files: {
    label: 'Files',
    permissions: [Permission.UploadFiles, Permission.DownloadFiles],
  },
  nodes: {
    label: 'Nodes',
    permissions: [
      Permission.CreateNode,
      Permission.UpdateNode,
      Permission.DeleteNode,
      Permission.AddNode,
      Permission.EditNodeConfig,
      Permission.UpdateNodeSettings,
      Permission.ManageNodeMembers,
      Permission.EditTreeStructure,
      Permission.ManageNodeTypes,
    ],
  },
  workspace: {
    label: 'Workspace',
    permissions: [
      Permission.CreateWorkspace,
      Permission.UpdateWorkspace,
      Permission.DeleteWorkspace,
      Permission.EditWorkspaceConfig,
      Permission.ViewTelemetry,
      Permission.Themes,
    ],
  },
  users: {
    label: 'User Management',
    permissions: [Permission.ViewMembers, Permission.AddUsers, Permission.RemoveUsers, Permission.BanUser, Permission.ManageRoles],
  },
  admin: {
    label: 'Administration',
    permissions: [Permission.ManageDomains, Permission.ConfigureSystem, Permission.All],
  },
  apps: {
    label: 'Apps',
    permissions: [
      Permission.AppInstall,
      Permission.AppInstallScoped,
      Permission.AppPublish,
      Permission.AppManage,
      Permission.AppInstallAllowNodeRead,
      Permission.AppInstallAllowNodeWrite,
      Permission.AppInstallAllowMdEdit,
      Permission.AppInstallAllowFiles,
      Permission.AppInstallAllowChat,
      Permission.AppInstallAllowMembers,
      Permission.AppInstallAllowStorage,
      Permission.AppInstallAllowClipboard,
      Permission.AppInstallAllowNotifications,
      Permission.AppInstallAllowHostNetwork,
      Permission.AppInstallAllowPrivateNetwork,
      Permission.AppInstallAllowServerNetwork,
      Permission.AppInstallAllowInternalServe,
      Permission.AppInstallAllowInternalCall,
      Permission.AppInstallAllowPeerServe,
      Permission.AppInstallAllowPeerCall,
      Permission.AppInstallAllowGroupTopics,
    ],
  },
} as const;
