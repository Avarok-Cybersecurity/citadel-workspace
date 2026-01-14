use crate::handlers::domain::server_ops::DomainServerOperations;
use crate::kernel::transaction::BackendTransactionManager;
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
    /// backend transaction manager and admin username configuration.
    pub fn new(
        backend_tx_manager: Arc<BackendTransactionManager<R>>,
        node_remote: Option<NodeRemote<R>>,
        admin_username: String,
    ) -> Self {
        Self {
            node_remote: Arc::new(RwLock::new(node_remote)),
            admin_username,
            domain_operations: DomainServerOperations::new(backend_tx_manager),
        }
    }

    /// Get a reference to the domain operations handler
    pub fn domain_ops(&self) -> &DomainServerOperations<R> {
        &self.domain_operations
    }

    /// Get a reference to the backend transaction manager
    pub fn backend_tx_manager(&self) -> &Arc<BackendTransactionManager<R>> {
        &self.domain_operations.backend_tx_manager
    }
    
    /// Get reference for tx_manager compatibility (returns backend now)
    pub fn tx_manager(&self) -> &Arc<BackendTransactionManager<R>> {
        &self.domain_operations.backend_tx_manager
    }
}
