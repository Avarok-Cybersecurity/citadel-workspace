/// Citadel Apps: capabilities, install scopes and audiences.
pub mod apps;
/// An app install as stored, and why an apps request is refused.
pub mod apps_install;
/// An app's strict `manifest.json`.
pub mod apps_manifest;
/// Reading and validating a manifest, and its text and identity limits.
pub mod apps_manifest_check;
/// The manifest's capability, limit and artifact checks, and their limits.
pub mod apps_manifest_check_parts;
/// The manifest rules of the peer-to-peer and topic capabilities and their limits.
pub mod apps_manifest_check_peer;
/// `SessionLimits`, and the manifest rules of `citadel.session`.
pub mod apps_manifest_session;
/// A document's hidden required-apps header.
pub mod apps_md_header;
/// The files an app opens, and how that declaration is checked.
pub mod apps_opens;
/// A member's own peer-to-peer and topic settings, and `AuthorizePeer`'s question.
pub mod apps_peer;
/// The apps requests.
pub mod apps_protocol;
/// The answers to apps requests, and the apps audit log.
pub mod apps_responses;
/// "Plan & billing" over a member's session.
pub mod billing;
/// Files shared in a node's chat, kept on the workspace server; see `chat_attachments`.
pub mod chat_attachments;
#[cfg(test)]
mod chat_attachments_tests;
/// Documents shared in a node's chat, on the page's relay; see `chat_documents`.
pub mod chat_documents;
#[cfg(test)]
mod chat_documents_tests;
/// The build script's cross-workspace dependency rule, here so it can be tested.
///
/// The parent and the agent are separate cargo workspaces with separate lock
/// files and shared git dependencies. Updating one and not the other compiles
/// cleanly and fails at runtime.
pub mod dependency_agreement;
/// A document node's CRDT update log, its snapshot, and the awareness relay.
pub mod document_refusal;
pub mod documents;
/// A node channel's reactions, read cursors and typing.
pub mod group_chat;
#[cfg(test)]
mod group_chat_tests;
pub mod ice;
pub mod messaging_trust;
/// The metadata keys behind a node's tabs and time zone, and what each may hold.
pub mod node_tabs;
/// A workspace's role table and its built-ins.
pub mod roles;
/// Reading and editing the role table.
pub mod roles_protocol;
/// A role table as it is stored, and reading one stored before it named new members' role.
pub mod roles_stored;
/// Secure links: tokens the server maps to in-app deep links for the people named.
pub mod secure_links;
pub mod server_feature_refusal;
/// The post-connect server identity challenge and its answer.
pub mod server_identity;
pub mod sign_in;
pub mod structs;
/// The build script's submodule-freshness rule, here so it can be tested.
///
/// `build.rs` is not a test target, so logic that lives only there is asserted
/// rather than known. The classification is pure and lives here; `build.rs`
/// `include!`s this file and supplies the git calls.
pub mod submodule_freshness;
pub mod telemetry;
pub mod telemetry_metric;
pub mod telemetry_reads;
pub mod terms;
/// The IANA time-zone names a workspace or node may be set to.
pub mod time_zones;
pub mod turn_usage;

/// The id of the workspace every tree hangs from; the kernel and the UI read it from here.
pub const WORKSPACE_ROOT_ID: &str = "workspace-root";

use custom_debug::Debug;
use ice::IceServer;
use serde::{Deserialize, Serialize};
use sign_in::SignInSettings;
use structs::{
    CustomNodeType, DomainNode, NodeEntityType, Permission, TreeNode, TreeSchema, User, Workspace,
    WorkspaceMetadata,
};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum WorkspaceProtocolPayload {
    Request(WorkspaceProtocolRequest),
    Response(Box<WorkspaceProtocolResponse>),
}

impl From<WorkspaceProtocolRequest> for WorkspaceProtocolPayload {
    fn from(request: WorkspaceProtocolRequest) -> Self {
        WorkspaceProtocolPayload::Request(request)
    }
}

