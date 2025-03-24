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
    pub roles: Arc<RwLock<WorkspaceRoles>>,
    pub users: Arc<RwLock<HashMap<String, User>>>,
    pub domains: Arc<RwLock<HashMap<String, Domain>>>,
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
            roles: Arc::new(RwLock::new(WorkspaceRoles::new())),
            users: Arc::new(RwLock::new(HashMap::new())),
            domains: Arc::new(RwLock::new(HashMap::new())),
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
        let mut users = HashMap::new();
        let permissions = HashMap::new();

        users.insert(
            admin_id.to_string(),
            User {
                id: admin_id.to_string(),
                name: admin_name.to_string(),
                role: UserRole::Admin,
                permissions,
            },
        );

        WorkspaceServerKernel {
            roles: Arc::new(RwLock::new(WorkspaceRoles::new())),
            users: Arc::new(RwLock::new(users)),
            domains: Arc::new(RwLock::new(HashMap::new())),
            node_remote: None,
        }
    }
}
