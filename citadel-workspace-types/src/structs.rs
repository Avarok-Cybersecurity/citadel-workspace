use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fmt;
use ts_rs::TS;
use custom_debug::Debug;

// User management structures
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct User {
    pub id: String,
    pub name: String,
    pub role: UserRole,
    // Permissions are a map of domain IDs to sets of permissions
    pub permissions: HashMap<String, HashSet<Permission>>,
    pub metadata: HashMap<String, MetadataValue>,
}

impl User {
    /// Create a new user with the given role
    pub fn new(id: String, name: String, role: UserRole) -> Self {
        Self {
            id,
            name,
            role,
            permissions: HashMap::new(),
            metadata: HashMap::new(),
        }
    }

    /// Get permissions for a specific domain
    pub fn get_permissions<T: AsRef<str>>(&self, domain_id: T) -> Option<&HashSet<Permission>> {
        self.permissions.get(domain_id.as_ref())
    }

    /// Check if user is a member of a domain
    pub fn is_member_of_domain<T: AsRef<str>>(&self, domain_id: T) -> bool {
        self.permissions.contains_key(domain_id.as_ref())
    }

    /// Check if user has a specific permission in a domain
    pub fn has_permission<T: AsRef<str>>(&self, domain_id: T, permission: Permission) -> bool {
        if let Some(perms) = self.get_permissions(domain_id) {
            Permission::has_permission(perms, &permission)
        } else {
            false
        }
    }

    /// Check if user has all of the required permissions in a domain
    pub fn has_all_permissions<T: AsRef<str>>(
        &self,
        domain_id: T,
        required: &[Permission],
    ) -> bool {
        if let Some(perms) = self.get_permissions(domain_id) {
            Permission::has_all_permissions(perms, required)
        } else {
            false
        }
    }

    /// Check if user has any of the specified permissions in a domain
    pub fn has_any_permission<T: AsRef<str>>(&self, domain_id: T, required: &[Permission]) -> bool {
        if let Some(perms) = self.get_permissions(domain_id) {
            Permission::has_any_permission(perms, required)
        } else {
            false
        }
    }

    /// Check if user has administrator role
    pub fn is_administrator(&self) -> bool {
        matches!(self.role, UserRole::Admin)
    }

    /// Grant a permission to the user for a specific domain
    pub fn grant_permission<T: Into<String>>(&mut self, domain_id: T, permission: Permission) {
        // Use into() which is more efficient for owned strings and only clones when necessary
        self.permissions
            .entry(domain_id.into())
            .or_default()
            .insert(permission);
    }

    /// Add a permission to the user for a specific domain (alias for grant_permission)
    pub fn add_permission<T: Into<String>>(&mut self, domain_id: T, permission: Permission) {
        self.grant_permission(domain_id, permission);
    }

    /// Revoke a permission from the user for a specific domain
    pub fn revoke_permission<T: AsRef<str>>(&mut self, domain_id: T, permission: Permission) {
        if let Some(perms) = self.permissions.get_mut(domain_id.as_ref()) {
            perms.remove(&permission);
        }
    }

    /// Clear all permissions for a specific domain
    pub fn clear_permissions<T: AsRef<str>>(&mut self, domain_id: T) {
        self.permissions.remove(domain_id.as_ref());
    }

    /// Set all permissions for a domain based on the user's role
    pub fn set_role_permissions<T: AsRef<str> + Into<String>>(&mut self, domain_id: T) {
        let role_permissions = Permission::for_role(&self.role);
        self.permissions.insert(domain_id.into(), role_permissions);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
#[allow(dead_code)]
pub enum UserRole {
    Admin,
    Owner,
    Member,
    Guest,
    Banned,
    Custom(String, u8),
}

impl fmt::Display for UserRole {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            UserRole::Admin => write!(f, "Admin"),
            UserRole::Owner => write!(f, "Owner"),
            UserRole::Member => write!(f, "Member"),
            UserRole::Guest => write!(f, "Guest"),
            UserRole::Banned => write!(f, "Banned"),
            UserRole::Custom(name, _) => write!(f, "{}", name),
        }
    }
}

