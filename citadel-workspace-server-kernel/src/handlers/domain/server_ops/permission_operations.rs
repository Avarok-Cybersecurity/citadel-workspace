use crate::handlers::domain::server_ops::DomainServerOperations;
use crate::kernel::transaction::Transaction;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Permission, UserRole};
use std::collections::HashSet;

/// Determines if a permission can be inherited from parent domains based on the user's role
pub fn permission_can_inherit_for_user(permission: Permission, user_role: &UserRole) -> bool {
    match user_role {
        UserRole::Admin | UserRole::Owner => matches!(
            permission,
            Permission::ViewContent
                | Permission::ReadMessages
                | Permission::All
                | Permission::ManageDomains
                | Permission::AddUsers
                | Permission::RemoveUsers
                | Permission::CreateOffice
                | Permission::CreateRoom
                | Permission::AddOffice
                | Permission::AddRoom
                | Permission::EditContent
                | Permission::EditMdx
                | Permission::SendMessages
                | Permission::UploadFiles
                | Permission::DownloadFiles
                | Permission::DeleteOffice
                | Permission::DeleteRoom
                | Permission::DeleteWorkspace
                | Permission::UpdateOffice
                | Permission::UpdateRoom
                | Permission::UpdateWorkspace
        ),
        _ => match permission {
            Permission::ViewContent => true,
            Permission::ReadMessages => true,
            Permission::All => false,
            Permission::ManageDomains => false,
            Permission::AddUsers => false,
            Permission::RemoveUsers => false,
            Permission::CreateOffice => true,
            Permission::CreateRoom => true,
            Permission::AddOffice => true,
            Permission::AddRoom => true,
            Permission::SendMessages => false,
            Permission::EditContent => false,
            Permission::EditMdx => false,
            Permission::UploadFiles => false,
            Permission::DownloadFiles => false,
            _ => false,
        },
    }
}

impl<R: Ratchet + Send + Sync + 'static> DomainServerOperations<R> {
    pub fn is_admin_impl(&self, tx: &dyn Transaction, user_id: &str) -> Result<bool, NetworkError> {
        let _user = tx.get_user(user_id).ok_or_else(|| {
            NetworkError::msg(format!("User '{}' not found in is_admin", user_id))
        })?;
        Ok(_user.role == UserRole::Admin)
    }

    pub fn check_entity_permission_impl(
        &self,
        tx: &dyn Transaction,
        actor_user_id: &str,
        entity_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError> {
        use crate::kernel::transaction::rbac::{retrieve_role_permissions, DomainType};
        use crate::WORKSPACE_ROOT_ID;

        if let Some(user) = tx.get_user(actor_user_id) {
            if user.role == UserRole::Admin {
                return Ok(true);
            }

            if user.has_permission(entity_id, permission) {
                return Ok(true);
            }

            if entity_id == WORKSPACE_ROOT_ID {
                if let Some(workspace_domain) = tx.get_domain(WORKSPACE_ROOT_ID) {
                    let is_workspace_member = workspace_domain
                        .members()
                        .iter()
                        .any(|member_id| member_id == actor_user_id);
                    if is_workspace_member {
                        let role_permissions =
                            retrieve_role_permissions(&user.role, &DomainType::Workspace);
                        let role_permissions_set: HashSet<Permission> =
                            role_permissions.into_iter().collect();
                        return Ok(Permission::has_permission(
                            &role_permissions_set,
                            &permission,
                        ));
                    } else {
                        return Ok(false);
                    }
                } else {
                    return Ok(false);
                }
            }

            if let Some(domain) = tx.get_domain(entity_id) {
                let domain_type = if domain.as_office().is_some() {
                    DomainType::Office
                } else if domain.as_room().is_some() {
                    DomainType::Room
                } else if domain.as_workspace().is_some() {
                    DomainType::Workspace
                } else {
                    return Err(NetworkError::msg(format!(
                        "Unknown domain type for domain: {}",
                        entity_id
                    )));
                };

                let is_member = domain
                    .members()
                    .iter()
                    .any(|member_id| member_id == actor_user_id);

                if is_member {
                    let role_permissions = retrieve_role_permissions(&user.role, &domain_type);
                    let role_permissions_set: HashSet<Permission> =
                        role_permissions.into_iter().collect();
                    return Ok(Permission::has_permission(
                        &role_permissions_set,
                        &permission,
                    ));
                }

                let parent_id = domain.parent_id();
                let can_inherit = permission_can_inherit_for_user(permission, &user.role);
                if !parent_id.is_empty() && can_inherit {
                    return self.check_entity_permission_impl(tx, actor_user_id, parent_id, permission);
                }
            }
        } else {
            return Err(NetworkError::msg(format!(
                "User '{}' not found",
                actor_user_id
            )));
        }

        Ok(false)
    }

    pub fn is_member_of_domain_impl(
        &self,
        tx: &dyn Transaction,
        user_id: &str,
        domain_id: &str,
    ) -> Result<bool, NetworkError> {
        if let Some(domain) = tx.get_domain(domain_id) {
            let is_direct_member = domain
                .members()
                .iter()
                .any(|member_id| member_id == user_id);
            if is_direct_member {
                return Ok(true);
            }

            let parent_id = domain.parent_id();
            if !parent_id.is_empty() {
                return self.is_member_of_domain_impl(tx, user_id, parent_id);
            }
        }

        Ok(false)
    }
} 