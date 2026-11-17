/**
 * workspace-protocol.ts
 *
 * TypeScript equivalent of the Rust WorkspaceProtocol types defined in citadel-workspace-types/src/lib.rs.
 * These types are used for structured communication between the TypeScript frontend and Rust backend.
 */

import type { AppsRequest, ChatAttachmentsRequest, ChatDocumentsRequest, DocumentsRequest, GroupMessageType, MemberRole, MessagingTrustRequest, RolesRequest, SecureLinksRequest, SignInSettings, TelemetryRequest, WorkspaceLogoChange, WorkspaceProtocolRequest } from 'citadel-workspace-client-ts';
import type { NodeTabRequestsTS, UpdateNodeRequestTS } from './node-tab-requests';

/** A request variant's body, read from the generated binding rather than restated. */
type RequestBody<K extends string> = Extract<WorkspaceProtocolRequest, Record<K, unknown>>[K];

/**
 * The main protocol payload that wraps either a request or response
 */
export enum WorkspaceProtocolPayloadTypeTS {
  Request = 'request',
  Response = 'response'
}

export interface WorkspaceProtocolPayloadTS {
  Request?: WorkspaceProtocolRequestTS;
  Response?: WorkspaceProtocolResponseTS;
}

/**
 * Enum wrapper for WorkspaceProtocolRequest
 * Only Message type is needed for frontend-to-backend communication
 */
export interface MessageRequestTS {
  contents: Uint8Array;
}

export interface WorkspaceProtocolRequestTS extends NodeTabRequestsTS {
  Message?: MessageRequestTS;

  // GetWorkspace variant - workspace_id defaults to sentinel if null/undefined
  GetWorkspace?: { workspace_id?: string | null } | null;

  // List all workspaces the user has access to
  ListWorkspaces?: null;

  // Workspace commands
  CreateWorkspace?: {
    name: string;
    description: string;
    workspace_master_password: string;
    metadata?: number[]; // Vec<u8> as number[]
  };

  // Workspace operations
  UpdateWorkspace?: {
    workspace_id?: string | null;
    name?: string;
    description?: string;
    workspace_master_password: string;
    metadata?: number[]; // Vec<u8> as number[]
  };
  DeleteWorkspace?: {
    workspace_id?: string | null;
    workspace_master_password: string;
  };

  // Member operations
  AddMember?: {
    user_id: string;
    domain_id?: string;
    role: MemberRole; // A role id from the table, or the legacy 'Banned'.
    metadata?: number[];
  };
  GetMember?: {
    user_id: string;
  };
  UpdateMemberRole?: {
    user_id: string;
    role: MemberRole; // A role id from the table, or the legacy 'Banned'.
    metadata?: number[];
  };
  UpdateMemberPermissions?: {
    user_id: string;
    domain_id: string;
    permissions: PermissionTS[];
    operation: UpdateOperationTS;
  };
  RemoveMember?: {
    user_id: string;
    domain_id?: string;
  };
  ListMembers?: {
    domain_id?: string;
  };

  // Group messaging operations
  SendGroupMessage?: {
    group_id: string;
    message_type: SentGroupMessageType;
    content: string;
    reply_to?: string;
    mentions?: string[];
  };

  EditGroupMessage?: RequestBody<'EditGroupMessage'>;
  DeleteGroupMessage?: RequestBody<'DeleteGroupMessage'>;
  GetGroupMessages?: {
    group_id: string;
    before_timestamp?: number;
    limit?: number;
  };

  GetThreadMessages?: RequestBody<'GetThreadMessages'>;
  // A node channel's reactions, read cursors and typing (lib/workspace-service/group-chat-signals)
  ReactGroupMessage?: RequestBody<'ReactGroupMessage'>;
  MarkGroupRead?: RequestBody<'MarkGroupRead'>;
  GroupTyping?: RequestBody<'GroupTyping'>;

  // User profile operations
  UpdateUserProfile?: import('./user-profile-request').UpdateUserProfileRequest;

  // Server capabilities query
  GetServerCapabilities?: null;

