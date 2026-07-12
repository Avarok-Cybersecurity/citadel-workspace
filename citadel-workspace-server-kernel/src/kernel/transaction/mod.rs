use citadel_logging::info;
use citadel_sdk::prelude::{BackendHandler, NetworkError, NodeRemote, ProtocolRemoteExt, Ratchet};
use citadel_workspace_types::structs::{Domain, DomainNode, TreeSchema, User, Workspace};
use citadel_workspace_types::GroupMessage;
use parking_lot::RwLock;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::collections::HashMap;
use std::collections::HashSet;
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
    /// Whether migration from collection-level keys has been completed
    migrated: Arc<RwLock<bool>>,
    /// Serializes index-key read-modify-write operations across concurrent
    /// connection tasks. Without this, two connections inserting entities
    /// concurrently would race on the index (both read the same prior set,
    /// both append, second write wins) and silently drop one entity from
    /// the index - making the affected entity invisible to get_all_* lookups.
    index_write_mutex: Arc<tokio::sync::Mutex<()>>,
    /// Serializes group-message read-modify-write operations across all
    /// groups. Without this, two concurrent `store_group_message` /
    /// `update_group_message` / `delete_group_message` calls for the
    /// same group would each load the prior message list, mutate, and
    /// save — the second save silently overwrites the first, dropping
    /// a message edit or insert on the floor.
    ///
    /// A single mutex serializes across *all* groups (rather than
    /// per-group-id) because the cost is small (group message ops are
    /// infrequent compared to index ops) and the data-loss
    /// consequence of a missed lock is severe. Refactor to a per-id
    /// mutex if profiling shows contention.
    group_msg_mutex: Arc<tokio::sync::Mutex<()>>,
    /// Serializes DomainNode-collection read-modify-write operations.
    /// All nodes share a single `citadel_workspace.nodes` HashMap key,
    /// so `insert_node` / `remove_node` / `update_node` all do a
    /// load-mutate-save cycle on that single key. Without the mutex,
    /// two concurrent node ops would each load the same prior map,
    /// apply their mutation, and the second save would overwrite the
    /// first's change — losing a node insert/delete/update silently.
    /// Same data-loss-vs-cost trade-off as `group_msg_mutex` above.
    node_mutex: Arc<tokio::sync::Mutex<()>>,
}

impl<R: Ratchet + Send + Sync + 'static> Default for BackendTransactionManager<R> {
    fn default() -> Self {
        Self::new()
    }
}

/// Old collection-level storage keys (pre-migration).
const LEGACY_KEY_DOMAINS: &str = "citadel_workspace.domains";
const LEGACY_KEY_USERS: &str = "citadel_workspace.users";
const LEGACY_KEY_WORKSPACES: &str = "citadel_workspace.workspaces";
const LEGACY_KEY_PASSWORDS: &str = "citadel_workspace.passwords";

/// Per-entity key prefixes (post-migration).
const KEY_PREFIX_DOMAIN: &str = "citadel_workspace.domain.";
const KEY_PREFIX_USER: &str = "citadel_workspace.user.";
const KEY_PREFIX_WORKSPACE: &str = "citadel_workspace.workspace.";
const KEY_PREFIX_PASSWORD: &str = "citadel_workspace.password.";

/// Index keys that hold the set of entity IDs.
const KEY_INDEX_DOMAIN_IDS: &str = "citadel_workspace.domain_ids";
const KEY_INDEX_USER_IDS: &str = "citadel_workspace.user_ids";
const KEY_INDEX_WORKSPACE_IDS: &str = "citadel_workspace.workspace_ids";

/// Sentinel key indicating migration has been completed.
const KEY_MIGRATION_DONE: &str = "citadel_workspace.migration_v2_done";

/// Key for storing the backend schema version.
pub(crate) const KEY_SCHEMA_VERSION: &str = "citadel_workspace.schema_version";

/// Durable "the initial workspace structure has been seeded" marker.
///
/// `on_start` runs the structure seeding on EVERY boot, so it needs a way to
/// know whether a workspace is genuinely new. Inferring that from "the tree has
/// no root children" is not sound: an admin who deletes every office leaves a
/// legitimately-empty tree that would then be re-seeded with the baked-in
/// defaults on the next restart, resurrecting content they deliberately removed.
/// A persisted marker records the fact of seeding itself, which is what the
/// contract actually depends on.
pub(crate) const KEY_STRUCTURE_SEEDED: &str = "citadel_workspace.structure_seeded";

