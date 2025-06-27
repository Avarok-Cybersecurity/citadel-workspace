use crate::kernel::WorkspaceServerKernel;
use crate::handlers::domain::DomainOperations;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{PasswordPair, UserRole, Workspace};
use crate::kernel::transaction::prelude::TransactionManagerExt;
use crate::kernel::transaction::Transaction;

impl<R: Ratchet> WorkspaceServerKernel<R> {
    /// Load a workspace by ID or use the default workspace if none specified
    pub(crate) fn load_workspace(
        &self,
        actor_user_id: &str,
        workspace_id_opt: Option<&str>,
    ) -> Result<Workspace, NetworkError> {
        self.domain_ops()
            .load_workspace(actor_user_id, workspace_id_opt)
    }

    /// Create a new workspace with the specified details
    pub(crate) fn create_workspace(
        &self,
        actor_user_id: &str,
        name: &str,
        description: &str,
        metadata: Option<Vec<u8>>,
        workspace_password: String,
    ) -> Result<Workspace, NetworkError> {
        self.domain_ops().create_workspace(
            actor_user_id,
            name,
            description,
            metadata,
            workspace_password,
        )
    }

    /// Get workspace details for a specific workspace ID
    pub(crate) fn get_workspace(
        &self,
        actor_user_id: &str,
        workspace_id: &str,
    ) -> Result<Workspace, NetworkError> {
        self.domain_ops().get_workspace(actor_user_id, workspace_id)
    }

    /// Update an existing workspace with new details
    pub(crate) fn update_workspace(
        &self,
        actor_user_id: &str,
        workspace_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        metadata: Option<Vec<u8>>,
        workspace_master_password: String,
    ) -> Result<Workspace, NetworkError> {
        self.domain_ops().update_workspace(
            actor_user_id,
            workspace_id,
            name,
            description,
            metadata,
            workspace_master_password,
        )
    }

    /// Delete a workspace using the workspace master password
    pub(crate) fn delete_workspace(
        &self,
        actor_user_id: &str,
        workspace_master_password: String,
    ) -> Result<String, NetworkError> {
        match self.domain_ops().delete_workspace(
            actor_user_id,
            crate::WORKSPACE_ROOT_ID,
            workspace_master_password,
        ) {
            Ok(_) => Ok("Workspace deleted successfully".to_string()),
            Err(e) => Err(e),
        }
    }

    /// List all members for a specified office or room
    pub(crate) fn list_members(
        &self,
        office_id: Option<&str>,
        room_id: Option<&str>,
    ) -> Result<Vec<(String, String)>, NetworkError> {
        // Use the transaction manager to directly access the members
        use crate::kernel::transaction::rbac::transaction_operations::TransactionManagerExt;
        
        self.tx_manager().with_read_transaction(|tx| {
            let mut member_names = Vec::new();
            
            match (office_id, room_id) {
                (Some(office_id_str), _) => {
                    // Get office domain and its members
                    match tx.get_domain(office_id_str) {
                        Some(domain) => {
                            // Check if it's an office and extract members
                            if let Some(office) = domain.as_office() {
                                for member_id in &office.members {
                                    if let Some(user) = tx.get_user(member_id) {
                                        member_names.push((member_id.clone(), user.name.clone()));
                                    }
                                }
                                Ok(member_names)
                            } else {
                                Err(NetworkError::msg("Domain is not an office"))
                            }
                        }
                        None => Err(NetworkError::msg(format!(
                            "Office with id {} not found", 
                            office_id_str
                        )))
                    }
                },
                (_, Some(room_id_str)) => {
                    // Get room domain and its members
                    match tx.get_domain(room_id_str) {
                        Some(domain) => {
                            // Check if it's a room and extract members
                            if let Some(room) = domain.as_room() {
                                for member_id in &room.members {
                                    if let Some(user) = tx.get_user(member_id) {
                                        member_names.push((member_id.clone(), user.name.clone()));
                                    }
                                }
                                Ok(member_names)
                            } else {
                                Err(NetworkError::msg("Domain is not a room"))
                            }
                        }
                        None => Err(NetworkError::msg(format!(
                            "Room with id {} not found", 
                            room_id_str
                        )))
                    }
                },
                _ => Err(NetworkError::msg("Must specify either office_id or room_id"))
            }
        })
    }
}
