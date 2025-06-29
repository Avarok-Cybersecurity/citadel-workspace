use super::core::WorkspaceServerKernel;
use crate::kernel::transaction::rbac::transaction_operations::TransactionManagerExt;
use crate::WORKSPACE_ROOT_ID;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::UserRole;

impl<R: Ratchet> WorkspaceServerKernel<R> {
    /// Add a member to a domain (workspace, office, or room)
    /// 
    /// This method provides domain member management by:
    /// - Validating that a domain ID is provided
    /// - Delegating to the internal domain user operations
    /// - Ensuring transaction consistency with proper commit handling
    /// - Providing detailed error reporting for transaction failures
    /// 
    /// **Parameters:**
    /// - `actor_user_id`: The user performing the operation (must have appropriate permissions)
    /// - `target_user_id`: The user being added to the domain
    /// - `domain_id`: The ID of the domain (workspace, office, or room)
    /// - `role`: The role to assign to the user in the domain
    /// - `metadata`: Optional metadata to associate with the membership
    pub fn add_member(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
        domain_id: Option<&str>, // Can be Workspace, Office, or Room ID
        role: UserRole,
        metadata: Option<Vec<u8>>,
    ) -> Result<(), NetworkError> {
        self.tx_manager().with_write_transaction(|tx| {
            let domain_id_str = domain_id.ok_or_else(|| {
                NetworkError::msg("Domain ID must be provided to add a member to a domain")
            })?;

            crate::handlers::domain::functions::user::user_ops::add_user_to_domain_inner(
                tx,
                actor_user_id,
                target_user_id,
                domain_id_str,
                role,
                metadata,
            )?; // Propagate error if add_user_to_domain_inner fails

            // Commit changes
            tx.commit().map_err(|e| {
                // @human-review: Consider proper logging for transaction commit failures
                eprintln!(
                    "[add_member KERNEL COMMIT_FAILURE_PRINTLN] Transaction commit failed: {:?}",
                    e
                );
                NetworkError::msg(format!("Transaction commit failed: {}", e))
            })?;

            Ok(())
        })
    }

    /// Remove a member from the root workspace domain
    /// 
    /// This method provides member removal functionality by:
    /// - Removing the specified user from the root workspace
    /// - Ensuring transaction consistency with proper commit handling
    /// - Delegating to the internal domain user operations
    /// 
    /// **Parameters:**
    /// - `actor_user_id`: The user performing the operation (must have appropriate permissions)
    /// - `target_user_id`: The user being removed from the domain
    /// 
    /// **Note:** Currently hardcoded to remove from WORKSPACE_ROOT_ID. Consider extending
    /// to support removing from specific domains if needed.
    pub fn remove_member(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
    ) -> Result<(), NetworkError> {
        self.tx_manager().with_write_transaction(|tx| {
            crate::handlers::domain::functions::user::user_ops::remove_user_from_domain_inner(
                tx,
                actor_user_id,
                target_user_id,
                WORKSPACE_ROOT_ID,
            )?;

            // Commit the transaction
            tx.commit()?;

            Ok(())
        })
    }
} 