const ADMIN_RANK: u8 = u8::MAX;
const OWNER_RANK: u8 = 20;
const MEMBER_RANK: u8 = 10;
const GUEST_RANK: u8 = 5;
const BANNED_RANK: u8 = 0;

// Custom role thresholds
const CUSTOM_BASIC_THRESHOLD: u8 = 10;
const CUSTOM_EDITOR_THRESHOLD: u8 = 15;

pub struct WorkspaceRoles {
    // Mapping from the name to the user role
    pub roles: HashMap<String, UserRole>,
}

impl WorkspaceRoles {
    pub fn new() -> Self {
        Self {
            roles: vec![
                UserRole::Admin,
                UserRole::Owner,
                UserRole::Member,
                UserRole::Guest,
                UserRole::Banned,
            ]
            .into_iter()
            .map(|role| (role.to_string(), role))
            .collect(),
        }
    }
}

impl Default for WorkspaceRoles {
    fn default() -> Self {
        Self::new()
    }
}

impl UserRole {
    pub fn get_rank(&self) -> u8 {
        match self {
            UserRole::Admin => ADMIN_RANK,
            UserRole::Owner => OWNER_RANK,
            UserRole::Member => MEMBER_RANK,
            UserRole::Guest => GUEST_RANK,
            UserRole::Banned => BANNED_RANK,
            UserRole::Custom(_, rank) => *rank,
        }
    }

    /// Creates a custom user role with a given name and rank.
    pub fn create_custom_role(name: String, rank: u8) -> Option<Self> {
        if rank == ADMIN_RANK
            || rank == OWNER_RANK
            || rank == MEMBER_RANK
            || rank == GUEST_RANK
            || rank == BANNED_RANK
        {
            return None;
        }

        Some(UserRole::Custom(name, rank))
    }
}

impl Ord for UserRole {
    fn cmp(&self, other: &Self) -> Ordering {
        self.get_rank().cmp(&other.get_rank())
    }
}

impl PartialOrd for UserRole {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Debug, Copy, Clone, Serialize, Deserialize, PartialEq, Eq, Hash, TS)]
#[ts(export)]
pub enum Permission {
    // All permissions
    All,
    // Create a room
    CreateRoom,
    // Delete a room
    DeleteRoom,
    // Update a room
    UpdateRoom,
    // Create an office
    CreateOffice,
    // Delete an office
    DeleteOffice,
    // Update an office
    UpdateOffice,
    // Create a workspace
    CreateWorkspace,
    // Update a workspace
    UpdateWorkspace,
    // Delete a workspace
    DeleteWorkspace,
    // Edit content
    EditContent,
    // Add users
    AddUsers,
    // Remove users
    RemoveUsers,
    // Edit MDX content
    EditMdx,
    // Edit room configuration
    EditRoomConfig,
    // Edit office configuration
    EditOfficeConfig,
    // Add an office
    AddOffice,
    // Add a room
    AddRoom,
    // Update office settings
    UpdateOfficeSettings,
    // Update room settings
    UpdateRoomSettings,
    // View content
    ViewContent,
    // Manage office members
    ManageOfficeMembers,
    // Manage room members
    ManageRoomMembers,
    // Send messages
    SendMessages,
    // Read messages
    ReadMessages,
    // Upload files
    UploadFiles,
    // Download files
    DownloadFiles,
    // Manage domains (admin permission)
    ManageDomains,
    // Configure system (admin permission)
    ConfigureSystem,
    // Edit workspace configuration
    EditWorkspaceConfig,
    // Ban a user from a domain
    BanUser,
}

