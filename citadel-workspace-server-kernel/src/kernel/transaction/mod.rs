use citadel_logging::info;
use citadel_sdk::prelude::{BackendHandler, NetworkError, NodeRemote, ProtocolRemoteExt, Ratchet};
use citadel_workspace_types::structs::{Domain, DomainNode, TreeSchema, User, Workspace};
use citadel_workspace_types::GroupMessage;
use parking_lot::RwLock;
use serde::de::DeserializeOwned;
use serde::Serialize;
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
        info!(target: "citadel", "Initializing BackendTransactionManager with NodeRemote backend");

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

    // ========== Generic Backend Helpers (SSOT for persistence pattern) ==========

    /// Generic get: deserializes a value from the backend by key.
    /// Returns `None` if the key doesn't exist.
    async fn backend_get<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>, NetworkError> {
        if self.node_remote.read().is_none() {
            return if let Some(data) = self.test_storage.read().get(key) {
                serde_json::from_slice(data)
                    .map(Some)
                    .map_err(|e| NetworkError::msg(format!("Failed to deserialize {key}: {e}")))
            } else {
                Ok(None)
            };
        }

        let node_remote = self.get_node_remote()?;
        let backend = node_remote
            .propose_target(0, 0)
            .await
            .map_err(|e| NetworkError::msg(format!("Failed to get backend handler: {e}")))?;

        if let Some(data) = backend.get(key).await? {
            serde_json::from_slice(&data)
                .map(Some)
                .map_err(|e| NetworkError::msg(format!("Failed to deserialize {key}: {e}")))
        } else {
            Ok(None)
        }
    }

    /// Generic save: serializes a value and writes it to the backend by key.
    async fn backend_save<T: Serialize>(&self, key: &str, value: &T) -> Result<(), NetworkError> {
        let data = serde_json::to_vec(value)
            .map_err(|e| NetworkError::msg(format!("Failed to serialize {key}: {e}")))?;

        if self.node_remote.read().is_none() {
            self.test_storage.write().insert(key.to_string(), data);
            return Ok(());
        }

        let node_remote = self.get_node_remote()?;
        let backend = node_remote
            .propose_target(0, 0)
            .await
            .map_err(|e| NetworkError::msg(format!("Failed to get backend handler: {e}")))?;
        backend.set(key, data).await?;
        Ok(())
    }

    // ========== Typed Accessors (delegate to generic helpers) ==========

    pub async fn get_all_domains(&self) -> Result<HashMap<String, Domain>, NetworkError> {
        Ok(self.backend_get("citadel_workspace.domains").await?.unwrap_or_default())
    }

    pub async fn get_all_users(&self) -> Result<HashMap<String, User>, NetworkError> {
        Ok(self.backend_get("citadel_workspace.users").await?.unwrap_or_default())
    }

    pub async fn get_all_workspaces(&self) -> Result<HashMap<String, Workspace>, NetworkError> {
        Ok(self.backend_get("citadel_workspace.workspaces").await?.unwrap_or_default())
    }

    pub async fn get_all_passwords(&self) -> Result<HashMap<String, String>, NetworkError> {
        Ok(self.backend_get("citadel_workspace.passwords").await?.unwrap_or_default())
    }

    pub async fn save_domains(&self, domains: &HashMap<String, Domain>) -> Result<(), NetworkError> {
        self.backend_save("citadel_workspace.domains", domains).await
    }

    pub async fn save_users(&self, users: &HashMap<String, User>) -> Result<(), NetworkError> {
        self.backend_save("citadel_workspace.users", users).await
    }

    pub async fn save_workspaces(&self, workspaces: &HashMap<String, Workspace>) -> Result<(), NetworkError> {
        self.backend_save("citadel_workspace.workspaces", workspaces).await
    }

    pub async fn save_passwords(&self, passwords: &HashMap<String, String>) -> Result<(), NetworkError> {
        self.backend_save("citadel_workspace.passwords", passwords).await
    }

    // ========== Group Messaging Storage ==========

    fn group_messages_key(group_id: &str) -> String {
        format!("citadel_workspace.group_messages.{}", group_id)
    }

    pub async fn get_group_messages(&self, group_id: &str) -> Result<Vec<GroupMessage>, NetworkError> {
        let key = Self::group_messages_key(group_id);
        Ok(self.backend_get(&key).await?.unwrap_or_default())
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

    async fn save_group_messages(&self, group_id: &str, messages: &[GroupMessage]) -> Result<(), NetworkError> {
        let key = Self::group_messages_key(group_id);
        self.backend_save(&key, &messages).await
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

    // ========== DomainNode (Generalized Tree Hierarchy) Storage ==========

    pub async fn get_all_nodes(&self) -> Result<HashMap<String, DomainNode>, NetworkError> {
        Ok(self.backend_get("citadel_workspace.nodes").await?.unwrap_or_default())
    }

    pub async fn save_nodes(&self, nodes: &HashMap<String, DomainNode>) -> Result<(), NetworkError> {
        self.backend_save("citadel_workspace.nodes", nodes).await
    }

    pub async fn get_tree_schema(&self) -> Result<Option<TreeSchema>, NetworkError> {
        self.backend_get("citadel_workspace.tree_schema").await
    }

    pub async fn save_tree_schema(&self, schema: &TreeSchema) -> Result<(), NetworkError> {
        self.backend_save("citadel_workspace.tree_schema", schema).await
    }
}
