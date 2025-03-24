use std::collections::HashSet;
use serde::{Deserialize, Serialize};
use crate::structs::Permission;

/// Permission set for a user, containing their permissions
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PermissionSet {
    pub permissions: HashSet<Permission>,
}

impl PermissionSet {
    /// Create a new empty permission set
    pub fn new() -> Self {
        Self {
            permissions: HashSet::new(),
        }
    }

    /// Create a permission set with all capabilities
    pub fn all() -> Self {
        let mut set = Self::new();
        set.add(Permission::All);
        set
    }

    /// Create a permission set for a domain owner
    pub fn for_owner() -> Self {
        let mut set = Self::new();
        // Office capabilities
        set.add(Permission::CreateRoom);
        set.add(Permission::ManageOfficeMembers);
        set.add(Permission::UpdateOfficeSettings);
        set.add(Permission::DeleteOffice);
        set.add(Permission::ViewOfficeMetrics);
        
        // Room capabilities
        set.add(Permission::ManageRoomMembers);
        set.add(Permission::UpdateRoomSettings);
        set.add(Permission::DeleteRoom);
        set.add(Permission::SendMessages);
        set.add(Permission::ReadMessages);
        set.add(Permission::UploadFiles);
        set.add(Permission::DownloadFiles);
        
        set
    }

    /// Create a permission set for a regular member
    pub fn for_member() -> Self {
        let mut set = Self::new();
        // Regular member permissions
        set.add(Permission::SendMessages);
        set.add(Permission::ReadMessages);
        set.add(Permission::UploadFiles);
        set.add(Permission::DownloadFiles);
        
        set
    }

    /// Create a permission set for a moderator
    pub fn for_moderator() -> Self {
        let mut set = Self::for_member();
        set.add(Permission::ManageRoomMembers);
        set.add(Permission::UpdateRoomSettings);
        set
    }

    /// Create a permission set for an admin
    pub fn for_admin() -> Self {
        Self::all()
    }

    /// Add a capability to this permission set
    pub fn add(&mut self, permission: Permission) {
        self.permissions.insert(permission);
    }

    /// Remove a capability from this permission set
    pub fn remove(&mut self, permission: Permission) {
        self.permissions.remove(&permission);
    }

    /// Check if this permission set has a specific capability
    pub fn has(&self, permission: Permission) -> bool {
        self.permissions.contains(&Permission::All) || self.permissions.contains(&permission)
    }

    /// Check if this permission set has any of the given capabilities
    pub fn has_any(&self, permissions: &[Permission]) -> bool {
        if self.permissions.contains(&Permission::All) {
            return true;
        }
        
        permissions.iter().any(|c| self.permissions.contains(c))
    }

    /// Check if this permission set has all of the given capabilities
    pub fn has_all(&self, permissions: &[Permission]) -> bool {
        if self.permissions.contains(&Permission::All) {
            return true;
        }
        
        permissions.iter().all(|c| self.permissions.contains(c))
    }

    /// Merge another permission set into this one
    pub fn merge(&mut self, other: &Self) {
        if other.permissions.contains(&Permission::All) {
            self.add(Permission::All);
            return;
        }
        
        for permission in &other.permissions {
            self.permissions.insert(*permission);
        }
    }
}

impl Default for PermissionSet {
    fn default() -> Self {
        Self::new()
    }
}

/// Role of a user in the system, determining their default permissions
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UserRole {
    Admin,
    Owner,
    Moderator,
    Member,
    Guest,
}

impl UserRole {
    /// Get the default permission set for this role
    pub fn default_permissions(&self) -> PermissionSet {
        match self {
            UserRole::Admin => PermissionSet::for_admin(),
            UserRole::Owner => PermissionSet::for_owner(),
            UserRole::Moderator => PermissionSet::for_moderator(),
            UserRole::Member => PermissionSet::for_member(),
            UserRole::Guest => PermissionSet::new(),
        }
    }
}

/// Represents the membership of a user in a domain with permissions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Membership {
    pub user_id: String,
    pub role: UserRole,
    pub permissions: PermissionSet,
}

impl Membership {
    /// Create a new membership with default permissions based on role
    pub fn new(user_id: String, role: UserRole) -> Self {
        Self {
            user_id,
            role,
            permissions: role.default_permissions(),
        }
    }

    /// Create a custom membership with specific permissions
    pub fn with_permissions(user_id: String, role: UserRole, permissions: PermissionSet) -> Self {
        Self {
            user_id,
            role,
            permissions,
        }
    }

    /// Check if this membership has a specific capability
    pub fn has_permission(&self, permission: Permission) -> bool {
        self.permissions.has(permission)
    }

    /// Check if this membership has any of the given capabilities
    pub fn has_any_permission(&self, permissions: &[Permission]) -> bool {
        self.permissions.has_any(permissions)
    }

    /// Check if this membership has all of the given capabilities
    pub fn has_all_permissions(&self, permissions: &[Permission]) -> bool {
        self.permissions.has_all(permissions)
    }
}