impl Permission {
    /// Get a set of permissions for a specific role
    pub fn for_role(role: &UserRole) -> HashSet<Self> {
        let mut permissions = HashSet::new();

        match role {
            UserRole::Admin => {
                permissions.insert(Self::All);
            }
            UserRole::Owner => {
                // Office permissions
                permissions.insert(Self::EditContent);
                permissions.insert(Self::AddUsers);
                permissions.insert(Self::RemoveUsers);
                permissions.insert(Self::CreateRoom);
                permissions.insert(Self::DeleteRoom);
                permissions.insert(Self::CreateOffice);
                permissions.insert(Self::DeleteOffice);
                permissions.insert(Self::CreateWorkspace);
                permissions.insert(Self::DeleteWorkspace);
            }
            UserRole::Member => {
                // Basic member permissions
                permissions.insert(Self::ViewContent);
                permissions.insert(Self::EditContent);
                permissions.insert(Self::SendMessages);
                permissions.insert(Self::ReadMessages);
                permissions.insert(Self::UploadFiles);
                permissions.insert(Self::DownloadFiles);
            }
            UserRole::Guest => {
                // Guest permissions - read-only access
                permissions.insert(Self::ViewContent);
            }
            UserRole::Banned => {
                // No permissions for banned users
            }
            UserRole::Custom(_, rank) => {
                // Custom role permissions based on rank
                // Basic permissions for all custom roles
                permissions.insert(Self::ViewContent);
                permissions.insert(Self::ReadMessages);

                // Additional permissions based on rank
                if *rank > CUSTOM_BASIC_THRESHOLD {
                    permissions.insert(Self::EditContent);
                    permissions.insert(Self::SendMessages);
                    permissions.insert(Self::UploadFiles);
                    permissions.insert(Self::DownloadFiles);
                }

                if *rank > CUSTOM_EDITOR_THRESHOLD {
                    permissions.insert(Self::AddUsers);
                    permissions.insert(Self::RemoveUsers);
                    permissions.insert(Self::EditMdx);
                }
            }
        }

        permissions
    }

    /// Check if a permission set has a specific permission
    pub fn has_permission(permissions: &HashSet<Self>, permission: &Self) -> bool {
        permissions.contains(&Self::All) || permissions.contains(permission)
    }

    /// Check if a permission set has all of the specified permissions
    pub fn has_all_permissions(permissions: &HashSet<Self>, required: &[Self]) -> bool {
        if permissions.contains(&Self::All) {
            return true;
        }

        required.iter().all(|p| permissions.contains(p))
    }

    /// Check if a permission set has any of the specified permissions
    pub fn has_any_permission(permissions: &HashSet<Self>, required: &[Self]) -> bool {
        if permissions.contains(&Self::All) {
            return true;
        }

        required.iter().any(|p| permissions.contains(p))
    }
}

/// Default permissions for a domain (Office or Room).
/// These define what actions are allowed by default for users in that domain.
/// Read operations default to `true`, write/admin operations default to `false`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash, TS)]
#[ts(export)]
pub struct DomainPermissions {
    // === Read Permissions (default: true) ===
    /// Whether users can view content in this domain
    pub view_content: bool,
    /// Whether users can read messages in group chat
    pub read_messages: bool,
    /// Whether users can download files
    pub download_files: bool,

    // === Write Permissions (default: false) ===
    /// Whether users can edit content (documents, etc.)
    pub edit_content: bool,
    /// Whether users can edit MDX content
    pub edit_mdx: bool,
    /// Whether users can send messages in group chat
    pub send_messages: bool,
    /// Whether users can upload files
    pub upload_files: bool,

    // === Room Management (default: false) ===
    /// Whether users can create rooms in this office
    pub create_room: bool,
    /// Whether users can delete rooms
    pub delete_room: bool,
    /// Whether users can update room settings
    pub update_room: bool,
    /// Whether users can add rooms
    pub add_room: bool,
    /// Whether users can edit room configuration
    pub edit_room_config: bool,
    /// Whether users can update room settings
    pub update_room_settings: bool,
    /// Whether users can manage room members
    pub manage_room_members: bool,

