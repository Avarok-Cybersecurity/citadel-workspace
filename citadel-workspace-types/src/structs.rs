use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fmt;

// User management structures
#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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

#[derive(Debug, Copy, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
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

/// Metadata field for storing flexible data used by the frontend
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MetadataField {
    pub key: String,
    pub value: MetadataValue,
}

/// Value types for metadata fields
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub description: String,
    pub owner_id: String,
    pub members: Vec<String>,
    pub offices: Vec<String>,
    pub metadata: Vec<u8>,
    pub password_protected: bool,
}

impl Workspace {
    // ...
}

// Workspace entity structures
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct Office {
    pub id: String,
    pub owner_id: String,
    pub workspace_id: String, // Added field to link to parent workspace
    pub name: String,
    pub description: String,
    // workspace_id field added - all offices belong to the single workspace
    pub members: Vec<String>, // User IDs
    pub rooms: Vec<String>,   // Room IDs
    pub mdx_content: String,
    // Can be used to add any type of data by the UI
    pub metadata: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Room {
    pub id: String,
    pub owner_id: String,
    pub office_id: String,
    pub name: String,
    pub description: String,
    pub members: Vec<String>, // User IDs
    pub mdx_content: String,
    pub metadata: Vec<MetadataField>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