impl<R: Ratchet + Send + Sync + 'static> BackendTransactionManager<R> {
    pub fn new() -> Self {
        info!(target: "citadel", "Initializing BackendTransactionManager with NodeRemote backend");

        Self {
            node_remote: Arc::new(RwLock::new(None)),
            test_storage: Arc::new(RwLock::new(HashMap::new())),
            migrated: Arc::new(RwLock::new(false)),
            index_write_mutex: Arc::new(tokio::sync::Mutex::new(())),
            group_msg_mutex: Arc::new(tokio::sync::Mutex::new(())),
            node_mutex: Arc::new(tokio::sync::Mutex::new(())),
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
    /// Includes retry logic with exponential backoff for transient failures.
    async fn backend_save<T: Serialize>(&self, key: &str, value: &T) -> Result<(), NetworkError> {
        let data = serde_json::to_vec(value)
            .map_err(|e| NetworkError::msg(format!("Failed to serialize {key}: {e}")))?;

        if self.node_remote.read().is_none() {
            self.test_storage.write().insert(key.to_string(), data);
            return Ok(());
        }

        // Retry with exponential backoff: 100ms, 200ms, 400ms
        let mut last_err = None;
        for attempt in 0..3u32 {
            if attempt > 0 {
                let delay = std::time::Duration::from_millis(100 * (1 << (attempt - 1)));
                citadel_logging::warn!(target: "citadel", "Retrying backend_save for key '{}' (attempt {}/3) after {:?}", key, attempt + 1, delay);
                tokio::time::sleep(delay).await;
            }

            match self.try_backend_save(key, &data).await {
                Ok(()) => return Ok(()),
                Err(e) => {
                    last_err = Some(e);
                }
            }
        }

        Err(last_err.unwrap_or_else(|| {
            NetworkError::msg(format!("Failed to save key '{key}' after 3 attempts"))
        }))
    }

    /// Single attempt to save data to the backend
    async fn try_backend_save(&self, key: &str, data: &[u8]) -> Result<(), NetworkError> {
        let node_remote = self.get_node_remote()?;
        let backend = node_remote
            .propose_target(0, 0)
            .await
            .map_err(|e| NetworkError::msg(format!("Failed to get backend handler: {e}")))?;
        backend.set(key, data.to_vec()).await?;
        Ok(())
    }

    /// Generic delete: removes a key from the backend.
    async fn backend_delete(&self, key: &str) -> Result<(), NetworkError> {
        if self.node_remote.read().is_none() {
            self.test_storage.write().remove(key);
            return Ok(());
        }

        let node_remote = self.get_node_remote()?;
        let backend = node_remote
            .propose_target(0, 0)
            .await
            .map_err(|e| NetworkError::msg(format!("Failed to get backend handler: {e}")))?;
        backend.remove(key).await?;
        Ok(())
    }

    // ========== Index Helpers ==========

    /// Get the set of entity IDs from an index key.
    async fn get_index(&self, index_key: &str) -> Result<HashSet<String>, NetworkError> {
        Ok(self.backend_get(index_key).await?.unwrap_or_default())
    }

    /// Save the set of entity IDs to an index key.
    async fn save_index(&self, index_key: &str, ids: &HashSet<String>) -> Result<(), NetworkError> {
        self.backend_save(index_key, ids).await
    }

    /// Add an ID to an index and persist.
    ///
    /// The read-modify-write is serialised through `index_write_mutex` so that
    /// two concurrent tasks inserting distinct entities cannot race and
    /// silently drop one entity from the index.
    async fn add_to_index(&self, index_key: &str, id: &str) -> Result<(), NetworkError> {
        let _guard = self.index_write_mutex.lock().await;
        let mut ids = self.get_index(index_key).await?;
        ids.insert(id.to_string());
        self.save_index(index_key, &ids).await
    }

    /// Remove an ID from an index and persist.
    ///
    /// Serialised through `index_write_mutex`; see `add_to_index` for rationale.
    async fn remove_from_index(&self, index_key: &str, id: &str) -> Result<(), NetworkError> {
        let _guard = self.index_write_mutex.lock().await;
        let mut ids = self.get_index(index_key).await?;
        ids.remove(id);
        self.save_index(index_key, &ids).await
    }

    // ========== Migration ==========

    /// Check for legacy collection-level keys and migrate to per-entity keys.
    /// This is idempotent: if migration has already run, it is a no-op.
    pub async fn migrate_if_needed(&self) -> Result<(), NetworkError> {
        // Fast path: already migrated this process lifetime
        if *self.migrated.read() {
            return Ok(());
        }

        // Check persistent sentinel
        let done: Option<bool> = self.backend_get(KEY_MIGRATION_DONE).await?;
        if done == Some(true) {
            *self.migrated.write() = true;
            return Ok(());
        }

        info!(target: "citadel", "Checking for legacy collection-level storage keys to migrate...");

        // Migrate domains.
        //
        // Each `save_index` call is wrapped in `index_write_mutex` so a
        // concurrent request handler calling `add_to_index` cannot race
        // with the migration writing the migrated set: the handler's
        // addition would otherwise be loaded by `add_to_index`, then
        // overwritten when the migration's `save_index` lands. Today
        // `init()` runs before connections are accepted so the race
        // window is zero in practice, but the mutex acquisition keeps
        // the invariant of "every write to an index goes through
        // `index_write_mutex`" intact regardless of future call order.
        let legacy_domains: Option<HashMap<String, Domain>> =
            self.backend_get(LEGACY_KEY_DOMAINS).await?;
        if let Some(domains) = legacy_domains {
            info!(target: "citadel", "Migrating {} domains to per-entity keys", domains.len());
            let mut ids = HashSet::new();
            for (id, domain) in &domains {
                let key = format!("{KEY_PREFIX_DOMAIN}{id}");
                self.backend_save(&key, domain).await?;
                ids.insert(id.clone());
            }
            {
                let _guard = self.index_write_mutex.lock().await;
                self.save_index(KEY_INDEX_DOMAIN_IDS, &ids).await?;
            }
            self.backend_delete(LEGACY_KEY_DOMAINS).await?;
        }

        // Migrate users — same mutex contract as domains above.
        let legacy_users: Option<HashMap<String, User>> =
            self.backend_get(LEGACY_KEY_USERS).await?;
        if let Some(users) = legacy_users {
            info!(target: "citadel", "Migrating {} users to per-entity keys", users.len());
            let mut ids = HashSet::new();
            for (id, user) in &users {
                let key = format!("{KEY_PREFIX_USER}{id}");
                self.backend_save(&key, user).await?;
                ids.insert(id.clone());
            }
            {
                let _guard = self.index_write_mutex.lock().await;
                self.save_index(KEY_INDEX_USER_IDS, &ids).await?;
            }
            self.backend_delete(LEGACY_KEY_USERS).await?;
        }

        // Migrate workspaces — same mutex contract as domains above.
        let legacy_workspaces: Option<HashMap<String, Workspace>> =
            self.backend_get(LEGACY_KEY_WORKSPACES).await?;
        if let Some(workspaces) = legacy_workspaces {
            info!(target: "citadel", "Migrating {} workspaces to per-entity keys", workspaces.len());
            let mut ids = HashSet::new();
            for (id, workspace) in &workspaces {
                let key = format!("{KEY_PREFIX_WORKSPACE}{id}");
                self.backend_save(&key, workspace).await?;
                ids.insert(id.clone());
            }
            {
                let _guard = self.index_write_mutex.lock().await;
                self.save_index(KEY_INDEX_WORKSPACE_IDS, &ids).await?;
            }
            self.backend_delete(LEGACY_KEY_WORKSPACES).await?;
        }

        // Migrate passwords (no index needed)
        let legacy_passwords: Option<HashMap<String, String>> =
            self.backend_get(LEGACY_KEY_PASSWORDS).await?;
        if let Some(passwords) = legacy_passwords {
            info!(target: "citadel", "Migrating {} passwords to per-entity keys", passwords.len());
            for (id, password) in &passwords {
                let key = format!("{KEY_PREFIX_PASSWORD}{id}");
                self.backend_save(&key, password).await?;
            }
            self.backend_delete(LEGACY_KEY_PASSWORDS).await?;
        }

        // Write sentinel
        self.backend_save(KEY_MIGRATION_DONE, &true).await?;
        *self.migrated.write() = true;
        info!(target: "citadel", "Migration to per-entity storage keys complete");
        Ok(())
    }

    // ========== Per-Entity Accessors ==========

    /// Get a single domain by ID using per-entity key.
    pub async fn get_domain_by_key(&self, id: &str) -> Result<Option<Domain>, NetworkError> {
        let key = format!("{KEY_PREFIX_DOMAIN}{id}");
        self.backend_get(&key).await
    }

    /// Save a single domain by ID using per-entity key.
    pub async fn save_domain_by_key(&self, id: &str, domain: &Domain) -> Result<(), NetworkError> {
        let key = format!("{KEY_PREFIX_DOMAIN}{id}");
        self.backend_save(&key, domain).await
    }

    /// Delete a single domain entity key.
    pub async fn delete_domain_key(&self, id: &str) -> Result<(), NetworkError> {
        let key = format!("{KEY_PREFIX_DOMAIN}{id}");
        self.backend_delete(&key).await
    }

    /// Get a single user by ID using per-entity key.
    pub async fn get_user_by_key(&self, id: &str) -> Result<Option<User>, NetworkError> {
        let key = format!("{KEY_PREFIX_USER}{id}");
        self.backend_get(&key).await
    }

    /// Save a single user by ID using per-entity key.
    pub async fn save_user_by_key(&self, id: &str, user: &User) -> Result<(), NetworkError> {
        let key = format!("{KEY_PREFIX_USER}{id}");
        self.backend_save(&key, user).await
    }

    /// Delete a single user entity key.
    pub async fn delete_user_key(&self, id: &str) -> Result<(), NetworkError> {
        let key = format!("{KEY_PREFIX_USER}{id}");
        self.backend_delete(&key).await
    }

    /// Get a single workspace by ID using per-entity key.
    pub async fn get_workspace_by_key(&self, id: &str) -> Result<Option<Workspace>, NetworkError> {
        let key = format!("{KEY_PREFIX_WORKSPACE}{id}");
        self.backend_get(&key).await
    }

    /// Save a single workspace by ID using per-entity key.
    pub async fn save_workspace_by_key(
        &self,
        id: &str,
        workspace: &Workspace,
    ) -> Result<(), NetworkError> {
        let key = format!("{KEY_PREFIX_WORKSPACE}{id}");
        self.backend_save(&key, workspace).await
    }

    /// Delete a single workspace entity key.
    pub async fn delete_workspace_key(&self, id: &str) -> Result<(), NetworkError> {
        let key = format!("{KEY_PREFIX_WORKSPACE}{id}");
        self.backend_delete(&key).await
    }

    /// Get a single password by workspace ID using per-entity key.
    pub async fn get_password_by_key(&self, id: &str) -> Result<Option<String>, NetworkError> {
        let key = format!("{KEY_PREFIX_PASSWORD}{id}");
        self.backend_get(&key).await
    }

    /// Save a single password by workspace ID using per-entity key.
    pub async fn save_password_by_key(&self, id: &str, password: &str) -> Result<(), NetworkError> {
        let key = format!("{KEY_PREFIX_PASSWORD}{id}");
        self.backend_save(&key, &password.to_string()).await
    }

    /// Delete a single password entity key.
    pub async fn delete_password_key(&self, id: &str) -> Result<(), NetworkError> {
        let key = format!("{KEY_PREFIX_PASSWORD}{id}");
        self.backend_delete(&key).await
    }

    // ========== Typed Accessors (delegate to per-entity keys via index) ==========
    //
    // These preserve the original public API. They reconstruct the full HashMap
    // by iterating over the index and fetching each entity individually.

    pub async fn get_all_domains(&self) -> Result<HashMap<String, Domain>, NetworkError> {
        let ids = self.get_index(KEY_INDEX_DOMAIN_IDS).await?;
        let mut map = HashMap::with_capacity(ids.len());
        for id in &ids {
            if let Some(domain) = self.get_domain_by_key(id).await? {
                map.insert(id.clone(), domain);
            }
        }
        Ok(map)
    }

    pub async fn get_all_users(&self) -> Result<HashMap<String, User>, NetworkError> {
        let ids = self.get_index(KEY_INDEX_USER_IDS).await?;
        let mut map = HashMap::with_capacity(ids.len());
        for id in &ids {
            if let Some(user) = self.get_user_by_key(id).await? {
                map.insert(id.clone(), user);
            }
        }
        Ok(map)
    }

    pub async fn get_all_workspaces(&self) -> Result<HashMap<String, Workspace>, NetworkError> {
        let ids = self.get_index(KEY_INDEX_WORKSPACE_IDS).await?;
        let mut map = HashMap::with_capacity(ids.len());
        for id in &ids {
            if let Some(workspace) = self.get_workspace_by_key(id).await? {
                map.insert(id.clone(), workspace);
            }
        }
        Ok(map)
    }

    pub async fn get_all_passwords(&self) -> Result<HashMap<String, String>, NetworkError> {
        // Passwords don't have a dedicated index. We derive the password IDs
        // from the workspace index, since passwords are keyed by workspace ID.
        let ids = self.get_index(KEY_INDEX_WORKSPACE_IDS).await?;
        let mut map = HashMap::new();
        for id in &ids {
            if let Some(password) = self.get_password_by_key(id).await? {
                map.insert(id.clone(), password);
            }
        }
        Ok(map)
    }

    pub async fn save_domains(
        &self,
        domains: &HashMap<String, Domain>,
    ) -> Result<(), NetworkError> {
        // Bulk replace of the domain collection. Taken under the same
        // index_write_mutex as add_to_index/remove_from_index so an in-flight
        // single-entity insert cannot be clobbered by this write rebuilding
        // the index from an older snapshot.
        let _guard = self.index_write_mutex.lock().await;

        // Compute the desired set of IDs from the incoming map
        let new_ids: HashSet<String> = domains.keys().cloned().collect();
        let old_ids = self.get_index(KEY_INDEX_DOMAIN_IDS).await?;

        // Delete entities that are no longer present
        for id in old_ids.difference(&new_ids) {
            self.delete_domain_key(id).await?;
        }

        // Save each entity
        for (id, domain) in domains {
            self.save_domain_by_key(id, domain).await?;
        }

        // Update index
        self.save_index(KEY_INDEX_DOMAIN_IDS, &new_ids).await
    }

    pub async fn save_users(&self, users: &HashMap<String, User>) -> Result<(), NetworkError> {
        // See `save_domains` for rationale on index_write_mutex.
        let _guard = self.index_write_mutex.lock().await;

        let new_ids: HashSet<String> = users.keys().cloned().collect();
        let old_ids = self.get_index(KEY_INDEX_USER_IDS).await?;

        for id in old_ids.difference(&new_ids) {
            self.delete_user_key(id).await?;
        }

        for (id, user) in users {
            self.save_user_by_key(id, user).await?;
        }

        self.save_index(KEY_INDEX_USER_IDS, &new_ids).await
    }

    pub async fn save_workspaces(
        &self,
        workspaces: &HashMap<String, Workspace>,
    ) -> Result<(), NetworkError> {
        // See `save_domains` for rationale on index_write_mutex.
        let _guard = self.index_write_mutex.lock().await;

        let new_ids: HashSet<String> = workspaces.keys().cloned().collect();
        let old_ids = self.get_index(KEY_INDEX_WORKSPACE_IDS).await?;

        for id in old_ids.difference(&new_ids) {
            self.delete_workspace_key(id).await?;
            // Mirror remove_workspace's password cleanup. Without
            // this, workspaces removed via the bulk save path would
            // leave their `citadel_workspace.password.{id}` entry
            // orphaned in the backend forever - leaking secret
            // material and risking re-association if the same id is
            // ever reused.
            self.delete_password_key(id).await?;
        }

        for (id, workspace) in workspaces {
            self.save_workspace_by_key(id, workspace).await?;
        }

        self.save_index(KEY_INDEX_WORKSPACE_IDS, &new_ids).await
    }

    /// Persist passwords keyed by workspace ID.
    ///
    /// IMPORTANT: this is UPSERT-ONLY. Unlike `save_workspaces`, it does not
    /// reconcile deletions — a key omitted from `passwords` is NOT removed
    /// from the backend (there is no password index to diff against). Removal
    /// must be done explicitly via `delete_password_key`, which is what
    /// `remove_workspace` does. Do NOT rely on dropping a key from the map +
    /// calling this to delete a secret; the stale password would silently
    /// persist.
    pub async fn save_passwords(
        &self,
        passwords: &HashMap<String, String>,
    ) -> Result<(), NetworkError> {
        for (id, password) in passwords {
            self.save_password_by_key(id, password).await?;
        }
        Ok(())
    }

    // ========== Group Messaging Storage ==========

    fn group_messages_key(group_id: &str) -> String {
        format!("citadel_workspace.group_messages.{}", group_id)
    }

    pub async fn get_group_messages(
        &self,
        group_id: &str,
    ) -> Result<Vec<GroupMessage>, NetworkError> {
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

        messages.sort_by_key(|m| std::cmp::Reverse(m.timestamp));

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
        thread_messages.sort_by_key(|m| m.timestamp);

        Ok(thread_messages)
    }

    async fn save_group_messages(
        &self,
        group_id: &str,
        messages: &[GroupMessage],
    ) -> Result<(), NetworkError> {
        let key = Self::group_messages_key(group_id);
        self.backend_save(&key, &messages).await
    }

    /// Store a new group message.
    ///
    /// Serialized through `group_msg_mutex` so two concurrent inserts
    /// for the same group cannot race on the load-modify-save cycle
    /// (both read the same prior list, both push, second save
    /// overwrites the first — silently dropping the earlier message).
    pub async fn store_group_message(&self, message: GroupMessage) -> Result<(), NetworkError> {
        let _guard = self.group_msg_mutex.lock().await;
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

    /// Update a group message (edit). Serialized through
    /// `group_msg_mutex` for the same reason as `store_group_message`.
    pub async fn update_group_message(
        &self,
        group_id: &str,
        message_id: &str,
        new_content: String,
        edited_at: u64,
    ) -> Result<Option<GroupMessage>, NetworkError> {
        let _guard = self.group_msg_mutex.lock().await;
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

    /// Delete a group message. Serialized through `group_msg_mutex`
    /// for the same reason as `store_group_message`.
    pub async fn delete_group_message(
        &self,
        group_id: &str,
        message_id: &str,
    ) -> Result<Option<GroupMessage>, NetworkError> {
        let _guard = self.group_msg_mutex.lock().await;
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
        Ok(self
            .backend_get("citadel_workspace.nodes")
            .await?
            .unwrap_or_default())
    }

    pub async fn save_nodes(
        &self,
        nodes: &HashMap<String, DomainNode>,
    ) -> Result<(), NetworkError> {
        self.backend_save("citadel_workspace.nodes", nodes).await
    }

    pub async fn get_tree_schema(&self) -> Result<Option<TreeSchema>, NetworkError> {
        self.backend_get("citadel_workspace.tree_schema").await
    }

    pub async fn save_tree_schema(&self, schema: &TreeSchema) -> Result<(), NetworkError> {
        self.backend_save("citadel_workspace.tree_schema", schema)
            .await
    }
}

#[cfg(test)]
mod migration_tests {
    //! Tests for the legacy-collection -> per-entity-key migration and the
    //! schema-version stamping in `BackendTransactionManager`.
    //!
    //! These tests run against the in-memory `test_storage` backend (no
    //! `NodeRemote`), which is the only mode reachable from a unit test;
    //! the real-backend behaviour is exercised end-to-end via the kernel
    //! integration tests. The contract being verified here is the same
    //! either way: the migration moves data from legacy collection keys to
    //! per-entity keys, populates the index, removes the legacy collection,
    //! sets the persistent sentinel, and is idempotent.
    use super::*;
    use citadel_sdk::prelude::StackedRatchet;
    use citadel_workspace_types::structs::Workspace;

    fn fresh() -> BackendTransactionManager<StackedRatchet> {
        BackendTransactionManager::new()
    }

    fn ws(id: &str) -> Workspace {
        Workspace {
            id: id.to_string(),
            name: format!("workspace-{id}"),
            description: String::new(),
            owner_id: "owner".to_string(),
            members: vec![],
            offices: vec![],
            metadata: vec![],
        }
    }

    /// Helper: write a serialized blob directly into `test_storage` to
    /// simulate a backend that already contains a legacy collection. We
    /// have to reach into the private field (rather than calling the
    /// public save_* methods) because those write to per-entity keys -
    /// the very format we're trying to migrate AWAY from.
    fn seed_legacy<T: Serialize>(
        mgr: &BackendTransactionManager<StackedRatchet>,
        key: &str,
        value: &T,
    ) {
        let bytes = serde_json::to_vec(value).expect("serialize");
        mgr.test_storage.write().insert(key.to_string(), bytes);
    }

    #[tokio::test]
    async fn migrate_moves_legacy_domains_to_per_entity_keys() {
        let mgr = fresh();

        // Seed two domains in the legacy collection format.
        let mut domains: HashMap<String, Domain> = HashMap::new();
        domains.insert("a".to_string(), Domain::Workspace { workspace: ws("a") });
        domains.insert("b".to_string(), Domain::Workspace { workspace: ws("b") });
        seed_legacy(&mgr, LEGACY_KEY_DOMAINS, &domains);

        mgr.migrate_if_needed().await.expect("migration");

        // Each entity now reachable via the per-entity key.
        assert!(mgr.get_domain_by_key("a").await.unwrap().is_some());
        assert!(mgr.get_domain_by_key("b").await.unwrap().is_some());

        // Index reflects both IDs.
        let idx = mgr.get_index(KEY_INDEX_DOMAIN_IDS).await.unwrap();
        assert_eq!(idx.len(), 2);
        assert!(idx.contains("a"));
        assert!(idx.contains("b"));

        // Legacy collection key is removed.
        assert!(mgr.test_storage.read().get(LEGACY_KEY_DOMAINS).is_none());

        // Persistent sentinel is set so the next startup is a no-op.
        let sentinel: Option<bool> = mgr.backend_get(KEY_MIGRATION_DONE).await.unwrap();
        assert_eq!(sentinel, Some(true));
    }

    #[tokio::test]
    async fn migrate_is_no_op_on_fresh_database() {
        let mgr = fresh();
        // No legacy keys, no per-entity keys. Migration should still run
        // cleanly and stamp the sentinel.
        mgr.migrate_if_needed().await.expect("migration");

        let sentinel: Option<bool> = mgr.backend_get(KEY_MIGRATION_DONE).await.unwrap();
        assert_eq!(sentinel, Some(true));
        let idx = mgr.get_index(KEY_INDEX_DOMAIN_IDS).await.unwrap();
        assert!(idx.is_empty());
    }

    #[tokio::test]
    async fn migrate_skips_when_persistent_sentinel_already_set() {
        let mgr = fresh();
        // Pre-stamp the sentinel as if a previous run had completed.
        mgr.backend_save(KEY_MIGRATION_DONE, &true).await.unwrap();

        // Plant legacy data; this MUST NOT be migrated because the sentinel
        // says we're done.
        let mut domains: HashMap<String, Domain> = HashMap::new();
        domains.insert("x".to_string(), Domain::Workspace { workspace: ws("x") });
        seed_legacy(&mgr, LEGACY_KEY_DOMAINS, &domains);

        mgr.migrate_if_needed().await.expect("migration");

        assert!(
            mgr.get_domain_by_key("x").await.unwrap().is_none(),
            "sentinel must short-circuit the migration"
        );
        assert!(
            mgr.test_storage.read().get(LEGACY_KEY_DOMAINS).is_some(),
            "legacy data must remain untouched when sentinel is set"
        );
    }

    #[tokio::test]
    async fn migrate_running_twice_in_same_process_is_cheap() {
        let mgr = fresh();

        let mut domains: HashMap<String, Domain> = HashMap::new();
        domains.insert("y".to_string(), Domain::Workspace { workspace: ws("y") });
        seed_legacy(&mgr, LEGACY_KEY_DOMAINS, &domains);

        mgr.migrate_if_needed().await.expect("first migration");
        // Second call must be a no-op (process-local fast-path), and must
        // not undo anything from the first call.
        mgr.migrate_if_needed().await.expect("second migration");

        let idx = mgr.get_index(KEY_INDEX_DOMAIN_IDS).await.unwrap();
        assert_eq!(idx.len(), 1);
        assert!(mgr.get_domain_by_key("y").await.unwrap().is_some());
    }

    #[tokio::test]
    async fn schema_version_round_trips() {
        let mgr = fresh();

        // Fresh DB has no version stamp.
        assert!(mgr.get_schema_version().await.unwrap().is_none());

        // After set, the value is visible to subsequent reads.
        mgr.set_schema_version(7).await.unwrap();
        assert_eq!(mgr.get_schema_version().await.unwrap(), Some(7));

        // Idempotent overwrite to a higher version (simulates an upgrade).
        mgr.set_schema_version(8).await.unwrap();
        assert_eq!(mgr.get_schema_version().await.unwrap(), Some(8));
    }
}

#[cfg(test)]
mod group_message_tests {
    //! Regression tests for the `group_msg_mutex`. The three group
    //! message ops (`store`, `update`, `delete`) all do a load,
    //! mutate, save sequence; without the mutex, two concurrent
    //! callers would each load the prior list, mutate, and save in
    //! whichever order their futures wake — silently dropping one
    //! caller's mutation when the second save lands on top.
    use super::*;
    use citadel_sdk::prelude::StackedRatchet;
    use citadel_workspace_types::{GroupMessage, GroupMessageType};

    fn fresh() -> Arc<BackendTransactionManager<StackedRatchet>> {
        Arc::new(BackendTransactionManager::new())
    }

    fn msg(id: &str, group_id: &str) -> GroupMessage {
        GroupMessage {
            id: id.to_string(),
            group_id: group_id.to_string(),
            sender_id: "u1".to_string(),
            sender_name: "Alice".to_string(),
            message_type: GroupMessageType::Text,
            content: format!("body-{id}"),
            timestamp: 0,
            reply_to: None,
            reply_count: 0,
            mentions: vec![],
            edited_at: None,
        }
    }

    /// 50 concurrent `store_group_message` calls into the same group
    /// must all land — the pre-mutex implementation lost messages
    /// because the load-modify-save sequences interleaved and the
    /// last-writer-wins saves clobbered earlier inserts.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_stores_all_persist() {
        let mgr = fresh();
        let n = 50;
        let handles: Vec<_> = (0..n)
            .map(|i| {
                let mgr = Arc::clone(&mgr);
                tokio::spawn(async move {
                    mgr.store_group_message(msg(&format!("m{i}"), "g1"))
                        .await
                        .expect("store ok");
                })
            })
            .collect();
        for h in handles {
            h.await.expect("task ok");
        }

        let stored = mgr.get_group_messages("g1").await.expect("get ok");
        assert_eq!(
            stored.len(),
            n,
            "every concurrent store must land — mutex regression if not"
        );
        let mut ids: Vec<&str> = stored.iter().map(|m| m.id.as_str()).collect();
        ids.sort();
        let mut expected: Vec<String> = (0..n).map(|i| format!("m{i}")).collect();
        expected.sort();
        assert_eq!(ids, expected.iter().map(|s| s.as_str()).collect::<Vec<_>>());
    }

    /// Concurrent edits to *different* messages in the same group
    /// must all be visible after the storm. Pre-mutex, two edits
    /// would each load the same prior list, apply one mutation, and
    /// save — losing the other's edit.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_updates_dont_lose_edits() {
        let mgr = fresh();
        // Seed two messages.
        mgr.store_group_message(msg("a", "g")).await.unwrap();
        mgr.store_group_message(msg("b", "g")).await.unwrap();

        let m1 = Arc::clone(&mgr);
        let m2 = Arc::clone(&mgr);
        let (r1, r2) = tokio::join!(
            tokio::spawn(async move {
                m1.update_group_message("g", "a", "edit-a".into(), 100)
                    .await
            }),
            tokio::spawn(async move {
                m2.update_group_message("g", "b", "edit-b".into(), 100)
                    .await
            }),
        );
        r1.unwrap().unwrap();
        r2.unwrap().unwrap();

        let stored = mgr.get_group_messages("g").await.unwrap();
        let by_id: HashMap<&str, &GroupMessage> =
            stored.iter().map(|m| (m.id.as_str(), m)).collect();
        assert_eq!(by_id.get("a").unwrap().content, "edit-a");
        assert_eq!(by_id.get("b").unwrap().content, "edit-b");
    }
}

#[cfg(test)]
mod node_concurrency_tests {
    //! Regression tests for `node_mutex`. The three DomainNode mutators
    //! (`insert_node`, `remove_node`, `update_node`) all share a single
    //! collection-level backend key, so the same load-modify-save race
    //! that motivated `group_msg_mutex` applies here. Without the
    //! mutex, two concurrent inserts each load the same prior map,
    //! each apply their change, and the second save overwrites the
    //! first — silently losing a node insert.
    use super::*;
    use citadel_sdk::prelude::StackedRatchet;
    use citadel_workspace_types::structs::{DomainNode, DomainPermissions, NodeEntityType};

    fn fresh() -> Arc<BackendTransactionManager<StackedRatchet>> {
        Arc::new(BackendTransactionManager::new())
    }

    fn node(id: &str) -> DomainNode {
        DomainNode {
            id: id.to_string(),
            parent_id: None,
            entity_type: NodeEntityType::Child("Office".to_string()),
            depth: 1,
            name: format!("node-{id}"),
            description: String::new(),
            owner_id: "owner".to_string(),
            members: vec![],
            children: vec![],
            mdx_content: String::new(),
            rules: None,
            chat_enabled: false,
            chat_channel_id: None,
            default_permissions: DomainPermissions::default(),
            metadata: vec![],
            allowed_child_types: None,
            is_default: false,
            created_at: 0,
            updated_at: 0,
        }
    }

    /// 50 concurrent `insert_node` calls into the same collection
    /// must all land. The pre-mutex implementation lost roughly half
    /// because the read-modify-write cycles interleaved.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_inserts_all_persist() {
        let mgr = fresh();
        let n = 50;
        let handles: Vec<_> = (0..n)
            .map(|i| {
                let mgr = Arc::clone(&mgr);
                tokio::spawn(async move {
                    let id = format!("n{i}");
                    mgr.insert_node(id.clone(), node(&id))
                        .await
                        .expect("insert");
                })
            })
            .collect();
        for h in handles {
            h.await.expect("task ok");
        }

        let stored = mgr.get_all_nodes().await.expect("get_all_nodes");
        assert_eq!(
            stored.len(),
            n,
            "every concurrent insert must land — node_mutex regression if not"
        );
    }

    /// Concurrent insert + update on different nodes must both
    /// be visible after the storm.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_insert_and_update_dont_lose_either() {
        let mgr = fresh();
        // Seed an existing node so the update has a target.
        mgr.insert_node("a".to_string(), node("a")).await.unwrap();

        let m1 = Arc::clone(&mgr);
        let m2 = Arc::clone(&mgr);
        let (r1, r2) = tokio::join!(
            tokio::spawn(async move { m1.insert_node("b".to_string(), node("b")).await }),
            tokio::spawn(async move {
                let mut updated = node("a");
                updated.name = "renamed".to_string();
                m2.update_node("a", updated).await
            }),
        );
        r1.unwrap().unwrap();
        r2.unwrap().unwrap();

        let stored = mgr.get_all_nodes().await.unwrap();
        assert!(stored.contains_key("a"), "update target should still exist");
        assert!(
            stored.contains_key("b"),
            "concurrent insert must not be lost"
        );
        assert_eq!(stored.get("a").unwrap().name, "renamed");
    }
}