    // === Office Management (default: false) ===
    /// Whether users can create offices
    pub create_office: bool,
    /// Whether users can delete offices
    pub delete_office: bool,
    /// Whether users can update offices
    pub update_office: bool,
    /// Whether users can add offices
    pub add_office: bool,
    /// Whether users can edit office configuration
    pub edit_office_config: bool,
    /// Whether users can update office settings
    pub update_office_settings: bool,
    /// Whether users can manage office members
    pub manage_office_members: bool,

    // === Workspace Management (default: false) ===
    /// Whether users can create workspaces
    pub create_workspace: bool,
    /// Whether users can update workspaces
    pub update_workspace: bool,
    /// Whether users can delete workspaces
    pub delete_workspace: bool,
    /// Whether users can edit workspace configuration
    pub edit_workspace_config: bool,

    // === User Management (default: false) ===
    /// Whether users can add other users to this domain
    pub add_users: bool,
    /// Whether users can remove users from this domain
    pub remove_users: bool,
    /// Whether users can ban users from this domain
    pub ban_user: bool,

    // === System/Admin (default: false) ===
    /// Whether users can manage domains
    pub manage_domains: bool,
    /// Whether users can configure system settings
    pub configure_system: bool,
}

impl Default for DomainPermissions {
    fn default() -> Self {
        Self {
            // Read permissions - enabled by default
            view_content: true,
            read_messages: true,
            download_files: true,

            // Write permissions - disabled by default
            edit_content: false,
            edit_mdx: false,
            send_messages: false,
            upload_files: false,

            // Room management - disabled by default
            create_room: false,
            delete_room: false,
            update_room: false,
            add_room: false,
            edit_room_config: false,
            update_room_settings: false,
            manage_room_members: false,

            // Office management - disabled by default
            create_office: false,
            delete_office: false,
            update_office: false,
            add_office: false,
            edit_office_config: false,
            update_office_settings: false,
            manage_office_members: false,

            // Workspace management - disabled by default
            create_workspace: false,
            update_workspace: false,
            delete_workspace: false,
            edit_workspace_config: false,

            // User management - disabled by default
            add_users: false,
            remove_users: false,
            ban_user: false,

            // System/Admin - disabled by default
            manage_domains: false,
            configure_system: false,
        }
    }
}

impl DomainPermissions {
    /// Create a new DomainPermissions with default values
    pub fn new() -> Self {
        Self::default()
    }

    /// Create permissions with all read access enabled
    pub fn read_only() -> Self {
        Self::default()
    }

    /// Create permissions with read and basic write access (for members)
    pub fn member_access() -> Self {
        Self {
            edit_content: true,
            edit_mdx: true,
            send_messages: true,
            upload_files: true,
            ..Self::default()
        }
    }

    /// Create permissions with full access (for admins/owners)
    pub fn full_access() -> Self {
        Self {
            view_content: true,
            read_messages: true,
            download_files: true,
            edit_content: true,
            edit_mdx: true,
            send_messages: true,
            upload_files: true,
            create_room: true,
            delete_room: true,
            update_room: true,
            add_room: true,
            edit_room_config: true,
            update_room_settings: true,
            manage_room_members: true,
            create_office: true,
            delete_office: true,
            update_office: true,
            add_office: true,
            edit_office_config: true,
            update_office_settings: true,
            manage_office_members: true,
            create_workspace: true,
            update_workspace: true,
            delete_workspace: true,
            edit_workspace_config: true,
            add_users: true,
            remove_users: true,
            ban_user: true,
            manage_domains: true,
            configure_system: true,
        }
    }

