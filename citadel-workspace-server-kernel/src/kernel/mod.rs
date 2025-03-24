use crate::structs::{Domain, User, UserRole, WorkspaceRoles};
use citadel_logging::debug;
use citadel_sdk::prelude::{NetworkError, NodeRemote, NodeResult, Ratchet};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

pub mod command_processor;
pub mod domain;
pub mod transaction;

/// Server kernel implementation
#[allow(dead_code)]
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
        event: NodeResult<R>,
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
        // Initialize with a default admin user
        let mut users = HashMap::new();
        let permissions = HashMap::new();

        users.insert(
            "admin".to_string(),
            User {
                id: "admin".to_string(),
                name: "Administrator".to_string(),
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
