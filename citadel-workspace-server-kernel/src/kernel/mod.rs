use crate::handlers::transaction::TransactionManager;
use crate::structs::{Domain, User, UserRole, WorkspaceRoles};
use citadel_logging::debug;
use citadel_sdk::prelude::{NetworkError, NodeRemote, NodeResult, Ratchet};
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;

pub mod command_processor;
pub mod domain;
pub mod transaction;

/// Server kernel implementation
pub struct WorkspaceServerKernel<R: Ratchet> {
    // Transaction manager serves as a single source of truth for domains and users
    pub transaction_manager: Arc<TransactionManager>,
    // Keep roles separately for now, but might be integrated into transaction manager in the future
    pub roles: Arc<RwLock<WorkspaceRoles>>,
    pub node_remote: Option<NodeRemote<R>>,
}

/// Actions for updating domain members
pub enum MemberAction {
    Add,
    Remove,
}

#[async_trait::async_trait]
impl<R: Ratchet + Send + Sync + 'static> citadel_sdk::prelude::NetKernel<R>
    for WorkspaceServerKernel<R>
{
    fn load_remote(&mut self, server_remote: NodeRemote<R>) -> Result<(), NetworkError> {
        self.node_remote = Some(server_remote);
        Ok(())
    }

    async fn on_start<'a>(&'a self) -> Result<(), NetworkError> {
        debug!("NetKernel started");
        Ok(())
    }

    async fn on_node_event_received<'a>(
        &'a self,
        _event: NodeResult<R>,
    ) -> Result<(), NetworkError> {
        // TODO! Handle node events or this implementation is useless
        Ok(())
    }

    async fn on_stop<'a>(&'a mut self) -> Result<(), NetworkError> {
        debug!("NetKernel stopped");
        Ok(())
    }
}

impl<R: Ratchet> Default for WorkspaceServerKernel<R> {
    fn default() -> Self {
        Self {
            transaction_manager: Arc::new(TransactionManager::default()),
            roles: Arc::new(RwLock::new(WorkspaceRoles::new())),
            node_remote: None,
        }
    }
}

impl<R: Ratchet> WorkspaceServerKernel<R> {
    /// Create a new WorkspaceServerKernel without any default users
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a new WorkspaceServerKernel with a specified admin user
    pub fn with_admin(admin_id: &str, admin_name: &str) -> Self {
        let mut kernel = Self::default();

        // Use transaction manager to add the admin user
        let permissions = HashMap::new();
        let admin_user = User {
            id: admin_id.to_string(),
            name: admin_name.to_string(),
            role: UserRole::Admin,
            permissions,
        };

        // Add admin user through transaction manager
        let _ = kernel
            .transaction_manager
            .with_write_transaction(|tx| tx.insert_user(admin_id.to_string(), admin_user));

        kernel
    }

    /// Get a reference to the transaction manager
    pub fn transaction_manager(&self) -> &Arc<TransactionManager> {
        &self.transaction_manager
    }

    /// Execute a function with a read transaction
    pub fn with_read_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&dyn crate::handlers::transaction::Transaction) -> Result<T, NetworkError>,
    {
        self.transaction_manager.with_read_transaction(f)
    }

    /// Execute a function with a write transaction
    pub fn with_write_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&mut dyn crate::handlers::transaction::Transaction) -> Result<T, NetworkError>,
    {
        self.transaction_manager.with_write_transaction(f)
    }
}