    /// Check if a specific permission is granted
    pub fn has_permission(&self, permission: &Permission) -> bool {
        match permission {
            Permission::All => {
                // Check if all permissions are granted
                self.view_content
                    && self.read_messages
                    && self.download_files
                    && self.edit_content
                    && self.send_messages
                    && self.upload_files
                    && self.create_room
                    && self.delete_room
                    && self.manage_domains
                    && self.configure_system
            }
            Permission::ViewContent => self.view_content,
            Permission::ReadMessages => self.read_messages,
            Permission::DownloadFiles => self.download_files,
            Permission::EditContent => self.edit_content,
            Permission::EditMdx => self.edit_mdx,
            Permission::SendMessages => self.send_messages,
            Permission::UploadFiles => self.upload_files,
            Permission::CreateRoom => self.create_room,
            Permission::DeleteRoom => self.delete_room,
            Permission::UpdateRoom => self.update_room,
            Permission::AddRoom => self.add_room,
            Permission::EditRoomConfig => self.edit_room_config,
            Permission::UpdateRoomSettings => self.update_room_settings,
            Permission::ManageRoomMembers => self.manage_room_members,
            Permission::CreateOffice => self.create_office,
            Permission::DeleteOffice => self.delete_office,
            Permission::UpdateOffice => self.update_office,
            Permission::AddOffice => self.add_office,
            Permission::EditOfficeConfig => self.edit_office_config,
            Permission::UpdateOfficeSettings => self.update_office_settings,
            Permission::ManageOfficeMembers => self.manage_office_members,
            Permission::CreateWorkspace => self.create_workspace,
            Permission::UpdateWorkspace => self.update_workspace,
            Permission::DeleteWorkspace => self.delete_workspace,
            Permission::EditWorkspaceConfig => self.edit_workspace_config,
            Permission::AddUsers => self.add_users,
            Permission::RemoveUsers => self.remove_users,
            Permission::BanUser => self.ban_user,
            Permission::ManageDomains => self.manage_domains,
            Permission::ConfigureSystem => self.configure_system,
        }
    }
}

/// Metadata field for storing flexible data used by the frontend
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct MetadataField {
    pub key: String,
    pub value: MetadataValue,
}

/// Value types for metadata fields
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
#[serde(tag = "type", content = "content")]
pub enum MetadataValue {
    String(String),
    Number(f64),
    Boolean(bool),
    Array(Vec<MetadataValue>),
    Object(HashMap<String, MetadataValue>),
    Null,
}

/// A workspace is a container for offices
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub description: String,
    pub owner_id: String,
    pub members: Vec<String>,
    pub offices: Vec<String>,
    #[debug(with = citadel_internal_service_types::bytes_debug_fmt)]
    pub metadata: Vec<u8>,
}

impl Workspace {
    // ...
}

