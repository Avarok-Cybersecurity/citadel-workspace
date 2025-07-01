use crate::handlers::domain::server_ops::DomainServerOperations;
use crate::handlers::domain::{permission_denied, DomainOperations, PermissionOperations};
use crate::kernel::transaction::Transaction;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Permission, UserRole};

impl<R: Ratchet + Send + Sync + 'static> DomainServerOperations<R> {
    /// Helper method to check if user can access a domain
    pub fn can_access_domain(
        &self,
        tx: &dyn Transaction,
        user_id: &str,
        entity_id: &str,
    ) -> Result<bool, NetworkError> {
        // Admins can access all domains
        if self.is_admin(tx, user_id)? {
            return Ok(true);
        }

        // Check if user is a member of the domain
        self.is_member_of_domain(tx, user_id, entity_id)
    }

    /// Helper method to check global permission
    pub fn check_global_permission(
        &self,
        tx: &dyn Transaction,
        user_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError> {
        // System administrators always have all global permissions
        if self.is_admin(tx, user_id)? {
            return Ok(true);
        }

        // Check if user has the specific global permission
        if let Some(user) = self.get_user(user_id) {
            if user.has_permission("global", permission) {
                return Ok(true);
            }

            // Check if the user's role grants this permission
            match user.role {
                UserRole::Admin => Ok(true), // Admins have all permissions
                UserRole::Owner => match permission {
                    Permission::ViewContent => Ok(true),
                    Permission::EditContent => Ok(true),
                    Permission::AddUsers => Ok(true),
                    Permission::RemoveUsers => Ok(true),
                    Permission::CreateOffice => Ok(true),
                    Permission::DeleteOffice => Ok(true),
                    Permission::UpdateOffice => Ok(true),
                    Permission::CreateRoom => Ok(true),
                    Permission::DeleteRoom => Ok(true),
                    Permission::UpdateRoom => Ok(true),
                    Permission::CreateWorkspace => Ok(true),
                    Permission::DeleteWorkspace => Ok(true),
                    Permission::UpdateWorkspace => Ok(true),
                    Permission::EditMdx => Ok(true),
                    Permission::EditRoomConfig => Ok(true),
                    Permission::EditOfficeConfig => Ok(true),
                    Permission::AddOffice => Ok(true),
                    Permission::AddRoom => Ok(true),
                    Permission::UpdateOfficeSettings => Ok(true),
                    Permission::UpdateRoomSettings => Ok(true),
                    Permission::ManageOfficeMembers => Ok(true),
                    Permission::ManageRoomMembers => Ok(true),
                    Permission::SendMessages => Ok(true),
                    Permission::ReadMessages => Ok(true),
                    Permission::UploadFiles => Ok(true),
                    Permission::DownloadFiles => Ok(true),
                    Permission::ManageDomains => Ok(true),
                    Permission::ConfigureSystem => Ok(true),
                    Permission::EditWorkspaceConfig => Ok(true),
                    Permission::BanUser => Ok(true),
                    Permission::All => Ok(true),
                },
                _ => Ok(false), // Other roles don't have global permissions by default
            }
        } else {
            Err(permission_denied(format!(
                "User with ID {} not found",
                user_id
            )))
        }
    }
}