impl From<WorkspaceProtocolResponse> for WorkspaceProtocolPayload {
    fn from(response: WorkspaceProtocolResponse) -> Self {
        WorkspaceProtocolPayload::Response(Box::new(response))
    }
}

/// Never print a secret, whatever the log level.
///
/// `async_process_command` logs `"Processing command: {command:?}"` at
/// `debug!`, and three variants of this enum carry `workspace_master_password`
/// as a plain `String`. So raising `RUST_LOG` to `citadel=debug` -- which an
/// operator does precisely when they are about to paste a log into a ticket --
/// wrote the workspace master password in clear on every CreateWorkspace,
/// UpdateWorkspace and DeleteWorkspace.
///
/// The mechanism was already here and already in use: `#[debug(with = ...)]`
/// redacts the `metadata` byte blob on the line BELOW each of those password
/// fields, and `ServerConfig` in the kernel hand-writes a `Debug` that redacts
/// the same secret. It was applied to the byte blob and to one struct, and not
/// to the secret next to it.
///
/// The length is omitted deliberately. It is not needed to debug a protocol
/// message, and printing it narrows an offline guess.
pub fn secret_debug_fmt(_: &String, f: &mut std::fmt::Formatter) -> std::fmt::Result {
    write!(f, "<redacted>")
}

