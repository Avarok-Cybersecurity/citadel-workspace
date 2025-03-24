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
}

impl User {
    /// Create a new user with the given role
    pub fn new(id: String, name: String, role: UserRole) -> Self {
        Self {
            id,
            name,
            role,
            permissions: HashMap::new(),
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
    pub fn grant_permission<T: AsRef<str>>(&mut self, domain_id: T, permission: Permission) {
        let domain_id = domain_id.as_ref().to_string();
        self.permissions
            .entry(domain_id)
            .or_default()
            .insert(permission);
    }

    /// Revoke a permission from the user for a specific domain
    pub fn revoke_permission<T: AsRef<str>>(&mut self, domain_id: T, permission: Permission) {
        if let Some(perms) = self.permissions.get_mut(domain_id.as_ref()) {
            perms.remove(&permission);
        }
    }

    /// Set all permissions for a domain based on the user's role
    pub fn set_role_permissions<T: AsRef<str>>(&mut self, domain_id: T) {
        let domain_id = domain_id.as_ref().to_string();
        let role_permissions = Permission::for_role(&self.role);
        self.permissions.insert(domain_id, role_permissions);
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
    Custom { name: String, rank: u8 },
}

impl fmt::Display for UserRole {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            UserRole::Admin => write!(f, "Admin"),
            UserRole::Owner => write!(f, "Owner"),
            UserRole::Member => write!(f, "Member"),
            UserRole::Guest => write!(f, "Guest"),
            UserRole::Banned => write!(f, "Banned"),
            UserRole::Custom { name, .. } => write!(f, "{}", name),
        }
    }
}

const ADMIN_RANK: u8 = u8::MAX;
const OWNER_RANK: u8 = 20;
const MEMBER_RANK: u8 = 10;
const GUEST_RANK: u8 = 5;
const BANNED_RANK: u8 = 0;

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
            UserRole::Custom { rank, .. } => *rank,
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

        Some(UserRole::Custom { name, rank })
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
    // Basic permissions (existing)
    EditMdx,
    EditRoomConfig,
    EditOfficeConfig,
    EditMemberConfig,
    AddOffice,
    AddRoom,

    // Domain entity permissions
    CreateEntity, // Can create entities (general permission)
    ViewContent,  // Can view content of rooms and offices

    // Office-specific permissions
    CreateRoom,           // Can create rooms within an office
    ManageOfficeMembers,  // Can add/remove members to/from an office
    UpdateOfficeSettings, // Can update office settings (name, description, etc.)
    DeleteOffice,         // Can delete the office
    ViewOfficeMetrics,    // Can view office usage metrics

    // Room-specific permissions
    ManageRoomMembers,  // Can add/remove members to/from a room
    UpdateRoomSettings, // Can update room settings (name, description, etc.)
    DeleteRoom,         // Can delete the room
    SendMessages,       // Can send messages in the room
    ReadMessages,       // Can read messages in the room
    UploadFiles,        // Can upload files to the room
    DownloadFiles,      // Can download files from the room

    // Administrative permissions
    ManageDomains,   // Can create/delete domains
    ManageUsers,     // Can manage users across all domains
    ViewSystemLogs,  // Can view system logs
    ConfigureSystem, // Can configure system settings

    // Special permissions
    All, // Has all permissions
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
                permissions.insert(Self::EditOfficeConfig);
                permissions.insert(Self::EditMemberConfig);
                permissions.insert(Self::AddRoom);
                permissions.insert(Self::CreateRoom);
                permissions.insert(Self::ManageOfficeMembers);
                permissions.insert(Self::UpdateOfficeSettings);
                permissions.insert(Self::DeleteOffice);
                permissions.insert(Self::ViewOfficeMetrics);

                // Room permissions
                permissions.insert(Self::EditRoomConfig);
                permissions.insert(Self::EditMdx);
                permissions.insert(Self::ManageRoomMembers);
                permissions.insert(Self::UpdateRoomSettings);
                permissions.insert(Self::DeleteRoom);
                permissions.insert(Self::SendMessages);
                permissions.insert(Self::ReadMessages);
                permissions.insert(Self::UploadFiles);
                permissions.insert(Self::DownloadFiles);
            }
            UserRole::Member => {
                // Basic member permissions
                permissions.insert(Self::SendMessages);
                permissions.insert(Self::ReadMessages);
                permissions.insert(Self::UploadFiles);
                permissions.insert(Self::DownloadFiles);
            }
            UserRole::Guest => {
                // Guest permissions - read-only access
                permissions.insert(Self::ReadMessages);
                permissions.insert(Self::DownloadFiles);
            }
            UserRole::Banned => {
                // No permissions for banned users
            }
            UserRole::Custom { rank, .. } => {
                // Custom role permissions based on rank
                // Basic permissions for all custom roles
                permissions.insert(Self::ReadMessages);

                // Additional permissions based on rank
                if *rank > 10 {
                    permissions.insert(Self::SendMessages);
                    permissions.insert(Self::UploadFiles);
                    permissions.insert(Self::DownloadFiles);
                }

                if *rank > 15 {
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

// Workspace entity structures
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Office {
    pub id: String,
    pub name: String,
    pub description: String,
    pub owner_id: String,
    pub members: Vec<String>, // User IDs
    pub rooms: Vec<String>,   // Room IDs
    pub mdx_content: String,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Domain {
    Office { office: Office },
    Room { room: Room },
}

impl Domain {
    pub fn id(&self) -> &str {
        match self {
            Domain::Office { office } => &office.id,
            Domain::Room { room } => &room.id,
        }
    }

    pub fn name(&self) -> &str {
        match self {
            Domain::Office { office } => &office.name,
            Domain::Room { room } => &room.name,
        }
    }

    pub fn description(&self) -> &str {
        match self {
            Domain::Office { office } => &office.description,
            Domain::Room { room } => &room.description,
        }
    }

    pub fn owner_id(&self) -> &str {
        match self {
            Domain::Office { office } => &office.owner_id,
            Domain::Room { room } => &room.owner_id,
        }
    }

    pub fn members(&self) -> &Vec<String> {
        match self {
            Domain::Office { office } => &office.members,
            Domain::Room { room } => &room.members,
        }
    }

    pub fn mdx_content(&self) -> &str {
        match self {
            Domain::Office { office } => &office.mdx_content,
            Domain::Room { room } => &room.mdx_content,
        }
    }

    /// Update the name of this domain
    pub fn update_name(&mut self, name: String) {
        match self {
            Domain::Office { office } => office.name = name,
            Domain::Room { room } => room.name = name,
        }
    }

    /// Update the description of this domain
    pub fn update_description(&mut self, description: String) {
        match self {
            Domain::Office { office } => office.description = description,
            Domain::Room { room } => room.description = description,
        }
    }

    /// Get the parent ID of this domain (for rooms, this is the office ID)
    pub fn parent_id(&self) -> &str {
        match self {
            Domain::Office { .. } => "", // Offices don't have a parent
            Domain::Room { room } => &room.office_id,
        }
    }

    /// Update the members of this domain
    pub fn set_members(&mut self, members: Vec<String>) {
        match self {
            Domain::Office { office } => office.members = members,
            Domain::Room { room } => room.members = members,
        }
    }
}
