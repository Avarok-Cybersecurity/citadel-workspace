use crate::kernel::transaction::rbac::DomainType;
use citadel_workspace_types::structs::{Permission, UserRole};

/// Returns the set of permissions granted by a specific role for a given domain type.
///
/// This function maps roles to their corresponding permissions based on domain type.
/// - Admin roles have all permissions
/// - Member roles have moderate permissions
/// - Viewer roles have limited read-only permissions
/// - None role has no permissions
///
/// The domain type (Workspace, Office, Room) affects which permissions are granted.
pub fn retrieve_role_permissions(role: &UserRole, domain_type: &DomainType) -> Vec<Permission> {
    let mut permissions = Vec::new();

    match role {
        UserRole::Admin => {
            // Admin role has all permissions across all domain types
            permissions.push(Permission::All);
            permissions.push(Permission::CreateOffice);
            permissions.push(Permission::DeleteOffice);
            permissions.push(Permission::UpdateOffice);
            permissions.push(Permission::CreateRoom);
            permissions.push(Permission::DeleteRoom);
            permissions.push(Permission::UpdateRoom);
            permissions.push(Permission::CreateWorkspace);
            permissions.push(Permission::DeleteWorkspace);
            permissions.push(Permission::UpdateWorkspace);
            permissions.push(Permission::EditContent);
            permissions.push(Permission::AddUsers);
            permissions.push(Permission::RemoveUsers);
            permissions.push(Permission::SendMessages);
            permissions.push(Permission::ReadMessages);
            permissions.push(Permission::ManageDomains);
            permissions.push(Permission::ConfigureSystem);
        }
        UserRole::Member => {
            // Member role has moderate permissions that vary by domain type
            permissions.push(Permission::ViewContent);
            permissions.push(Permission::EditContent);
            permissions.push(Permission::SendMessages);
            permissions.push(Permission::ReadMessages);

            // Domain-specific permissions
            match domain_type {
                DomainType::Workspace => {
                    // Workspace members can create offices
                    permissions.push(Permission::CreateOffice);
                    permissions.push(Permission::AddOffice);
                }
                DomainType::Office => {
                    // Office members can create rooms
                    permissions.push(Permission::CreateRoom);
                    permissions.push(Permission::AddRoom);
                }
                DomainType::Room => {
                    // Room members can send messages
                    permissions.push(Permission::UploadFiles);
                    permissions.push(Permission::DownloadFiles);
                }
            }
        }
        UserRole::Guest => {
            // Guest role has limited read-only permissions
            permissions.push(Permission::ViewContent);
            permissions.push(Permission::ReadMessages);
            permissions.push(Permission::DownloadFiles);
        }
        UserRole::Banned => {
            // Banned role has no permissions
            // Return empty permissions vector
        }
        UserRole::Owner => {
            // Owner has all permissions except system configuration
            permissions.push(Permission::All);
            permissions.push(Permission::CreateOffice);
            permissions.push(Permission::DeleteOffice);
            permissions.push(Permission::UpdateOffice);
            permissions.push(Permission::CreateRoom);
            permissions.push(Permission::DeleteRoom);
            permissions.push(Permission::UpdateRoom);
            permissions.push(Permission::EditContent);
            permissions.push(Permission::AddUsers);
            permissions.push(Permission::RemoveUsers);
            permissions.push(Permission::SendMessages);
            permissions.push(Permission::ReadMessages);
            permissions.push(Permission::ManageDomains);
        }
        UserRole::Custom(_, _) => {
            // Custom roles should have manually assigned permissions
            // Default to basic access
            permissions.push(Permission::ViewContent);
            permissions.push(Permission::ReadMessages);
        }
    }

    permissions
}

/// Returns the combined permissions from both role-based and explicit permissions
///
/// This function takes a role and any explicit permissions assigned to a user,
/// and combines them to create a complete set of permissions for the user.
///
/// - Role-based permissions come from the retrieve_role_permissions function
/// - Explicit permissions are directly assigned to the user
/// - The final set is the union of both, with no duplicates
#[allow(dead_code)]
pub fn get_effective_permissions(
    role: &UserRole,
    domain_type: &DomainType,
    explicit_permissions: Option<&Vec<Permission>>,
) -> Vec<Permission> {
    // Get role-based permissions
    let mut permissions = retrieve_role_permissions(role, domain_type);

    // Add explicit permissions if any
    if let Some(explicit) = explicit_permissions {
        for perm in explicit {
            if !permissions.contains(perm) {
                permissions.push(*perm);
            }
        }
    }

    permissions
}