pub fn bytes_opt_debug_fmt<T: std::fmt::Debug + AsRef<[u8]>>(
    val: &Option<T>,
    f: &mut std::fmt::Formatter,
) -> std::fmt::Result {
    if let Some(val) = val {
        citadel_internal_service_types::bytes_debug_fmt(val, f)
    } else {
        write!(f, "None")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum WorkspaceProtocolRequest {
    // Workspace commands
    CreateWorkspace {
        name: String,
        description: String,
        #[debug(with = secret_debug_fmt)]
        workspace_master_password: String,
        #[debug(with = bytes_opt_debug_fmt)]
        metadata: Option<Vec<u8>>,
    },
    GetWorkspace {
        /// Workspace ID to retrieve. None defaults to the sentinel workspace-root.
        workspace_id: Option<String>,
    },
    /// List all workspaces the requesting user has access to
    ListWorkspaces,
    UpdateWorkspace {
        /// Workspace ID to update. None defaults to the sentinel workspace-root.
        workspace_id: Option<String>,
        name: Option<String>,
        description: Option<String>,
        #[debug(with = secret_debug_fmt)]
        workspace_master_password: String,
        #[debug(with = bytes_opt_debug_fmt)]
        metadata: Option<Vec<u8>>,
    },
    DeleteWorkspace {
        /// Workspace ID to delete. None defaults to the sentinel workspace-root.
        workspace_id: Option<String>,
        #[debug(with = secret_debug_fmt)]
        workspace_master_password: String,
    },

    // Member commands
    AddMember {
        user_id: String,
        /// Domain (node) to add the member to. None defaults to workspace root.
        domain_id: Option<String>,
        /// The id of a role in the workspace's table.
        role: String,
        #[debug(with = bytes_opt_debug_fmt)]
        metadata: Option<Vec<u8>>,
    },
    GetMember {
        user_id: String,
    },
    UpdateMemberRole {
        user_id: String,
        /// The id of a role in the workspace's table.
        role: String,
        #[debug(with = bytes_opt_debug_fmt)]
        metadata: Option<Vec<u8>>,
    },
    UpdateMemberPermissions {
        user_id: String,
        domain_id: String,
        permissions: Vec<Permission>,
        operation: UpdateOperation,
    },
    RemoveMember {
        user_id: String,
        /// Domain (node) to remove the member from. None defaults to workspace root.
        domain_id: Option<String>,
    },
    /// Ban an account: it loses its role in every workspace and is refused on join and on
    /// admission until unbanned. Needs `RemoveUsers`, never applies to the Owner, and only to a
    /// member below the caller.
    Ban {
        user_id: String,
    },
    /// Lift a ban. The account gets the role the table gives new members. Needs `RemoveUsers`.
    Unban {
        user_id: String,
    },
    /// Every banned account, including ones no longer on any roster, so a ban can be found and
    /// lifted. Needs `RemoveUsers`, as `Unban` does.
    ListBanned,
    ListMembers {
        /// Domain (node) to list members for. None defaults to workspace root.
        domain_id: Option<String>,
    },
    /// Get a user's permissions for a specific domain
    GetUserPermissions {
        user_id: String,
        domain_id: String,
    },

    /// Update the current user's profile. Every field is optional; an absent
    /// field is left as it is.
    UpdateUserProfile {
        /// New display name (optional)
        name: Option<String>,
        /// Base64-encoded avatar image data (WebP format, max 256x256).
        /// `Some("")` removes the stored avatar.
        avatar_data: Option<String>,
        /// Contact email shown to workspace members. `Some("")` clears it.
        email: Option<String>,
        /// Job title shown to workspace members. `Some("")` clears it.
        title: Option<String>,
        /// Whether members who are not the user's P2P contacts may see the
        /// avatar, email and title. `None` leaves the stored choice alone.
        show_profile_to_strangers: Option<bool>,
        /// Whether the user accepts P2P registration requests from people they
        /// are not connected with. Enforced by the user's own client; stored
        /// here only so a refused requester can be told why. `None` leaves it.
        accepts_requests_from_strangers: Option<bool>,
        /// Whether other members' clients may show this user's presence.
        /// The server's peer list reports connection state to everyone, so
        /// this is published for their clients to honour. `None` leaves it.
        shows_online_status: Option<bool>,
        /// The user's identity binding (base64url, identity doc §3.4 rev b): their portable
        /// identity's signature that it holds this username on this server. The server verifies
        /// it before storing it, and every member may read it. `None` leaves it.
        identity_binding: Option<String>,
    },

    Message {
        // UI can inscribe whatever subprotocol it wishes on this for e.g., the actual message contents,
        // read receipts, typing indicators, etc, likely using an enum.
        #[debug(with = citadel_internal_service_types::bytes_debug_fmt)]
        contents: Vec<u8>,
    },

    // ========== Group Messaging Commands ==========
    /// Send a message to a group chat channel (office or room)
    SendGroupMessage {
        /// UUID of the group chat channel (office.chat_channel_id or room.chat_channel_id)
        group_id: String,
        /// Type of message (text, markdown, system)
        message_type: GroupMessageType,
        /// Message content
        content: String,
        /// ID of message being replied to (for threading)
        reply_to: Option<String>,
        /// List of mentioned usernames
        mentions: Option<Vec<String>>,
    },

    /// Edit an existing group message
    EditGroupMessage {
        group_id: String,
        message_id: String,
        new_content: String,
    },

    /// Delete a group message
    DeleteGroupMessage {
        group_id: String,
        message_id: String,
    },

    /// Get paginated message history for a group
    GetGroupMessages {
        group_id: String,
        /// Get messages before this timestamp (for pagination)
        before_timestamp: Option<u64>,
        /// Maximum number of messages to return
        limit: Option<u32>,
    },

    /// Get all replies to a specific message (thread view)
    GetThreadMessages {
        group_id: String,
        /// The parent message ID
        parent_message_id: String,
    },

    /// Add (`on`) or retract the requester's `emoji` on a message (one of `REACTION_EMOJIS`)
    ReactGroupMessage {
        group_id: String,
        message_id: String,
        emoji: String,
        on: bool,
    },

    /// The requester has read every message up to and including `upto_message_id`
    MarkGroupRead {
        group_id: String,
        upto_message_id: String,
    },

    /// The requester is typing in the channel; relayed to its readers, never stored
    GroupTyping {
        group_id: String,
    },

    // ========== Server Capabilities ==========
    /// Query server file transfer and storage capabilities.
    /// Returns configuration limits for RE-VFS storage, file transfers, etc.
    GetServerCapabilities,

    /// Ask for short-lived relay (TURN) servers for this member's peer connections.
    ///
    /// Answered with `IceServers` for an enrolled member, and otherwise with
    /// `IceServersUnavailable`: for a Guest, a removed account or a non-member (never `Error`,
    /// which a client shows as a failed operation), or when the server has no relay to offer or
    /// its host declines to mint (not configured, the plan's relay is used up, too many
    /// requests). A client that gets no servers falls back to direct connections.
    GetIceServers,

    // ========== Sign-in ==========
    /// Read this workspace's sign-in settings (`sign_in::SignInSettings`). Any member may read
    /// them; whether a check is required is public anyway (the host's discovery endpoint says
    /// so to anyone about to sign in). A server whose host keeps no such settings answers
    /// `Error`.
    GetSignInSettings,

    /// Replace this workspace's sign-in settings. Admin only: the Admin role, not a permission a
    /// Custom role can be granted, since it decides who can get in at all.
    UpdateSignInSettings {
        settings: SignInSettings,
    },

    // ========== Plan & billing ==========
    /// Open this workspace's billing portal (`billing`). For whoever holds EditWorkspaceConfig at
    /// the workspace root, decided from the session's own account; anyone else is refused with
    /// `Error`. Answered with `BillingPortal`, or `Error` from a server with no billing host.
    OpenBillingPortal,

    // ========== Generic Tree Node Operations ==========
    /// Create a new node in the workspace hierarchy tree.
    /// If parent_id is None, creates at workspace root level.
    CreateNode {
        parent_id: Option<String>,
        entity_type: NodeEntityType,
        name: String,
        description: String,
        /// The node's metadata document: a JSON object whose top-level keys belong to
        /// independent features (the Citadel App a document opens in is one). The client
        /// already sent this field and serde dropped it, so every node was created with
        /// empty metadata. Absent means empty; anything else must be a JSON object.
        #[debug(with = bytes_opt_debug_fmt)]
        metadata: Option<Vec<u8>>,
    },

    /// Get a specific node by ID
    GetNode {
        node_id: String,
    },

    /// Set the workspace theme every member sees.
    ///
    /// Separate from UpdateWorkspace because that requires the workspace master
    /// password — the right gate for renaming or deleting a workspace, and the
    /// wrong one for changing a colour. This is gated on Permission::Themes
    /// instead, so an authorised member can edit the appearance without holding
    /// the credential that lets them destroy the workspace.
    UpdateWorkspaceTheme {
        /// None targets the root workspace, matching UpdateWorkspace.
        workspace_id: Option<String>,
        /// The serialized theme envelope. The server merges it into the
        /// workspace's metadata under a `theme` key rather than storing it as
        /// the whole document — metadata is shared with other features, and
        /// overwriting it erased the initialisation marker.
        #[ts(type = "number[]")]
        theme: Vec<u8>,
    },

    /// Rename the workspace, describe it, or change its icon.
    ///
    /// Separate from UpdateWorkspace for the reason UpdateWorkspaceTheme is: that
    /// request demands the workspace master password, the credential that also
    /// claims and deletes the workspace, and an owner renaming their workspace
    /// should not have to hold it. Gated on Permission::UpdateWorkspace instead.
    /// Writes only these fields and the `logo` metadata key; members, owner,
    /// roles, `initialized` and `theme` are never touched.
    UpdateWorkspaceProfile {
        /// None targets the root workspace, matching UpdateWorkspace.
        workspace_id: Option<String>,
        name: Option<String>,
        description: Option<String>,
        /// None leaves the icon as it is.
        logo: Option<structs::WorkspaceLogoChange>,
    },

    /// Update an existing node's properties
    UpdateNode {
        node_id: String,
        name: Option<String>,
        description: Option<String>,
        mdx_content: Option<String>,
        rules: Option<String>,
        chat_enabled: Option<bool>,
        /// Make this the node the workspace opens on.
        ///
        /// The client had a "Set as default" menu item that sent `is_default`
        /// in this request. There was no such field, serde ignores unknown
        /// keys, the write succeeded, and the toast said "X is now the default"
        /// while nothing changed — the old default came back on reload. The
        /// field the client was already sending now exists and is honoured.
        ///
        /// Exactly one node is the default, so setting it clears the others.
        is_default: Option<bool>,
        /// A JSON object merged key by key into the node's metadata (`node_tabs`): `app_tabs`
        /// and `time_zone` are checked, `null` under either removes it (the node then follows
        /// the workspace), `citadel_app` may not change, any other key is kept as sent. Needs
        /// `UpdateNodeSettings` on the node.
        #[ts(optional)]
        #[debug(with = bytes_opt_debug_fmt)]
        metadata: Option<Vec<u8>>,
    },

    /// Set the app tabs a node shows when it has no list of its own (`node_tabs`): the root
    /// workspace's `default_app_tabs`, at most eight distinct app ids, in order; empty means
    /// none. Needs `EditWorkspaceConfig`, not the master password `UpdateWorkspace` demands.
    /// Answered, and announced to the members, with the workspace.
    SetDefaultAppTabs {
        app_tabs: Vec<String>,
    },

    /// Switch "Members can see each other" on a node. Admin only.
    ///
    /// Stored as the node's `default_permissions.view_members`. Off, it takes
    /// `ViewMembers` from every non-admin on this node and on every node below
    /// it; admins and owners are unaffected. Separate from UpdateNode because
    /// its gate is the Admin role, not a permission a Custom role can hold.
    SetMembersVisible {
        node_id: String,
        visible: bool,
    },

    /// Delete a node. If cascade is true, also deletes all descendants.
    DeleteNode {
        node_id: String,
        cascade: bool,
    },

    /// Move a node to a new parent. If new_parent_id is None, moves to root level.
    MoveNode {
        node_id: String,
        new_parent_id: Option<String>,
    },

    /// List nodes with optional filtering.
    ///
    /// If `parent_id` is `None`, lists from workspace root.
    ///
    /// Depth semantics:
    ///
    /// - `Some(0)` returns only direct children.
    /// - `Some(n)` returns descendants up to n additional levels.
    /// - `None` returns ALL descendants (unlimited depth). This is the
    ///   intentional default used by the workspace UI so that nodes
    ///   beyond the immediate children (e.g. rooms) are surfaced in a
    ///   single round trip. The server applies a visited-set guard so
    ///   cycles or duplicate child refs cannot cause unbounded traversal.
    ///
    /// Caution: `None` returns the full subtree with no hard cap on
    /// result set size. The kernel emits a diagnostic warning past
    /// 1000 nodes but does not refuse the request, so a single
    /// ListNodes can serialize an arbitrarily large tree into one
    /// WebSocket frame. This is acceptable at the current
    /// per-workspace scale (typical workspaces are well under 1000
    /// nodes). If workspaces are expected to grow past tens of
    /// thousands of nodes, callers should switch to `Some(n)` and
    /// paginate.
    ///
    /// If `entity_types` is provided, filters to only those types.
    ListNodes {
        parent_id: Option<String>,
        depth: Option<u32>,
        entity_types: Option<Vec<NodeEntityType>>,
    },

    // ========== Tree Structure Operations ==========
    /// Get the full tree structure starting from a node.
    /// If root_id is None, starts from workspace root.
    /// max_depth limits how deep to traverse (None = unlimited).
    GetTreeStructure {
        root_id: Option<String>,
        max_depth: Option<u32>,
    },

    /// Get the current tree schema (nesting rules)
    GetTreeSchema,

    /// Update the tree schema (admin only)
    UpdateTreeSchema {
        schema: TreeSchema,
    },

    // ========== Custom Node Type Operations ==========
    /// Create a new custom node type
    CreateNodeType {
        name: String,
        display_name: String,
        icon: Option<String>,
        allowed_parents: Vec<String>,
    },

    /// List all available node types (built-in and custom)
    ListNodeTypes,

    /// Terms, consent and the Telemetry Service; see `telemetry`.
    Telemetry(telemetry::TelemetryRequest),

    /// Who connects without asking; see `messaging_trust`.
    MessagingTrust(messaging_trust::MessagingTrustRequest),

    /// The workspace's role table; see `roles`.
    Roles(roles_protocol::RolesRequest),

    /// A document node's update log, snapshot and awareness; see `documents`.
    Documents(documents::DocumentsRequest),
    /// A document shared in a node's chat; see `chat_documents`.
    ChatDocuments(chat_documents::ChatDocumentsRequest),
    /// A file shared in a node's chat; see `chat_attachments`.
    ChatAttachments(chat_attachments::ChatAttachmentsRequest),
    /// Secure links; see `secure_links`.
    SecureLinks(secure_links::SecureLinksRequest),
    /// Citadel Apps: listings, installs and their artifacts; see `apps_protocol`.
    Apps(apps_protocol::AppsRequest),
    /// Prove this server holds the key the client pinned; see `server_identity`.
    ServerIdentityChallenge(server_identity::ServerIdentityChallenge),
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum WorkspaceProtocolResponse {
    Workspace(Workspace),
    /// List of workspaces the user has access to (for multi-workspace support)
    Workspaces(Vec<WorkspaceMetadata>),
    Success(String),
    Error(String),
    WorkspaceNotInitialized,
    /// The members of a domain, and WHICH domain they are.
    ///
    /// The domain used to be absent, and the protocol carries no request id, so
    /// a response could not be attributed to the request that asked for it. Four
    /// separate client subscribers each accepted any member list that arrived
    /// and took last-writer-wins: the sidebar, the admin members tab, the
    /// user-search corpus, and the group-call roster. A list fetched for one
    /// domain would render inside another, and the admin tab would then send
    /// role changes naming ITS entity with users taken from somebody else's.
    Members {
        domain_id: String,
        members: Vec<User>,
        /// Member id -> the level above (a node id, or the workspace id) whose
        /// membership gives them access here. Absent for people listed on this
        /// node directly.
        inherited_from: std::collections::HashMap<String, String>,
        /// The listed members a live booking link names as guests (Calendar design §3.6.4),
        /// derived from the link records on each call. Sent to callers holding ManageRoles only;
        /// empty for everyone else.
        guests: Vec<String>,
    },
    /// The roster of `domain_id` exists and an admin has hidden it from this
    /// caller (SetMembersVisible). Not an empty `Members`: an empty list claims
    /// nobody else is here.
    MembersHidden {
        domain_id: String,
    },
    Member(User),
    /// Response containing a user's role and permissions for a domain
    UserPermissions {
        domain_id: String,
        user_id: String,
        /// The role this user holds in the workspace, from its table; `None` when banned or
        /// not a member.
        role_id: Option<String>,
        permissions: Vec<Permission>,
    },
    /// Confirmation that member role was updated
    MemberRoleUpdated {
        user_id: String,
        /// The role id the member now holds; `None` when banned.
        role_id: Option<String>,
    },
    /// `user_id` was banned. Sent to the caller and announced to the workspace.
    MemberBanned {
        user_id: String,
    },
    /// `user_id`'s ban was lifted, and they now hold `role_id`. Sent to the caller and announced
    /// to the workspace.
    MemberUnbanned {
        user_id: String,
        role_id: String,
    },
    /// The answer to `ListBanned`: every banned account, by id.
    BannedMembers {
        members: Vec<User>,
    },

    /// Response after user profile was updated
    UserProfileUpdated(User),

    // ========== Content Broadcast Responses ==========
    /// Notification that a node's content was updated (broadcast to all workspace members)
    NodeContentUpdated {
        node_id: String,
        mdx_content: String,
        /// The content's SHA-256, so a watcher can verify what it just received.
        ///
        /// Without it, a watcher merged the new content over its cached node
        /// and kept the OLD hash — so the integrity check refused to render a
        /// document that had merely been edited by a colleague, and went on
        /// refusing until the reader navigated away and back. The verifier and
        /// this broadcast were built two rounds apart and their intersection
        /// was never exercised: ordinary collaborative editing was the trigger.
        mdx_content_hash: String,
        updated_by: String,
        #[ts(type = "bigint")]
        timestamp: u64,
    },

    // ========== Group Messaging Responses ==========
    /// Notification of a new group message (broadcast to all group members)
    GroupMessageNotification {
        group_id: String,
        message: GroupMessage,
    },

    /// Paginated list of group messages
    GroupMessages {
        group_id: String,
        messages: Vec<GroupMessage>,
        has_more: bool,
        /// How far each member has read, so ticks are right the moment the channel opens.
        read_cursors: Vec<group_chat::GroupReadCursor>,
    },

    /// A reaction changed on a stored message (broadcast to the channel's readers)
    GroupMessageReacted {
        group_id: String,
        message_id: String,
        /// The message's reactions after the change.
        reactions: Vec<group_chat::GroupReaction>,
    },

    /// A member's read cursor moved (broadcast to the channel's readers)
    GroupReadCursorMoved {
        group_id: String,
        cursor: group_chat::GroupReadCursor,
    },

    /// A member is typing (relayed to the channel's readers; never stored)
    GroupTypingNotice {
        group_id: String,
        member: String,
    },

    /// Notification that a message was edited
    GroupMessageEdited {
        group_id: String,
        message_id: String,
        new_content: String,
        #[ts(type = "bigint")]
        edited_at: u64,
    },

    /// Notification that a message was deleted
    GroupMessageDeleted {
        group_id: String,
        message_id: String,
        deleted_by: String,
    },

    /// Single group message response
    GroupMessage(GroupMessage),

    // ========== Server Capabilities Response ==========
    /// Server file transfer and storage capabilities
    ServerCapabilities {
        /// Whether server-mediated file transfers are enabled
        allow_server_file_transfer: bool,
        /// Why `allow_server_file_transfer` is false; absent when it is true.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        file_transfer_refusal: Option<server_feature_refusal::ServerFeatureRefusal>,
        /// Whether RE-VFS (server-side encrypted storage) is enabled
        allow_server_revfs_storage: bool,
        /// Why `allow_server_revfs_storage` is false; absent when it is true.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        revfs_storage_refusal: Option<server_feature_refusal::ServerFeatureRefusal>,
        /// Maximum file size for transfers (in megabytes)
        #[ts(type = "bigint")]
        max_file_transfer_size_mb: u64,
        /// RE-VFS storage quota per user (in megabytes)
        #[ts(type = "bigint")]
        revfs_storage_quota_mb: u64,
    },

    /// Relay servers for this member, valid until `expires_at` (unix seconds). Ask again
    /// before then; the server may hand back the same credentials until they near expiry.
    IceServers {
        ice_servers: Vec<IceServer>,
        #[ts(type = "bigint")]
        expires_at: u64,
    },

    /// No relay servers are available to this member now, and why.
    IceServersUnavailable {
        reason: String,
    },

    /// This workspace's sign-in settings, as stored now.
    SignInSettings(SignInSettings),

    /// The answer to an admitted `OpenBillingPortal`, to the caller alone.
    BillingPortal(billing::BillingPortalAnswer),

    // ========== Tree Node Responses ==========
    /// Single node response
    Node(DomainNode),

    /// List of nodes response
    Nodes(Vec<DomainNode>),

    /// Full tree structure with nested children
    TreeStructure {
        root: TreeNode,
    },

    /// Tree schema (nesting rules) response
    TreeSchema(TreeSchema),

    /// List of available node types
    NodeTypes(Vec<CustomNodeType>),

    /// Confirmation that a node was deleted
    NodeDeleted {
        node_id: String,
        /// IDs of child nodes that were also deleted (if cascade was true)
        children_deleted: Vec<String>,
    },

    /// Confirmation that a node was moved
    NodeMoved {
        node_id: String,
        old_parent_id: Option<String>,
        new_parent_id: Option<String>,
    },

    // ========== Server Lifecycle Events ==========
    /// Broadcast to every connected client when the server is shutting down
    /// gracefully (e.g. deploy, planned restart). Distinct from `Error` so
    /// clients can render an informational reconnect-banner / countdown
    /// instead of a red error toast.
    ///
    /// `drain_seconds` is the upper bound on how long the server will keep
    /// servicing in-flight requests before terminating; a UI can use it to
    /// time a reconnect attempt or display "back in N seconds".
    ServerShutdown {
        message: String,
        #[ts(type = "bigint")]
        drain_seconds: u64,
    },

    Telemetry(telemetry::TelemetryResponse),

    MessagingTrust(messaging_trust::MessagingTrustResponse),

    Roles(roles_protocol::RolesResponse),

    Documents(documents::DocumentsResponse),
    ChatDocuments(chat_documents::ChatDocumentsResponse),
    ChatAttachments(chat_attachments::ChatAttachmentsResponse),
    SecureLinks(secure_links::SecureLinksResponse),
    Apps(apps_responses::AppsResponse),
    /// The answer to `ServerIdentityChallenge`.
    ServerIdentity(server_identity::ServerIdentity),
}

/// Type of group message
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
pub enum GroupMessageType {
    /// Plain text message
    Text,
    /// Markdown formatted message
    Markdown,
    /// System message (user joined, settings changed, etc.)
    System,
    /// Shares a live document in the channel (`chat_documents`); the message's `content` is its
    /// title, so an edit of the message is the one way the title changes.
    LiveDocument { document_id: String },
    /// Shares a file kept on the workspace server under the node (`chat_attachments`). The
    /// server stores it only when the sender uploaded `attachment_id` at this channel's node and
    /// `size_bytes` is its size; `name` and `mime` are the sender's, shown and checked for shape.
    FileShare {
        attachment_id: String,
        name: String,
        #[ts(type = "bigint")]
        size_bytes: u64,
        mime: String,
    },
}

/// A message in a group chat channel
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GroupMessage {
    /// Unique message ID
    pub id: String,
    /// Group channel ID this message belongs to
    pub group_id: String,
    /// User ID of the sender
    pub sender_id: String,
    /// Display name of the sender
    pub sender_name: String,
    /// Type of message
    pub message_type: GroupMessageType,
    /// Message content
    pub content: String,
    /// Unix timestamp in milliseconds
    #[ts(type = "bigint")]
    pub timestamp: u64,
    /// ID of parent message if this is a thread reply
    pub reply_to: Option<String>,
    /// Number of replies to this message
    pub reply_count: u32,
    /// List of mentioned usernames
    pub mentions: Vec<String>,
    /// Unix timestamp of last edit (None if never edited)
    #[ts(type = "bigint | null")]
    pub edited_at: Option<u64>,
    /// Reactions, retractions included. Omitted when empty, so an absent list is empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(as = "Option<Vec<group_chat::GroupReaction>>", optional)]
    pub reactions: Vec<group_chat::GroupReaction>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum PermissionEndowOperation {
    // Adds the associated permissions to the user
    Add,
    // Removes the associated permissions from the user
    Remove,
    // Completely overwrites any existing permissions with the newly provided permissions
    Replace,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum UpdateOperation {
    // Adds the associated permissions to the user
    Add,
    // Sets the existing permissions to the new permissions. This overwrites any existing permissions
    Set,
    // Removes the associated permissions from the user
    Remove,
}
