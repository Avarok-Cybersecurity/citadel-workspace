use citadel_sdk::prelude::{BackendHandler, NetworkError, NodeRemote, ProtocolRemoteExt, Ratchet};
use citadel_workspace_types::structs::{Domain, User, Workspace};
use citadel_workspace_types::GroupMessage;
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

impl<R: Ratchet + Send + Sync + 'static> Default for BackendTransactionManager<R> {
    fn default() -> Self {
        Self::new()
    }
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
            .cloned()
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

    // ========== Group Messaging Storage ==========

    /// Get the storage key for a group's messages
    fn group_messages_key(group_id: &str) -> String {
        format!("citadel_workspace.group_messages.{}", group_id)
    }

    /// Get all messages for a group
    pub async fn get_group_messages(
        &self,
        group_id: &str,
    ) -> Result<Vec<GroupMessage>, NetworkError> {
        let key = Self::group_messages_key(group_id);

        if self.node_remote.read().is_none() {
            if let Some(data) = self.test_storage.read().get(&key) {
                return serde_json::from_slice(data).map_err(|e| {
                    NetworkError::msg(format!("Failed to deserialize group messages: {}", e))
                });
            } else {
                return Ok(Vec::new());
            }
        }

        let node_remote = self.get_node_remote()?;
        let backend = node_remote
            .propose_target(0, 0)
            .await
            .map_err(|e| NetworkError::msg(format!("Failed to get backend handler: {}", e)))?;

        if let Some(data) = backend.get(&key).await? {
            serde_json::from_slice(&data).map_err(|e| {
                NetworkError::msg(format!("Failed to deserialize group messages: {}", e))
            })
        } else {
            Ok(Vec::new())
        }
    }

    /// Get paginated messages for a group
    pub async fn get_group_messages_paginated(
        &self,
        group_id: &str,
        before_timestamp: Option<u64>,
        limit: u32,
    ) -> Result<(Vec<GroupMessage>, bool), NetworkError> {
        let all_messages = self.get_group_messages(group_id).await?;

        // Sort by timestamp descending (newest first)
        let mut messages: Vec<GroupMessage> = all_messages
            .into_iter()
            .filter(|m| {
                // Only include messages before the given timestamp
                if let Some(before) = before_timestamp {
                    m.timestamp < before
                } else {
                    true
                }
            })
            .collect();

        messages.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

        // Apply limit
        let limit = limit as usize;
        let has_more = messages.len() > limit;
        messages.truncate(limit);

        Ok((messages, has_more))
    }

    /// Get thread messages (replies to a specific message)
    pub async fn get_thread_messages(
        &self,
        group_id: &str,
        parent_message_id: &str,
    ) -> Result<Vec<GroupMessage>, NetworkError> {
        let all_messages = self.get_group_messages(group_id).await?;

        let mut thread_messages: Vec<GroupMessage> = all_messages
            .into_iter()
            .filter(|m| m.reply_to.as_ref() == Some(&parent_message_id.to_string()))
            .collect();

        // Sort by timestamp ascending (oldest first for threads)
        thread_messages.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));

        Ok(thread_messages)
    }

    /// Save all messages for a group
    async fn save_group_messages(
        &self,
        group_id: &str,
        messages: &[GroupMessage],
    ) -> Result<(), NetworkError> {
        let key = Self::group_messages_key(group_id);

        if self.node_remote.read().is_none() {
            let data = serde_json::to_vec(messages).map_err(|e| {
                NetworkError::msg(format!("Failed to serialize group messages: {}", e))
            })?;
            self.test_storage.write().insert(key, data);
            return Ok(());
        }

        let node_remote = self.get_node_remote()?;
        let backend = node_remote
            .propose_target(0, 0)
            .await
            .map_err(|e| NetworkError::msg(format!("Failed to get backend handler: {}", e)))?;
        let data = serde_json::to_vec(messages)
            .map_err(|e| NetworkError::msg(format!("Failed to serialize group messages: {}", e)))?;
        backend.set(&key, data).await?;
        Ok(())
    }

    /// Store a new group message
    pub async fn store_group_message(&self, message: GroupMessage) -> Result<(), NetworkError> {
        let group_id = message.group_id.clone();
        let mut messages = self.get_group_messages(&group_id).await?;

        // If this is a reply, increment the parent's reply_count
        if let Some(parent_id) = &message.reply_to {
            for msg in &mut messages {
                if &msg.id == parent_id {
                    msg.reply_count += 1;
                    break;
                }
            }
        }

        messages.push(message);
        self.save_group_messages(&group_id, &messages).await
    }

    /// Update a group message (edit)
    pub async fn update_group_message(
        &self,
        group_id: &str,
        message_id: &str,
        new_content: String,
        edited_at: u64,
    ) -> Result<Option<GroupMessage>, NetworkError> {
        let mut messages = self.get_group_messages(group_id).await?;

        let mut updated_message = None;
        for msg in &mut messages {
            if msg.id == message_id {
                msg.content = new_content;
                msg.edited_at = Some(edited_at);
                updated_message = Some(msg.clone());
                break;
            }
        }

        if updated_message.is_some() {
            self.save_group_messages(group_id, &messages).await?;
        }

        Ok(updated_message)
    }

    /// Delete a group message
    pub async fn delete_group_message(
        &self,
        group_id: &str,
        message_id: &str,
    ) -> Result<Option<GroupMessage>, NetworkError> {
        let mut messages = self.get_group_messages(group_id).await?;

        // Find and remove the message
        let mut deleted_message = None;
        let mut parent_id_to_decrement = None;

        messages.retain(|msg| {
            if msg.id == message_id {
                deleted_message = Some(msg.clone());
                parent_id_to_decrement = msg.reply_to.clone();
                false
            } else {
                true
            }
        });

        // If this was a reply, decrement the parent's reply_count
        if let Some(parent_id) = parent_id_to_decrement {
            for msg in &mut messages {
                if msg.id == parent_id && msg.reply_count > 0 {
                    msg.reply_count -= 1;
                    break;
                }
            }
        }

        if deleted_message.is_some() {
            self.save_group_messages(group_id, &messages).await?;
        }

        Ok(deleted_message)
    }

    /// Get a single message by ID
    pub async fn get_group_message(
        &self,
        group_id: &str,
        message_id: &str,
    ) -> Result<Option<GroupMessage>, NetworkError> {
        let messages = self.get_group_messages(group_id).await?;
        Ok(messages.into_iter().find(|m| m.id == message_id))
    }
}
