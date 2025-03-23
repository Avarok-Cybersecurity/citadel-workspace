use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::cmp::Ordering;
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
    pub fn get_permissions<T: AsRef<str>>(&self, domain_id: T) -> Option<&HashSet<Permission>> {
        self.permissions.get(domain_id.as_ref())
    }

    pub fn is_member_of_domain<T: AsRef<str>>(&self, domain_id: T) -> bool {
        self.permissions.contains_key(domain_id.as_ref())
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
            roles: vec![UserRole::Admin, UserRole::Owner, UserRole::Member, UserRole::Guest, UserRole::Banned]
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
        if rank == ADMIN_RANK || rank == OWNER_RANK || rank == MEMBER_RANK || rank == GUEST_RANK || rank == BANNED_RANK {
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum Permission {
    EditMdx,
    EditRoomConfig,
    EditOfficeConfig,
    EditMemberConfig,
    AddOffice,
    AddRoom,
}

// Workspace entity structures
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Office {
    pub id: String,
    pub name: String,
    pub description: String,
    pub owner_id: String,
    pub members: Vec<String>, // User IDs
    pub rooms: Vec<String>, // Room IDs
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