  // Generic tree node operations
  CreateNode?: {
    parent_id: string | null;
    entity_type: { Child: string } | 'Workspace';
    name: string;
    description: string;
    mdx_content?: string;
    metadata?: number[];
    is_default?: boolean;
  };
  GetNode?: {
    node_id: string;
  };
  UpdateWorkspaceTheme?: {
    workspace_id?: string;
    /** Serialized theme bytes, stored verbatim in workspace metadata. */
    theme: number[];
  };
  UpdateWorkspaceProfile?: {
    workspace_id?: string;
    name?: string;
    description?: string;
    logo?: WorkspaceLogoChange;
  };
  UpdateNode?: UpdateNodeRequestTS;
  SetMembersVisible?: { node_id: string; visible: boolean };
  Telemetry?: TelemetryRequest; // Terms, consent and the diagnostic-log service.
  MessagingTrust?: MessagingTrustRequest; // Who connects without asking (messaging-trust-operations.ts).
  Roles?: RolesRequest; // The workspace role table (roles-operations.ts).
  Documents?: DocumentsRequest; // A document node's CRDT log and awareness (cdoc/collab/documents-transport.ts).
  ChatDocuments?: ChatDocumentsRequest; // The same, for a document shared in a node's chat.
  ChatAttachments?: ChatAttachmentsRequest; // A file shared in a node's chat, uploaded or read in chunks.
  SecureLinks?: SecureLinksRequest; // Secure deep links (secure-links-operations.ts).
  Apps?: AppsRequest; // Citadel Apps: the marketplace and installs (apps-operations.ts).
  GetSignInSettings?: null; // The sign-in settings (lib/workspace-service/sign-in-settings.ts).
  UpdateSignInSettings?: { settings: SignInSettings };
  DeleteNode?: { node_id: string; cascade: boolean };
  MoveNode?: { node_id: string; new_parent_id: string | null };
  ListNodes?: {
    parent_id?: string | null;
    depth?: number;
    entity_types?: Array<{ Child: string } | 'Workspace'>;
  };
  GetTreeStructure?: {
    root_id?: string | null; max_depth?: number;
  };
  GetTreeSchema?: null;
  UpdateTreeSchema?: {
    schema: {
      rules: Array<{ parent_type: string; allowed_child_types: string[] }>;
      max_depth?: number | null;
    };
  };
}

export enum GroupMessageTypeTS {
  Text = 'Text', Markdown = 'Markdown', System = 'System'
}
/** What a sent message is: a plain kind, or one that carries a value (a shared live document). */
export type SentGroupMessageType = GroupMessageTypeTS | Exclude<GroupMessageType, string>;

// Group message interface
export interface GroupMessageTS {
  id: string;
  group_id: string;
  sender_id: string;
  sender_name: string;
  message_type: GroupMessageTypeTS;
  content: string;
  timestamp: number;
  reply_to?: string;
  reply_count: number;
  mentions: string[];
  edited_at?: number;
}

/**
 * Simplified type definitions for workspace entities
 */
export interface UserTS {
  id: string;
  username: string;
  display_name: string;
  name?: string;
  metadata?: Record<string, unknown>; // For avatar and other user metadata
}

export enum PermissionTS {
  ViewContent = 'ViewContent',
  EditContent = 'EditContent',
  CreateNode = 'CreateNode',
  DeleteNode = 'DeleteNode',
  UpdateNode = 'UpdateNode',
  EditNodeConfig = 'EditNodeConfig',
  AddNode = 'AddNode',
  UpdateNodeSettings = 'UpdateNodeSettings',
  ManageNodeMembers = 'ManageNodeMembers'
}

/**
 * Enum alternatives for WorkspaceProtocolResponse
 */
export type WorkspaceProtocolResponseTS =
  | { success: true }
  | { error: string }
  | { workspace_initialized: boolean }
  | { WorkspaceNotInitialized: true }
  | { members: UserTS[] }
  | { member: UserTS }
  // Group messaging responses
  | { GroupMessageNotification: { group_id: string; message: GroupMessageTS } }
  | { GroupMessages: { group_id: string; messages: GroupMessageTS[]; has_more: boolean } }
  | { GroupMessageEdited: { group_id: string; message_id: string; new_content: string; edited_at: number } }
  | { GroupMessageDeleted: { group_id: string; message_id: string; deleted_by: string } }
  | { GroupMessage: GroupMessageTS }
  // User profile responses
  | { UserProfileUpdated: UserTS }
  // Server capabilities response
  | { ServerCapabilities: ServerCapabilitiesTS }
  // Multi-workspace support
  | { Workspaces: WorkspaceMetadataTS[] };

export enum UpdateOperationTS {
  Add = 'add',
  Remove = 'remove',
  Set = 'set'
}

/**
 * Lightweight workspace metadata for listing accessible workspaces
 */
export interface WorkspaceMetadataTS {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  is_default: boolean;
  member_count: number;
}

/**
 * Server file transfer and storage capabilities
 */
export interface ServerCapabilitiesTS {
  /** Whether server-mediated file transfers are enabled */
  allow_server_file_transfer: boolean;
  /** Whether RE-VFS (server-side encrypted storage) is enabled */
  allow_server_revfs_storage: boolean;
  /** Maximum file size for transfers (in megabytes) */
  max_file_transfer_size_mb: bigint;
  /** RE-VFS storage quota per user (in megabytes) */
  revfs_storage_quota_mb: bigint;
}
