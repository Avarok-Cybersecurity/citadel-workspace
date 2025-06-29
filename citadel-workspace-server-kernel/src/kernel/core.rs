use crate::handlers::domain::server_ops::DomainServerOperations;
use crate::kernel::transaction::TransactionManager;
use citadel_sdk::prelude::{NodeRemote, Ratchet};
use citadel_workspace_types::structs::{UserRole, WorkspaceRoles};
use parking_lot::RwLock;
use std::sync::Arc;

/// Actions for updating domain members
pub enum MemberAction {
    Add,
    Remove,
}

/// Core server kernel implementation for workspace management
/// 
/// This struct serves as the central coordination point for all workspace operations,
/// managing network connections, user roles, and domain operations through a
/// transaction-based architecture.
pub struct WorkspaceServerKernel<R: Ratchet> {
    /// Workspace role management - separated for future integration flexibility
    pub roles: Arc<RwLock<WorkspaceRoles>>,
    /// Network node remote for handling connections - wrapped for thread safety
    pub node_remote: Arc<RwLock<Option<NodeRemote<R>>>>,
    /// Admin username for administrative operations
    pub admin_username: String,
    /// Domain operations handler providing core workspace functionality
    pub domain_operations: DomainServerOperations<R>,
}

impl<R: Ratchet> Clone for WorkspaceServerKernel<R> {
    fn clone(&self) -> Self {
        Self {
            roles: self.roles.clone(),
            node_remote: self.node_remote.clone(),
            admin_username: self.admin_username.clone(),
            domain_operations: self.domain_operations.clone(),
        }
    }
}

impl<R: Ratchet> WorkspaceServerKernel<R> {
    /// Create a new WorkspaceServerKernel without any default users
    /// 
    /// This is the primary constructor for production use, requiring explicit
    /// transaction manager and admin username configuration.
    pub fn new(
        transaction_manager: Arc<RwLock<TransactionManager>>,
        node_remote: Option<NodeRemote<R>>,
        admin_username: String,
    ) -> Self {
        Self {
            roles: Arc::new(RwLock::new(WorkspaceRoles::new())),
            node_remote: Arc::new(RwLock::new(node_remote)),
            admin_username,
            domain_operations: DomainServerOperations::new(transaction_manager),
        }
    }

    /// Get a reference to the domain operations handler
    pub fn domain_ops(&self) -> &DomainServerOperations<R> {
        &self.domain_operations
    }

    /// Get a reference to the transaction manager
    pub fn tx_manager(&self) -> &Arc<RwLock<TransactionManager>> {
        &self.domain_operations.tx_manager
    }
} 