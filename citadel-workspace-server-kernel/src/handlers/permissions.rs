use citadel_workspace_types::structs::{Permission, UserRole};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// A set of permissions that can be assigned to a user or role
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct PermissionSet {
    pub permissions: HashSet<Permission>,
}

impl PermissionSet {
    /// Create a new empty permission set
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a permission set with a single permission
    pub fn with_permission(permission: Permission) -> Self {
        let mut set = Self::new();
        set.add(permission);
        set
    }

    /// Create a permission set with the given permissions
    pub fn with_permissions(permissions: &[Permission]) -> Self {
        let mut set = Self::new();
        for &permission in permissions {
            set.add(permission);
        }
        set
    }

    /// Add a permission to the set
    pub fn add(&mut self, permission: Permission) -> &mut Self {
        self.permissions.insert(permission);
        self
    }

    /// Remove a permission from the set
    pub fn remove(&mut self, permission: Permission) -> &mut Self {
        self.permissions.remove(&permission);
        self
    }

    /// Check if the set has the given permission
    pub fn has(&self, permission: Permission) -> bool {
        self.permissions.contains(&permission)
    }

    /// Create a permission set for a system admin
    pub fn for_admin() -> Self {
        Self::with_permissions(&[
            Permission::ViewContent,
            Permission::EditContent,
            Permission::AddUsers,
            Permission::RemoveUsers,
            Permission::CreateOffice,
            Permission::DeleteOffice,
            Permission::CreateRoom,
            Permission::DeleteRoom,
            Permission::CreateWorkspace,
            Permission::UpdateWorkspace,
            Permission::DeleteWorkspace,
        ])
    }

    /// Create a permission set for a domain owner
    pub fn for_owner() -> Self {
        Self::with_permissions(&[
            Permission::ViewContent,
            Permission::EditContent,
            Permission::CreateRoom,
            Permission::ManageOfficeMembers,
        ])
    }

    /// Create a permission set for a domain member
    pub fn for_member() -> Self {
        Self::with_permissions(&[Permission::ViewContent, Permission::EditContent])
    }

    /// Create a permission set for a guest
    pub fn for_guest() -> Self {
        Self::with_permissions(&[Permission::ViewContent])
    }

    /// Get all permissions in this set
    pub fn all(&self) -> &HashSet<Permission> {
        &self.permissions
    }

    /// Count the number of permissions in this set
    pub fn count(&self) -> usize {
        self.permissions.len()
    }

    /// Check if this set is empty
    pub fn is_empty(&self) -> bool {
        self.permissions.is_empty()
    }

    /// Check if this permission set has any of the given capabilities
    pub fn has_any(&self, permissions: &[Permission]) -> bool {
        permissions.iter().any(|c| self.permissions.contains(c))
    }

    /// Check if this permission set has all of the given capabilities
    pub fn has_all(&self, permissions: &[Permission]) -> bool {
        permissions.iter().all(|c| self.permissions.contains(c))
    }
}

/// Extension trait to get default permissions for a role
pub trait RolePermissions {
    /// Get the default permission set for this role
    fn default_permissions(&self) -> PermissionSet;
}

impl RolePermissions for UserRole {
    fn default_permissions(&self) -> PermissionSet {
        match self {
            UserRole::Admin => PermissionSet::for_admin(),
            UserRole::Owner => PermissionSet::for_owner(),
            UserRole::Member => PermissionSet::for_member(),
            UserRole::Guest => PermissionSet::for_guest(),
            _ => PermissionSet::new(), // Unknown roles get no permissions by default
        }
    }
}

/// Represents the membership of a user in a domain with permissions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Membership {
    pub user_id: String,
    pub domain_id: String,
    pub role: UserRole,
    pub permissions: PermissionSet,
}

impl Membership {
    /// Create a new membership with default permissions based on role
    pub fn new(user_id: String, domain_id: String, role: UserRole) -> Self {
        let permissions = role.default_permissions();
        Self {
            user_id,
            domain_id,
            role,
            permissions,
        }
    }

    /// Check if this membership has a specific permission
    pub fn has_permission(&self, permission: Permission) -> bool {
        self.permissions.has(permission)
    }

    /// Check if this membership has any of the given permissions
    pub fn has_any_permission(&self, permissions: &[Permission]) -> bool {
        self.permissions.has_any(permissions)
    }

    /// Check if this membership has all of the given permissions
    pub fn has_all_permissions(&self, permissions: &[Permission]) -> bool {
        self.permissions.has_all(permissions)
    }
}
