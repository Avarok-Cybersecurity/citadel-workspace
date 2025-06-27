use crate::handlers::domain::Domain;
use crate::handlers::domain::DomainOperations;
use crate::handlers::domain::server_ops::DomainServerOperations;
use crate::handlers::domain::functions::user::user_ops;
use crate::kernel::transaction::{Transaction, TransactionManager};
use crate::kernel::transaction::rbac::transaction_operations::TransactionManagerExt;
use crate::WORKSPACE_ROOT_ID;

use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Domain, DomainEntity, Office, Permission, Room, User, UserRole, Workspace};
use citadel_workspace_types::UpdateOperation;

// Standalone methods for DomainServerOperations
impl<R: Ratchet + Send + Sync + 'static> DomainServerOperations<R> {
    /// Get permission data for a user
    pub fn get_permission_data_for_user(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
    ) -> Result<Vec<(String, Vec<String>)>, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            // Admin can see any user's permissions
            let is_admin = self.is_admin(tx, actor_user_id)?;
            
            // Users can see their own permissions
            if actor_user_id != target_user_id && !is_admin {
                return Err(NetworkError::msg(format!(
                    "Permission denied: User '{}' does not have permission to view permissions for user '{}'",
                    actor_user_id, target_user_id
                )));
            }
            
            // Get all domains the user is a member of, with their permissions
            user_ops::get_all_user_domain_permissions(tx, target_user_id)
        })
    }

    /// Update a user's role in a specific domain
    pub fn update_user_role(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
        domain_id: &str,
        role: UserRole,
        metadata: Option<Vec<u8>>,
    ) -> Result<(), NetworkError> {
        // If domain is the workspace root, handle it differently
        if domain_id == WORKSPACE_ROOT_ID {
            return self.update_workspace_member_role(actor_user_id, target_user_id, role, metadata);
        }
        
        self.tx_manager.with_write_transaction(|tx| {
            // Check if actor has permission
            if !self.check_entity_permission(tx, actor_user_id, domain_id, Permission::All)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to update user roles in domain '{}'",
                    actor_user_id, domain_id
                )));
            }
            
            // Update the user's role in the domain
            user_ops::update_user_domain_role(tx, target_user_id, domain_id, role)?;
            
            Ok(())
        })
    }
    
    /// Add a user to a domain entity with a specific role
    pub async fn add_user_to_domain_entity_with_role(
        &self,
        user_id_to_add: &str,
        entity_id: &str,
        domain_type: DomainType,
        role: UserRole,
        actor_user_id: Option<&str>,
    ) -> Result<(), NetworkError> {
        let effective_actor_id = actor_user_id.unwrap_or(user_id_to_add);

        // Note: As per the memory, changes are immediately applied to in-memory storage during the transaction
        self.tx_manager.with_write_transaction(|tx| {
            user_ops::add_user_to_domain_inner(
                tx,
                effective_actor_id,
                user_id_to_add,
                entity_id,
                role,
                None,
            )
            .map(|_| ()) // Map Ok(User) to Ok(())
        })
    }
}
