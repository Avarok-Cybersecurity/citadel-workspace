use citadel_sdk::prelude::{BackendHandler, NetworkError, NodeRemote, ProtocolRemoteExt, Ratchet};
use citadel_workspace_types::structs::{Domain, User, Workspace};
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;
pub mod async_transactions;
pub mod backend_ops_simple;
// Note: TransactionManager has been removed. Use BackendTransactionManager instead.

/// Transaction manager that uses NodeRemote backend for persistence
pub struct BackendTransactionManager<R: Ratchet> {
    /// NodeRemote for backend operations
    node_remote: Arc<RwLock<Option<NodeRemote<R>>>>,
    /// In-memory storage for testing when no NodeRemote is available
    test_storage: Arc<RwLock<HashMap<String, Vec<u8>>>>,
}

impl<R: Ratchet + Send + Sync + 'static> BackendTransactionManager<R> {
    pub fn new() -> Self {
        println!(
            "[BTM_NEW_PRINTLN] Initializing BackendTransactionManager with NodeRemote backend..."
        );

        Self {
            node_remote: Arc::new(RwLock::new(None)),
            test_storage: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Set the NodeRemote instance
    pub fn set_node_remote(&self, node_remote: NodeRemote<R>) {
        *self.node_remote.write() = Some(node_remote);
    }

    /// Check if we're in test mode (no NodeRemote set)
    pub fn is_test_mode(&self) -> bool {
        self.node_remote.read().is_none()
    }

    /// Get the node remote
    fn get_node_remote(&self) -> Result<NodeRemote<R>, NetworkError> {
        self.node_remote
            .read()
            .as_ref()
            .ok_or_else(|| NetworkError::msg("NodeRemote not set"))
            .map(|nr| nr.clone())
    }

    /// Get all domains from backend
    pub async fn get_all_domains(&self) -> Result<HashMap<String, Domain>, NetworkError> {
        // Check if we're in test mode without NodeRemote
        if self.node_remote.read().is_none() {
            if let Some(data) = self.test_storage.read().get("citadel_workspace.domains") {
                return serde_json::from_slice(data).map_err(|e| {
                    NetworkError::msg(format!("Failed to deserialize domains: {}", e))
                });
            } else {
                return Ok(HashMap::new());
            }
        }

        let node_remote = self.get_node_remote()?;
        let backend = node_remote
            .propose_target(0, 0)
            .await
            .map_err(|e| NetworkError::msg(format!("Failed to get backend handler: {}", e)))?;

        if let Some(data) = backend.get("citadel_workspace.domains").await? {
            serde_json::from_slice(&data)
                .map_err(|e| NetworkError::msg(format!("Failed to deserialize domains: {}", e)))
        } else {
            Ok(HashMap::new())
        }
    }

    /// Get all users from backend
    pub async fn get_all_users(&self) -> Result<HashMap<String, User>, NetworkError> {
        // Check if we're in test mode without NodeRemote
        if self.node_remote.read().is_none() {
            if let Some(data) = self.test_storage.read().get("citadel_workspace.users") {
                return serde_json::from_slice(data)
                    .map_err(|e| NetworkError::msg(format!("Failed to deserialize users: {}", e)));
            } else {
                return Ok(HashMap::new());
            }
        }

        let node_remote = self.get_node_remote()?;
        let backend = node_remote
            .propose_target(0, 0)
            .await
            .map_err(|e| NetworkError::msg(format!("Failed to get backend handler: {}", e)))?;

        if let Some(data) = backend.get("citadel_workspace.users").await? {
            serde_json::from_slice(&data)
                .map_err(|e| NetworkError::msg(format!("Failed to deserialize users: {}", e)))
        } else {
            Ok(HashMap::new())
        }
    }

    /// Get all workspaces from backend
    pub async fn get_all_workspaces(&self) -> Result<HashMap<String, Workspace>, NetworkError> {
        // Check if we're in test mode without NodeRemote
        if self.node_remote.read().is_none() {
            if let Some(data) = self.test_storage.read().get("citadel_workspace.workspaces") {
                return serde_json::from_slice(data).map_err(|e| {
                    NetworkError::msg(format!("Failed to deserialize workspaces: {}", e))
                });
            } else {
                return Ok(HashMap::new());
            }
        }

        let node_remote = self.get_node_remote()?;
        let backend = node_remote
            .propose_target(0, 0)
            .await
            .map_err(|e| NetworkError::msg(format!("Failed to get backend handler: {}", e)))?;

        if let Some(data) = backend.get("citadel_workspace.workspaces").await? {
            serde_json::from_slice(&data)
                .map_err(|e| NetworkError::msg(format!("Failed to deserialize workspaces: {}", e)))
        } else {
            Ok(HashMap::new())
        }
    }

    /// Get all passwords from backend
    pub async fn get_all_passwords(&self) -> Result<HashMap<String, String>, NetworkError> {
        // Check if we're in test mode without NodeRemote
        if self.node_remote.read().is_none() {
            if let Some(data) = self.test_storage.read().get("citadel_workspace.passwords") {
                return serde_json::from_slice(data).map_err(|e| {
                    NetworkError::msg(format!("Failed to deserialize passwords: {}", e))
                });
            } else {
                return Ok(HashMap::new());
            }
        }

        let node_remote = self.get_node_remote()?;
        let backend = node_remote
            .propose_target(0, 0)
            .await
            .map_err(|e| NetworkError::msg(format!("Failed to get backend handler: {}", e)))?;

        if let Some(data) = backend.get("citadel_workspace.passwords").await? {
            serde_json::from_slice(&data)
                .map_err(|e| NetworkError::msg(format!("Failed to deserialize passwords: {}", e)))
        } else {
            Ok(HashMap::new())
        }
    }

    /// Save domains to backend
    pub async fn save_domains(
        &self,
        domains: &HashMap<String, Domain>,
    ) -> Result<(), NetworkError> {
        // Check if we're in test mode without NodeRemote
        if self.node_remote.read().is_none() {
            let data = serde_json::to_vec(domains)
                .map_err(|e| NetworkError::msg(format!("Failed to serialize domains: {}", e)))?;
            self.test_storage
                .write()
                .insert("citadel_workspace.domains".to_string(), data);
            return Ok(());
        }

        let node_remote = self.get_node_remote()?;
        let backend = node_remote
            .propose_target(0, 0)
            .await
            .map_err(|e| NetworkError::msg(format!("Failed to get backend handler: {}", e)))?;
        let data = serde_json::to_vec(domains)
            .map_err(|e| NetworkError::msg(format!("Failed to serialize domains: {}", e)))?;
        backend.set("citadel_workspace.domains", data).await?;
        Ok(())
    }

    /// Save users to backend
    pub async fn save_users(&self, users: &HashMap<String, User>) -> Result<(), NetworkError> {
        // Check if we're in test mode without NodeRemote
        if self.node_remote.read().is_none() {
            let data = serde_json::to_vec(users)
                .map_err(|e| NetworkError::msg(format!("Failed to serialize users: {}", e)))?;
            self.test_storage
                .write()
                .insert("citadel_workspace.users".to_string(), data);
            return Ok(());
        }

        let node_remote = self.get_node_remote()?;
        let backend = node_remote
            .propose_target(0, 0)
            .await
            .map_err(|e| NetworkError::msg(format!("Failed to get backend handler: {}", e)))?;
        let data = serde_json::to_vec(users)
            .map_err(|e| NetworkError::msg(format!("Failed to serialize users: {}", e)))?;
        backend.set("citadel_workspace.users", data).await?;
        Ok(())
    }

    /// Save workspaces to backend
    pub async fn save_workspaces(
        &self,
        workspaces: &HashMap<String, Workspace>,
    ) -> Result<(), NetworkError> {
        // Check if we're in test mode without NodeRemote
        if self.node_remote.read().is_none() {
            let data = serde_json::to_vec(workspaces)
                .map_err(|e| NetworkError::msg(format!("Failed to serialize workspaces: {}", e)))?;
            self.test_storage
                .write()
                .insert("citadel_workspace.workspaces".to_string(), data);
            return Ok(());
        }

        let node_remote = self.get_node_remote()?;
        let backend = node_remote
            .propose_target(0, 0)
            .await
            .map_err(|e| NetworkError::msg(format!("Failed to get backend handler: {}", e)))?;
        let data = serde_json::to_vec(workspaces)
            .map_err(|e| NetworkError::msg(format!("Failed to serialize workspaces: {}", e)))?;
        backend.set("citadel_workspace.workspaces", data).await?;
        Ok(())
    }

    /// Save passwords to backend
    pub async fn save_passwords(
        &self,
        passwords: &HashMap<String, String>,
    ) -> Result<(), NetworkError> {
        // Check if we're in test mode without NodeRemote
        if self.node_remote.read().is_none() {
            let data = serde_json::to_vec(passwords)
                .map_err(|e| NetworkError::msg(format!("Failed to serialize passwords: {}", e)))?;
            self.test_storage
                .write()
                .insert("citadel_workspace.passwords".to_string(), data);
            return Ok(());
        }

        let node_remote = self.get_node_remote()?;
        let backend = node_remote
            .propose_target(0, 0)
            .await
            .map_err(|e| NetworkError::msg(format!("Failed to get backend handler: {}", e)))?;
        let data = serde_json::to_vec(passwords)
            .map_err(|e| NetworkError::msg(format!("Failed to serialize passwords: {}", e)))?;
        backend.set("citadel_workspace.passwords", data).await?;
        Ok(())
    }
}