// Workspace entity structures
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash, TS)]
#[ts(export)]
pub struct Office {
    pub id: String,
    pub owner_id: String,
    pub workspace_id: String, // Added field to link to parent workspace
    pub name: String,
    pub description: String,
    // workspace_id field added - all offices belong to the single workspace
    pub members: Vec<String>, // User IDs
    pub rooms: Vec<String>,   // Room IDs
    #[debug(with = citadel_internal_service_types::bytes_debug_fmt)]
    pub mdx_content: String,
    /// Rules for this office (displayed to users)
    pub rules: Option<String>,
    /// Whether group chat is enabled for this office
    pub chat_enabled: bool,
    /// UUID for the group chat channel (assigned when chat_enabled is true)
    pub chat_channel_id: Option<String>,
    /// Default permissions for users in this office
    pub default_permissions: DomainPermissions,
    // Can be used to add any type of data by the UI
    #[debug(with = citadel_internal_service_types::bytes_debug_fmt)]
    pub metadata: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Room {
    pub id: String,
    pub owner_id: String,
    pub office_id: String,
    pub name: String,
    pub description: String,
    pub members: Vec<String>, // User IDs
    #[debug(with = citadel_internal_service_types::bytes_debug_fmt)]
    pub mdx_content: String,
    /// Rules for this room (displayed to users)
    pub rules: Option<String>,
    /// Whether group chat is enabled for this room
    pub chat_enabled: bool,
    /// UUID for the group chat channel (assigned when chat_enabled is true)
    pub chat_channel_id: Option<String>,
    /// Default permissions for users in this room
    pub default_permissions: DomainPermissions,
    pub metadata: Vec<MetadataField>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum Domain {
    Workspace { workspace: Workspace },
    Office { office: Office },
    Room { room: Room },
}

impl Domain {
    pub fn id(&self) -> &str {
        match self {
            Domain::Workspace { workspace } => &workspace.id,
            Domain::Office { office } => &office.id,
            Domain::Room { room } => &room.id,
        }
    }

    pub fn name(&self) -> &str {
        match self {
            Domain::Workspace { workspace } => &workspace.name,
            Domain::Office { office } => &office.name,
            Domain::Room { room } => &room.name,
        }
    }

    pub fn description(&self) -> &str {
        match self {
            Domain::Workspace { workspace } => &workspace.description,
            Domain::Office { office } => &office.description,
            Domain::Room { room } => &room.description,
        }
    }

    pub fn owner_id(&self) -> &str {
        match self {
            Domain::Workspace { workspace } => &workspace.owner_id,
            Domain::Office { office } => &office.owner_id,
            Domain::Room { room } => &room.owner_id,
        }
    }

    pub fn members(&self) -> &Vec<String> {
        match self {
            Domain::Workspace { workspace } => &workspace.members,
            Domain::Office { office } => &office.members,
            Domain::Room { room } => &room.members,
        }
    }

    pub fn mdx_content(&self) -> &str {
        match self {
            Domain::Workspace { .. } => "",
            Domain::Office { office } => &office.mdx_content,
            Domain::Room { room } => &room.mdx_content,
        }
    }

    /// Update the name of this domain
    pub fn update_name(&mut self, name: String) {
        match self {
            Domain::Workspace { workspace } => workspace.name = name,
            Domain::Office { office } => office.name = name,
            Domain::Room { room } => room.name = name,
        }
    }

    pub fn update_description(&mut self, description: String) {
        match self {
            Domain::Workspace { workspace } => workspace.description = description,
            Domain::Office { office } => office.description = description,
            Domain::Room { room } => room.description = description,
        }
    }

    /// Get the parent ID of this domain (for rooms, this is the office ID)
    pub fn parent_id(&self) -> &str {
        match self {
            Domain::Workspace { .. } => "", // Workspaces don't have a parent
            Domain::Office { office } => &office.workspace_id, // Offices belong to workspaces
            Domain::Room { room } => &room.office_id,
        }
    }

    /// Update the members of this domain
    pub fn set_members(&mut self, members: Vec<String>) {
        match self {
            Domain::Workspace { workspace } => workspace.members = members,
            Domain::Office { office } => office.members = members,
            Domain::Room { room } => room.members = members,
        }
    }

    /// Update the MDX content of this domain
    pub fn update_mdx_content(&mut self, mdx_content: String) {
        match self {
            Domain::Workspace { .. } => (), // Workspaces don't have MDX content
            Domain::Office { office } => office.mdx_content = mdx_content,
            Domain::Room { room } => room.mdx_content = mdx_content,
        }
    }

    pub fn as_workspace(&self) -> Option<&Workspace> {
        match self {
            Domain::Workspace { workspace } => Some(workspace),
            _ => None,
        }
    }

    pub fn as_workspace_mut(&mut self) -> Option<&mut Workspace> {
        match self {
            Domain::Workspace { workspace } => Some(workspace),
            _ => None,
        }
    }

    pub fn as_office(&self) -> Option<&Office> {
        match self {
            Domain::Office { office } => Some(office),
            _ => None,
        }
    }

    pub fn as_office_mut(&mut self) -> Option<&mut Office> {
        match self {
            Domain::Office { office } => Some(office),
            _ => None,
        }
    }

    pub fn as_room(&self) -> Option<&Room> {
        match self {
            Domain::Room { room } => Some(room),
            _ => None,
        }
    }

    pub fn as_room_mut(&mut self) -> Option<&mut Room> {
        match self {
            Domain::Room { room } => Some(room),
            _ => None,
        }
    }
}
