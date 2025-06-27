use crate::WorkspaceProtocolResponse;
use crate::kernel::WorkspaceServerKernel;
use crate::handlers::domain::DomainOperations;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Permission, UserRole};
use citadel_workspace_types::UpdateOperation;
use crate::kernel::transaction::rbac::DomainType;

impl<R: Ratchet> WorkspaceServerKernel<R> {
    /// Add a member to workspace, office, or room
    pub(crate) fn add_member_command_internal(
        &self,
        actor_user_id: &str,
        target_member_id: &str,
        office_id_opt: Option<&str>,
        room_id_opt: Option<&str>,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        // Three cases: add to workspace, office, or room
        if let Some(office_id_str) = office_id_opt {
            // Add member to an office
            self.domain_ops().add_user_to_domain(
                actor_user_id,
                target_member_id,
                office_id_str,
                role
            )
        } else if let Some(room_id_str) = room_id_opt {
            // Add member to a room
            self.domain_ops().add_user_to_domain(
                actor_user_id,
                target_member_id,
                room_id_str,
                role
            )
        } else {
            // Add member to the workspace
            self.domain_ops().add_user_to_domain(
                actor_user_id,
                target_member_id,
                crate::WORKSPACE_ROOT_ID,
                role
            )
        }
    }

    /// Remove a member from workspace, office, or room
    pub(crate) fn remove_member_command_internal(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
        office_id: Option<&str>,
        room_id: Option<&str>,
    ) -> Result<(), NetworkError> {
        if let Some(domain_id_str) = office_id.or(room_id) {
            self.domain_ops().remove_user_from_domain(
                actor_user_id,
                target_user_id,
                domain_id_str
            )
        } else {
            self.domain_ops().remove_user_from_domain(
                actor_user_id,
                target_user_id,
                crate::WORKSPACE_ROOT_ID
            )
        }
    }

    /// Get member details by user ID
    pub(crate) fn get_member_command_internal(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
    ) -> Result<WorkspaceProtocolResponse, NetworkError> {
        // Use the domain_ops method to get the user directly
        self.domain_ops().with_read_transaction(|tx| {
            // Get the user from the transaction
            match tx.get_user(target_user_id) {
                Some(user) => {
                    // Return the user details using Member variant
                    Ok(WorkspaceProtocolResponse::Member(user.clone()))
                },
                None => {
                    Err(NetworkError::msg(format!("User with id {} not found", target_user_id)))
                }
            }
        })
    }

    /// Update member role
    pub(crate) fn update_member_role_command_internal(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
        role: UserRole,
        metadata: Option<Vec<u8>>,
    ) -> Result<(), NetworkError> {
        // Use update_workspace_member_role instead of update_user_role
        self.domain_ops().update_workspace_member_role(
            actor_user_id,
            target_user_id,
            role,
            metadata
        )
    }

    /// Update member permissions
    pub(crate) fn update_member_permissions_command_internal(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
        domain_id: &str,
        permissions: Vec<Permission>,
        operation: UpdateOperation,
    ) -> Result<(), NetworkError> {
        self.domain_ops().update_member_permissions(
            actor_user_id,
            target_user_id,
            domain_id,
            permissions,
            operation
        )
    }
}
